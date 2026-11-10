import type {
  DomainEvent,
  EntityId,
  RunState,
  StorageAdapter
} from "@vpr/contracts";

export interface RunCheckpoint {
  readonly runId: EntityId;
  readonly revision: number;
  readonly state: RunState;
  readonly pending: readonly string[];
  readonly savedAt: string;
}

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly runId: EntityId;
  readonly category: "external" | "destructive" | "ambiguous";
  readonly summary: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly requestedAt: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
}

export interface ExecutionResumeState {
  readonly lease?: { readonly owner: string; readonly expiresAtMs: number };
  readonly checkpoint?: RunCheckpoint;
  readonly cancellation?: { readonly reason: string; readonly requestedAt: string };
  readonly approvals: readonly ApprovalRequest[];
  readonly completedEffects: readonly string[];
  readonly inDoubtEffects: readonly string[];
}

export interface ExecutionEngineOptions {
  readonly projectId: EntityId;
  readonly storage: StorageAdapter;
  readonly actor: string;
  readonly now: () => string;
  readonly nowMs: () => number;
  readonly nextId: (prefix: "evt") => EntityId;
}

export class LeaseConflictError extends Error {
  public constructor(runId: EntityId, owner: string) {
    super(`Run ${runId} has an active lease owned by ${owner}`);
    this.name = "LeaseConflictError";
  }
}

export class EffectInDoubtError extends Error {
  public constructor(effectKey: string) {
    super(`External effect ${effectKey} started without completion evidence; approval is required before retry`);
    this.name = "EffectInDoubtError";
  }
}

interface FoldedState {
  lease?: { owner: string; expiresAtMs: number; released: boolean };
  checkpoint?: RunCheckpoint;
  cancellation?: { reason: string; requestedAt: string };
  approvals: Map<string, ApprovalRequest>;
  effects: Map<string, "started" | "completed">;
}

export class ExecutionEngine {
  readonly #options: ExecutionEngineOptions;

  public constructor(options: ExecutionEngineOptions) {
    this.#options = options;
  }

