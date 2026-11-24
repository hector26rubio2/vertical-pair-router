import type { AgentModel } from "@vpr/core";
import type { NativeSessionSnapshot } from "@vpr/observability";

export type CodexPriceTier = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite30m: number;
  cacheWrite12h: number;
};

export interface CodexPrices {
  expiresAt: string;
  cards: readonly (CodexPriceTier & {
    model: string;
    longContext?: CodexPriceTier;
  })[];
}

export interface SessionContext {
  executable: string;
  model: AgentModel;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  writeFiles: boolean;
  allowedPaths: readonly string[];
  maxTurns: number | undefined;
  codexPrices: CodexPrices | undefined;
  environment: NodeJS.ProcessEnv;
  onSnapshot: ((receipt: NativeSessionSnapshot) => Promise<void>) | undefined;
  elapsedMs(): number;
  record(
    id: string,
    model: string,
    counters: Record<string, unknown>,
    cost?: Record<string, unknown> | null,
  ): void;
  trackWrite(write: Promise<unknown>): void;
  markStorageFailed(): void;
}

export type SessionOutcome =
  | { kind: "refused"; failure: string }
  | {
      kind: "completed";
      answer: string;
      answerTruncated: boolean;
      success: boolean;
      failure: string | null;
      diagnostic: string | undefined;
      snapshot?: (wallMs: number) => NativeSessionSnapshot;
    };

export type NativeProviderSession = (
  context: SessionContext,
) => Promise<SessionOutcome>;

export interface SessionState {
  answer: string;
  answerTruncated: boolean;
  success: boolean;
  failure: string | null;
  diagnostic: string | undefined;
}

export function newSessionState(): SessionState {
  return {
    answer: "",
    answerTruncated: false,
    success: false,
    failure: null,
    diagnostic: undefined,
  };
}

export function integer(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

export const maxAnswerLength = 12000;
