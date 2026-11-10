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
  readonly runId?: EntityId;
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
  readonly attachments: readonly string[];
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
  readonly workflow:
    | "feature"
    | "bugfix-simple"
    | "bugfix-complex"
    | "refactor"
    | "documentation"
    | "infrastructure"
    | "research";
  readonly demoPath: string;
  readonly requiresHumanReview: boolean;
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

export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>;

export type PolicyLayerKind =
  | "host"
  | "protected-user"
  | "global"
  | "project"
  | "task"
  | "run";

export interface PolicyRules {
  readonly allowShell?: boolean;
  readonly allowNetworkTelemetry?: boolean;
  readonly allowedProviders?: readonly string[];
  readonly maxOutputBytes?: number;
}

export interface PolicyLayer {
  readonly id: string;
  readonly kind: PolicyLayerKind;
  readonly rules: PolicyRules;
}

export interface EffectivePolicy {
  readonly allowShell: boolean;
  readonly allowNetworkTelemetry: boolean;
  readonly allowedProviders: readonly string[];
  readonly maxOutputBytes: number;
  readonly explanation: readonly {
    readonly rule: keyof PolicyRules;
    readonly value: unknown;
    readonly sources: readonly string[];
  }[];
}

export type AdapterCapability = "checks" | "code" | "agent" | "worktree" | "browser";

export interface AdapterDescriptor {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly authentication: "none" | "host-session" | "secret-resolver";
  readonly credentialHandling: "none" | "host-managed" | "secret-resolver-only";
  readonly capabilities: readonly AdapterCapability[];
  readonly availability: CapabilityState;
  readonly availabilityEvidence?: string;
  readonly quality: "standard" | "high";
  readonly operatingSystems: readonly ("win32" | "linux" | "darwin")[];
  readonly transmittedData: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly cost: {
    readonly source: "measured" | "estimated" | "unavailable";
    readonly estimatedUsd?: number;
  };
  readonly latency: {
    readonly source: "measured" | "estimated" | "unavailable";
    readonly estimatedMs?: number;
  };
}

export interface RouteRequest {
  readonly requestId: string;
  readonly requiredCapabilities: readonly AdapterCapability[];
  readonly sensitivity: "local-only" | "provider-allowed";
  readonly requiredQuality: "standard" | "high";
  readonly operatingSystem: "win32" | "linux" | "darwin";
  readonly preferredProvider: string | null;
  readonly fallbackOptIn: boolean;
  readonly optimizeFor: "cost" | "latency" | "balanced";
}

export interface RouteResult {
  readonly requestId: string;
  readonly status: "routed" | "unavailable" | "approval-required";
  readonly adapterId?: string;
  readonly provider?: string;
  readonly pipeline: readonly {
    readonly stage: "policy" | "capability" | "privacy" | "quality" | "cost-latency";
    readonly eligibleAdapterIds: readonly string[];
    readonly rejected: readonly { readonly adapterId: string; readonly reason: string }[];
  }[];
  readonly cost: AdapterDescriptor["cost"];
  readonly latency: AdapterDescriptor["latency"];
  readonly explanation: string;
}

export interface SecretResolver {
  resolve(reference: { readonly provider: string; readonly name: string }): Promise<string | undefined>;
}

export interface AdapterExecutionRequest {
  readonly runId: EntityId;
  readonly taskId: EntityId;
  readonly contextReferences: readonly string[];
  readonly idempotencyKey: string;
}

export interface AdapterExecutionResult {
  readonly status: "completed" | "failed" | "cancelled" | "needs-approval";
  readonly summary: string;
  readonly usage: {
    readonly tokens?: number;
    readonly costUsd?: number;
    readonly source: MeasurementSource;
  };
}

export interface ExecutionAdapter {
  readonly descriptor: AdapterDescriptor;
  execute(
    request: AdapterExecutionRequest,
    options: { readonly signal?: AbortSignal; readonly secretResolver?: SecretResolver }
  ): Promise<AdapterExecutionResult>;
}

