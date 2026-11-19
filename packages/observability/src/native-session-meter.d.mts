export interface NativeRequestCounter {
  readonly id: string;
  readonly model: string;
  readonly parentToolUseId: string | null;
  readonly atMs: number;
  readonly cacheWriteReported?: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheWrite5mTokens: number | null;
  readonly cacheWrite1hTokens: number | null;
}
export interface NativeToolMetadata {
  readonly requestId?: string;
  readonly pathHash?: string | null;
  readonly returnedTextBytes?: number | null;
  readonly id: string;
  readonly name: string;
  readonly parentToolUseId: string | null;
  readonly startMs: number;
  readonly endMs: number | null;
  readonly failed: boolean | null;
  readonly targetAgent: string | null;
  readonly requestedModel: string | null;
}
export interface NativeSessionSnapshot {
  readonly accounting: string;
  readonly completeAccounting: boolean;
  readonly requests: readonly NativeRequestCounter[];
  readonly tools: readonly NativeToolMetadata[];
  readonly models: readonly Record<string, unknown>[];
  readonly totals: Readonly<Record<string, number>>;
  readonly timings: Readonly<Record<string, unknown>>;
  readonly terminalReceipt: Readonly<Record<string, unknown>> | null;
  readonly compactions: readonly Record<string, unknown>[];
}
/** Existing metadata-only meter; no prompts, file contents or thinking are retained. */
export class NativeSessionMeter {
  observe(event: unknown, atMs: number): void;
  snapshot(wallMs: number): NativeSessionSnapshot;
}
