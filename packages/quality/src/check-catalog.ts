import { resolve } from "node:path";

import type { ProcessRunner } from "@vpr/contracts";

export type CheckCategory =
  | "unit-test"
  | "integration-test"
  | "lint"
  | "typecheck"
  | "build"
  | "scanner";

export interface QualityCheck {
  readonly id: string;
  readonly category: CheckCategory;
  readonly stack: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly permission: "none" | "read-worktree" | "write-worktree" | "network";
  readonly scannerApproved?: boolean;
}

export type QualityCheckStatus = "passed" | "failed" | "timed-out" | "cancelled" | "truncated";

export interface QualityCheckEvidence {
  readonly checkId: string;
  readonly snapshotHash: string;
  readonly status: QualityCheckStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitCode?: number;
  readonly outputTruncated: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly source: "measured";
}

export class CheckCatalog {
  readonly #checks = new Map<string, QualityCheck>();

  public register(check: QualityCheck): QualityCheck {
    if (check.id.trim().length === 0 || check.program.trim().length === 0) {
      throw new TypeError("Check id and program are required");
    }
    if (check.timeoutMs <= 0 || check.maxOutputBytes <= 0) {
      throw new RangeError("Check timeout and output limit must be positive");
    }
    if (check.category === "scanner" && check.scannerApproved !== true) {
      throw new TypeError("Scanner checks must be explicitly approved");
    }
    if (this.#checks.has(check.id)) throw new TypeError(`Duplicate check id: ${check.id}`);
    this.#checks.set(check.id, check);
    return check;
  }

  public get(id: string): QualityCheck {
    const check = this.#checks.get(id);
    if (check === undefined) throw new RangeError(`Unknown check: ${id}`);
    return check;
  }

  public list(): readonly QualityCheck[] {
    return [...this.#checks.values()];
  }
}

export function nodeCheckDefinitions(input: {
  readonly packageManagerProgram: string;
  readonly cwd?: string;
  readonly securityScannerApproved: boolean;
}): readonly QualityCheck[] {
  const cwd = input.cwd ?? ".";
  const command = (id: string, category: CheckCategory, script: string): QualityCheck => ({
    id,
    category,
    stack: "node",
    program: input.packageManagerProgram,
    args: [script],
    cwd,
    timeoutMs: 120_000,
    maxOutputBytes: 1_048_576,
    permission: "read-worktree"
  });
  return [
    command("test:unit", "unit-test", "test:unit"),
    command("test:integration", "integration-test", "test:integration"),
    command("lint", "lint", "lint"),
    command("typecheck", "typecheck", "typecheck"),
    command("build", "build", "build"),
    ...(input.securityScannerApproved
      ? [{
          id: "audit",
          category: "scanner" as const,
          stack: "node",
          program: input.packageManagerProgram,
          args: ["audit", "--audit-level", "high"],
          cwd,
          timeoutMs: 120_000,
          maxOutputBytes: 1_048_576,
          permission: "network" as const,
          scannerApproved: true
        }]
      : [])
  ];
}

export async function runQualityCheck(input: {
  readonly check: QualityCheck;
  readonly root: string;
  readonly snapshotHash: string;
  readonly processRunner: ProcessRunner;
  readonly now: () => string;
}): Promise<QualityCheckEvidence> {
  const startedAt = input.now();
  const result = await input.processRunner({
    program: input.check.program,
    args: input.check.args,
    cwd: resolve(input.root, input.check.cwd),
    timeoutMs: input.check.timeoutMs,
    maxOutputBytes: input.check.maxOutputBytes
  });
  const status: QualityCheckStatus = result.cancelled
    ? "cancelled"
    : result.timedOut
      ? "timed-out"
      : result.outputTruncated
        ? "truncated"
        : result.exitCode === 0
          ? "passed"
          : "failed";
  return {
    checkId: input.check.id,
    snapshotHash: input.snapshotHash,
    status,
    startedAt,
    finishedAt: input.now(),
    ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
    outputTruncated: result.outputTruncated,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
    source: "measured"
  };
}

export interface FinalVerification {
  readonly passed: boolean;
  readonly missing: readonly string[];
  readonly stale: readonly string[];
  readonly failed: readonly string[];
}

export function finalVerification(
  requiredCheckIds: readonly string[],
  currentSnapshotHash: string,
  evidence: readonly QualityCheckEvidence[]
): FinalVerification {
  const missing: string[] = [];
  const stale: string[] = [];
  const failed: string[] = [];
  for (const id of requiredCheckIds) {
    const candidates = evidence.filter((item) => item.checkId === id);
    const latest = candidates.reduce<QualityCheckEvidence | undefined>(
      (selected, item) => selected === undefined || item.finishedAt > selected.finishedAt ? item : selected,
      undefined
    );
    if (latest === undefined) missing.push(id);
    else if (latest.snapshotHash !== currentSnapshotHash) stale.push(id);
    else if (latest.status !== "passed") failed.push(id);
  }
  return {
    passed: missing.length === 0 && stale.length === 0 && failed.length === 0,
    missing,
    stale,
    failed
  };
}
