import { isAbsolute } from "node:path";

import type { DomainEvent, EntityId, StorageAdapter, Task } from "@vpr/contracts";

export class CoordinationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CoordinationError";
  }
}

interface PathLock {
  readonly owner: string;
  readonly paths: readonly string[];
  readonly isolationId?: string;
}

export class PathLockManager {
  readonly #locks = new Map<string, PathLock>();

  public acquire(input: PathLock): PathLock {
    if (input.owner.trim().length === 0 || input.paths.length === 0) {
      throw new TypeError("Path lock requires owner and paths");
    }
    if (this.#locks.has(input.owner)) throw new CoordinationError(`Owner already holds a path lock: ${input.owner}`);
    const paths = input.paths.map(normalizePath);
    for (const lock of this.#locks.values()) {
      const isolated =
        input.isolationId !== undefined &&
        lock.isolationId !== undefined &&
        input.isolationId !== lock.isolationId;
      if (!isolated && paths.some((path) => lock.paths.some((held) => overlaps(path, held)))) {
        throw new CoordinationError(`Path overlap with lock owner ${lock.owner}`);
      }
    }
    const lock: PathLock = {
      owner: input.owner,
      paths,
      ...(input.isolationId === undefined ? {} : { isolationId: input.isolationId })
    };
    this.#locks.set(input.owner, lock);
    return lock;
  }

  public release(owner: string): void {
    this.#locks.delete(owner);
  }

  public list(): readonly PathLock[] {
    return [...this.#locks.values()];
  }
}

export function selectRunnableTasks(
  tasks: readonly Task[],
  activeTaskIds: ReadonlySet<EntityId>,
  maxParallelism: number
): readonly Task[] {
  if (!Number.isInteger(maxParallelism) || maxParallelism < 1) {
    throw new RangeError("Maximum parallelism must be at least 1");
  }
  const available = Math.max(0, maxParallelism - activeTaskIds.size);
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  return tasks
    .filter((task) =>
      task.status === "READY" &&
      !activeTaskIds.has(task.taskId) &&
      task.dependencies.every((dependency) => byId.get(dependency)?.status === "COMPLETED")
    )
    .slice(0, available);
}

export interface WorkerAssignment {
  readonly runId: EntityId;
  readonly taskId: EntityId;
  readonly owner: string;
  readonly branch: string;
  readonly worktree: string;
  readonly baseCommit: string;
  readonly lockOwner: string;
  readonly allowedPaths: readonly string[];
  readonly requiredChecks: readonly string[];
}

export interface AssignmentRecord {
  readonly assignment: WorkerAssignment;
  readonly status: "assigned" | "validated" | "integrated";
  readonly workerCommit?: string;
  readonly integratedCommit?: string;
}

export interface WorkerOutput {
  readonly runId: EntityId;
  readonly taskId: EntityId;
  readonly contextPackPath: string;
  readonly commit: string;
  readonly changedPaths: readonly string[];
  readonly checks: readonly {
    readonly id: string;
    readonly status: "passed" | "failed" | "not-run";
    readonly snapshotHash: string;
  }[];
  readonly diffSnapshotHash: string;
  readonly reviewSnapshotHash: string;
  readonly delegatedFullPlan: boolean;
}

export function validateWorkerOutput(
  assignment: WorkerAssignment,
  output: WorkerOutput
): { readonly valid: true; readonly commit: string } {
  if (output.runId !== assignment.runId || output.taskId !== assignment.taskId) {
    throw new CoordinationError("Worker output does not match its Run/Task assignment");
  }
  if (output.delegatedFullPlan) {
    throw new CoordinationError("Only the coordinator may act as the full-plan orchestrator");
  }
  if (output.contextPackPath.trim().length === 0 || output.commit.trim().length === 0) {
    throw new CoordinationError("Worker output requires a context handoff and commit");
  }
  const allowed = assignment.allowedPaths.map(normalizePath);
  for (const changed of output.changedPaths.map(normalizePath)) {
    if (!allowed.some((root) => changed === root || changed.startsWith(`${root}/`))) {
      throw new CoordinationError(`Changed path is outside allowed paths: ${changed}`);
    }
  }
  for (const required of assignment.requiredChecks) {
    const check = output.checks.find((candidate) => candidate.id === required);
    if (
      check === undefined ||
      check.status !== "passed" ||
      check.snapshotHash !== output.diffSnapshotHash
    ) {
      throw new CoordinationError(`Required check is missing, failed or stale: ${required}`);
    }
  }
  if (output.reviewSnapshotHash !== output.diffSnapshotHash) {
    throw new CoordinationError("Worker review is stale for the submitted diff");
  }
  return { valid: true, commit: output.commit };
}

export class OrchestrationRegistry {
  readonly #projectId: EntityId;
  readonly #storage: StorageAdapter;
  readonly #actor: string;
  readonly #now: () => string;
  readonly #nextId: (prefix: "evt") => EntityId;

  public constructor(input: {
    readonly projectId: EntityId;
    readonly storage: StorageAdapter;
    readonly actor: string;
    readonly now: () => string;
    readonly nextId: (prefix: "evt") => EntityId;
  }) {
    this.#projectId = input.projectId;
    this.#storage = input.storage;
    this.#actor = input.actor;
    this.#now = input.now;
    this.#nextId = input.nextId;
  }

  public async register(assignment: WorkerAssignment): Promise<AssignmentRecord> {
    if ((await this.get(assignment.runId)) !== undefined) {
      throw new CoordinationError(`Run already has an assignment: ${assignment.runId}`);
    }
    const record: AssignmentRecord = { assignment, status: "assigned" };
    await this.#append(assignment.runId, assignment.taskId, "orchestration.assignment.registered", { record });
    return record;
  }

  public async recordOutput(output: WorkerOutput): Promise<AssignmentRecord> {
    const current = await this.get(output.runId);
    if (current === undefined) throw new CoordinationError(`Unknown assignment: ${output.runId}`);
    validateWorkerOutput(current.assignment, output);
    const record: AssignmentRecord = {
      assignment: current.assignment,
      status: "validated",
      workerCommit: output.commit
    };
    await this.#append(output.runId, output.taskId, "orchestration.output.validated", { record });
    return record;
  }

  public async markIntegrated(runId: EntityId, integratedCommit: string): Promise<AssignmentRecord> {
    const current = await this.get(runId);
    if (current === undefined || current.status !== "validated") {
      throw new CoordinationError("Only validated worker output can be integrated");
    }
    const record: AssignmentRecord = {
      ...current,
      status: "integrated",
      integratedCommit
    };
    await this.#append(runId, current.assignment.taskId, "orchestration.output.integrated", { record });
    return record;
  }

  public async get(runId: EntityId): Promise<AssignmentRecord | undefined> {
    const events = await this.#storage.readEvents(this.#projectId);
    let record: AssignmentRecord | undefined;
    for (const event of events) {
      if (
        event.runId === runId &&
        (event.type === "orchestration.assignment.registered" ||
          event.type === "orchestration.output.validated" ||
          event.type === "orchestration.output.integrated")
      ) {
        record = event.payload.record as AssignmentRecord;
      }
    }
    return record;
  }

  async #append(
    runId: EntityId,
    taskId: EntityId,
    type: string,
    payload: Readonly<Record<string, unknown>>
  ): Promise<void> {
    const event: DomainEvent = {
      schemaVersion: 1,
      eventId: this.#nextId("evt"),
      occurredAt: this.#now(),
      projectId: this.#projectId,
      taskId,
      runId,
      actor: this.#actor,
      type,
      payload
    };
    await this.#storage.appendEvent(event);
  }
}

export function assessIntegration(input: {
  readonly assignmentBaseCommit: string;
  readonly currentBaseCommit: string;
  readonly conflicts: readonly string[];
  readonly resolutionMayDiscardWork: boolean;
}):
  | { readonly status: "ready" }
  | { readonly status: "needs-help"; readonly reason: string }
  | { readonly status: "rebase-required"; readonly reason: string } {
  const moved = input.assignmentBaseCommit !== input.currentBaseCommit;
  if ((moved || input.conflicts.length > 0) && input.resolutionMayDiscardWork) {
    return {
      status: "needs-help",
      reason: "Integration conflict or moved base may discard worker changes."
    };
  }
  if (moved || input.conflicts.length > 0) {
    return { status: "rebase-required", reason: "Revalidate the worker commit on the current base." };
  }
  return { status: "ready" };
}

export function assessCleanup(input: {
  readonly integrated: boolean;
  readonly dirty: boolean;
  readonly untrackedPaths: readonly string[];
}): { readonly action: "remove" | "preserve"; readonly reason: string } {
  if (!input.integrated || input.dirty || input.untrackedPaths.length > 0) {
    return { action: "preserve", reason: "Worktree has unintegrated or uncommitted work." };
  }
  return { action: "remove", reason: "Worker commit is integrated and the worktree is clean." };
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (
    normalized.length === 0 ||
    isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new RangeError(`Path must be project-relative: ${path}`);
  }
  return normalized.toLocaleLowerCase("en-US");
}

function overlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