  public async acquireLease(runId: EntityId, owner: string, ttlMs: number): Promise<void> {
    if (owner.trim().length === 0 || ttlMs <= 0) throw new TypeError("Lease owner and positive ttl are required");
    const state = await this.#fold(runId);
    if (
      state.lease !== undefined &&
      !state.lease.released &&
      state.lease.expiresAtMs > this.#options.nowMs() &&
      state.lease.owner !== owner
    ) {
      throw new LeaseConflictError(runId, state.lease.owner);
    }
    await this.#append(runId, "execution.lease.acquired", {
      owner,
      expiresAtMs: this.#options.nowMs() + ttlMs
    });
  }

  public async releaseLease(runId: EntityId, owner: string): Promise<void> {
    const state = await this.#fold(runId);
    if (state.lease?.owner !== owner || state.lease.released) {
      throw new LeaseConflictError(runId, state.lease?.owner ?? "none");
    }
    await this.#append(runId, "execution.lease.released", { owner });
  }

  public async saveCheckpoint(checkpoint: RunCheckpoint, owner: string): Promise<void> {
    await this.#assertActiveLease(checkpoint.runId, owner);
    const state = await this.#fold(checkpoint.runId);
    if (state.checkpoint !== undefined && checkpoint.revision <= state.checkpoint.revision) {
      if (JSON.stringify(checkpoint) === JSON.stringify(state.checkpoint)) return;
      throw new Error(`Checkpoint revision must advance beyond ${state.checkpoint.revision}`);
    }
    await this.#append(checkpoint.runId, "execution.checkpoint.saved", { checkpoint });
  }

  public async requestCancellation(runId: EntityId, reason: string): Promise<void> {
    const state = await this.#fold(runId);
    if (state.cancellation !== undefined) return;
    if (reason.trim().length === 0) throw new TypeError("Cancellation reason is required");
    await this.#append(runId, "execution.cancellation.requested", {
      reason,
      requestedAt: this.#options.now()
    });
  }

  public async requestApproval(
    runId: EntityId,
    request: Pick<ApprovalRequest, "category" | "summary">
  ): Promise<ApprovalRequest> {
    if (request.summary.trim().length === 0) throw new TypeError("Approval summary is required");
    const approval: ApprovalRequest = {
      approvalId: `approval_${this.#options.nextId("evt")}`,
      runId,
      ...request,
      status: "pending",
      requestedAt: this.#options.now()
    };
    await this.#append(runId, "execution.approval.requested", { approval });
    return approval;
  }

  public async resolveApproval(
    approvalId: string,
    status: "approved" | "rejected",
    resolvedBy: string
  ): Promise<ApprovalRequest> {
    const events = await this.#options.storage.readEvents(this.#options.projectId);
    const requested = events.find(
      (event) => event.type === "execution.approval.requested" &&
        (event.payload.approval as ApprovalRequest).approvalId === approvalId
    );
    if (requested === undefined || requested.runId === undefined) {
      throw new RangeError(`Unknown approval: ${approvalId}`);
    }
    const state = await this.#fold(requested.runId);
    const current = state.approvals.get(approvalId);
    if (current === undefined) throw new RangeError(`Unknown approval: ${approvalId}`);
    if (current.status !== "pending") return current;
    const approval: ApprovalRequest = {
      ...current,
      status,
      resolvedAt: this.#options.now(),
      resolvedBy
    };
    await this.#append(current.runId, "execution.approval.resolved", { approval });
    return approval;
  }

  public async executeEffectOnce(
    runId: EntityId,
    owner: string,
    effectKey: string,
    action: (idempotencyKey: string) => Promise<void>
  ): Promise<{ readonly status: "completed" | "already-completed" }> {
    if (effectKey.trim().length === 0) throw new TypeError("Effect key is required");
    await this.#assertActiveLease(runId, owner);
    const state = await this.#fold(runId);
    const effect = state.effects.get(effectKey);
    if (effect === "completed") return { status: "already-completed" };
    if (effect === "started") throw new EffectInDoubtError(effectKey);
    await this.#append(runId, "execution.effect.started", { effectKey });
    await action(effectKey);
    await this.#append(runId, "execution.effect.completed", { effectKey });
    return { status: "completed" };
  }

  public async resume(runId: EntityId, owner: string): Promise<ExecutionResumeState> {
    const state = await this.#fold(runId);
    if (
      state.lease === undefined ||
      state.lease.released ||
      state.lease.expiresAtMs <= this.#options.nowMs() ||
      state.lease.owner !== owner
    ) {
      throw new LeaseConflictError(runId, state.lease?.owner ?? "none");
    }
    const completedEffects: string[] = [];
    const inDoubtEffects: string[] = [];
    for (const [key, status] of state.effects) {
      (status === "completed" ? completedEffects : inDoubtEffects).push(key);
    }
    return {
      lease: { owner: state.lease.owner, expiresAtMs: state.lease.expiresAtMs },
      ...(state.checkpoint === undefined ? {} : { checkpoint: state.checkpoint }),
      ...(state.cancellation === undefined ? {} : { cancellation: state.cancellation }),
      approvals: [...state.approvals.values()],
      completedEffects: completedEffects.sort(),
      inDoubtEffects: inDoubtEffects.sort()
    };
  }

  async #append(
    runId: EntityId,
    type: string,
    payload: Readonly<Record<string, unknown>>
  ): Promise<void> {
    const event: DomainEvent = {
      schemaVersion: 1,
      eventId: this.#options.nextId("evt"),
      occurredAt: this.#options.now(),
      projectId: this.#options.projectId,
      runId,
      actor: this.#options.actor,
      type,
      payload
    };
    await this.#options.storage.appendEvent(event);
  }

  async #assertActiveLease(runId: EntityId, owner: string): Promise<void> {
    const lease = (await this.#fold(runId)).lease;
    if (
      lease === undefined ||
      lease.released ||
      lease.expiresAtMs <= this.#options.nowMs() ||
      lease.owner !== owner
    ) {
      throw new LeaseConflictError(runId, lease?.owner ?? "none");
    }
  }

  async #fold(runId: EntityId): Promise<FoldedState> {
    const state: FoldedState = {
      approvals: new Map(),
      effects: new Map()
    };
    const events = await this.#options.storage.readEvents(this.#options.projectId);
    for (const event of events) {
      if (event.runId !== runId) continue;
      if (event.type === "execution.lease.acquired") {
        state.lease = {
          owner: event.payload.owner as string,
          expiresAtMs: event.payload.expiresAtMs as number,
          released: false
        };
      } else if (event.type === "execution.lease.released" && state.lease !== undefined) {
        state.lease.released = true;
      } else if (event.type === "execution.checkpoint.saved") {
        state.checkpoint = event.payload.checkpoint as RunCheckpoint;
      } else if (event.type === "execution.cancellation.requested") {
        state.cancellation = {
          reason: event.payload.reason as string,
          requestedAt: event.payload.requestedAt as string
        };
      } else if (event.type === "execution.approval.requested" || event.type === "execution.approval.resolved") {
        const approval = event.payload.approval as ApprovalRequest;
        state.approvals.set(approval.approvalId, approval);
      } else if (event.type === "execution.effect.started") {
        state.effects.set(event.payload.effectKey as string, "started");
      } else if (event.type === "execution.effect.completed") {
        state.effects.set(event.payload.effectKey as string, "completed");
      }
    }
    return state;
  }
}

export type TerminalObservation =
  | { readonly kind: "cancelled"; readonly signalObserved: boolean }
  | { readonly kind: "validated"; readonly checksPassed: boolean; readonly reviewPassed: boolean }
  | { readonly kind: "failed"; readonly errorObserved: boolean }
  | { readonly kind: "blocked"; readonly blockerObserved: boolean };

export function terminalStateFromObservation(observation: TerminalObservation): RunState {
  if (observation.kind === "cancelled" && observation.signalObserved) return "CANCELLED";
  if (observation.kind === "validated" && observation.checksPassed && observation.reviewPassed) return "COMPLETED";
  if (observation.kind === "failed" && observation.errorObserved) return "FAILED";
  if (observation.kind === "blocked" && observation.blockerObserved) return "BLOCKED";
  throw new Error("No terminal state is justified by the observation");
}
