export const schemaVersion = 1 as const;

export type IdPrefix = "project" | "story" | "task" | "run" | "evt" | "evd";
export type EntityId = `${IdPrefix}_${string}`;

export type RunState =
  | "PENDING"
  | "ANALYZING"
  | "READY"
  | "RUNNING"
  | "VALIDATING"
  | "REVIEW"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_APPROVAL";

export type MeasurementSource =
  | "measured"
  | "provider_reported"
  | "estimated"
  | "unavailable";

export interface Evidence {
  readonly evidenceId: EntityId;
  readonly runId: EntityId;
  readonly kind: "check" | "review" | "approval" | "capability";
  readonly name: string;
  readonly observedAt: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly summary: string;
  readonly outputTruncated: boolean;
  readonly source: MeasurementSource;
  readonly toolVersion?: string;
  readonly reference?: string;
}

export interface DomainEvent<TPayload = Readonly<Record<string, unknown>>> {
  readonly schemaVersion: typeof schemaVersion;
  readonly eventId: EntityId;
  readonly occurredAt: string;
  readonly projectId: EntityId;
  readonly storyId?: EntityId;
  readonly taskId?: EntityId;
  readonly runId?: EntityId;
  readonly actor: string;
  readonly type: string;
  readonly payload: TPayload;
}

export type CapabilityState = "available" | "unavailable" | "unknown" | "degraded";

export interface Capability {
  readonly id: string;
  readonly state: CapabilityState;
  readonly checkedAt: string;
  readonly version?: string;
  readonly expiresAt?: string;
  readonly evidence: readonly Evidence[];
  readonly limitations: readonly string[];
}

export interface Story {
  readonly storyId: EntityId;
  readonly projectId: EntityId;
  readonly title: string;
  readonly need: string;
  readonly desiredOutcome: string;
  readonly acceptanceCriteria: readonly string[];
  readonly exclusions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly status: "DRAFT" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Task {
  readonly taskId: EntityId;
  readonly storyId: EntityId;
  readonly outcome: string;
  readonly acceptanceCriteria: readonly string[];
  readonly dependencies: readonly EntityId[];
  readonly allowedPaths: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly status: "PENDING" | "READY" | "RUNNING" | "COMPLETED" | "BLOCKED";
}

export interface Run {
  readonly runId: EntityId;
  readonly taskId: EntityId;
  readonly state: RunState;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StorageAdapter {
  initialize(): Promise<void>;
  appendEvent(event: DomainEvent): Promise<void>;
  readEvents(projectId: EntityId): Promise<readonly DomainEvent[]>;
  close(): Promise<void>;
}

export interface ProcessRequest {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputTruncated: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

