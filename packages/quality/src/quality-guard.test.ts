import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import type { ProcessResult, ProcessRunner } from "@vpr/contracts";

import {
  CheckCatalog,
  ReviewPolicyError,
  assessRegressionTest,
  captureWorkspaceDiff,
  createDualReview,
  finalVerification,
  nodeCheckDefinitions,
  recordTddMethod,
  runQualityCheck,
  validateFinding
} from "./index.js";

const execFileAsync = promisify(execFile);

const passRunner: ProcessRunner = async (): Promise<ProcessResult> => ({
  exitCode: 0,
  durationMs: 5,
  stdout: "ok",
  stderr: "",
  outputTruncated: false,
  timedOut: false,
  cancelled: false
});

test("catalog validates typed checks and approved scanners", () => {
  const catalog = new CheckCatalog();
  catalog.register({
    id: "unit",
    category: "unit-test",
    stack: "node",
    program: "node",
    args: ["--test"],
    cwd: ".",
    timeoutMs: 30_000,
    maxOutputBytes: 100_000,
    permission: "read-worktree"
  });
  assert.equal(catalog.get("unit").category, "unit-test");
  assert.throws(() => catalog.register({
    id: "scanner",
    category: "scanner",
    stack: "node",
    program: "scanner",
    args: [],
    cwd: ".",
    timeoutMs: 30_000,
    maxOutputBytes: 100_000,
    permission: "read-worktree",
    scannerApproved: false
  }), /approved/);
  const standard = nodeCheckDefinitions({
    packageManagerProgram: "pnpm",
    securityScannerApproved: true
  });
  assert.deepEqual(
    standard.map((check) => check.category),
    ["unit-test", "integration-test", "lint", "typecheck", "build", "scanner"]
  );
});

test("captures staged, unstaged and untracked changes and changes its hash", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-diff-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "VPR Test"], { cwd: root });
  await writeFile(join(root, "tracked.txt"), "base\n");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", "base"], { cwd: root });
  await writeFile(join(root, "tracked.txt"), "staged\n");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
  await writeFile(join(root, "tracked.txt"), "unstaged\n");
  await writeFile(join(root, "new.txt"), "untracked\n");

  const runner = gitRunner();
  const first = await captureWorkspaceDiff({
    root,
    gitProgram: "git",
    processRunner: runner,
    capturedAt: "2026-11-09T15:00:00.000Z",
    maxOutputBytes: 1_000_000,
    maxUntrackedBytes: 100_000
  });
  assert.match(first.stagedDiff, /staged/);
  assert.match(first.unstagedDiff, /unstaged/);
  assert.deepEqual(first.untracked.map((file) => file.path), ["new.txt"]);

  await writeFile(join(root, "new.txt"), "changed\n");
  const second = await captureWorkspaceDiff({
    root,
    gitProgram: "git",
    processRunner: runner,
    capturedAt: "2026-11-09T15:01:00.000Z",
    maxOutputBytes: 1_000_000,
    maxUntrackedBytes: 100_000
  });
  assert.notEqual(first.snapshotHash, second.snapshotHash);
});

test("quality evidence is bound to the exact workspace snapshot", async () => {
  const catalog = new CheckCatalog();
  const check = catalog.register({
    id: "typecheck",
    category: "typecheck",
    stack: "typescript",
    program: "pnpm",
    args: ["typecheck"],
    cwd: ".",
    timeoutMs: 30_000,
    maxOutputBytes: 100_000,
    permission: "read-worktree"
  });
  const evidence = await runQualityCheck({
    check,
    root: "C:\\repo",
    snapshotHash: "aaa",
    processRunner: passRunner,
    now: () => "2026-11-09T15:00:00.000Z"
  });
  assert.equal(evidence.status, "passed");
  assert.deepEqual(finalVerification(["typecheck"], "aaa", [evidence]), {
    passed: true,
    missing: [],
    stale: [],
    failed: []
  });
  assert.deepEqual(finalVerification(["typecheck"], "bbb", [evidence]).stale, ["typecheck"]);
});

test("records real red-green-refactor evidence and explicit N/A", () => {
  const base = {
    checkId: "unit",
    snapshotHash: "one",
    startedAt: "2026-11-09T15:00:00.000Z",
    finishedAt: "2026-11-09T15:00:01.000Z",
    outputTruncated: false,
    timedOut: false,
    cancelled: false,
    source: "measured"
  } as const;
  const method = recordTddMethod([
    { stage: "RED", testReference: "route.test.ts:12", evidence: { ...base, status: "failed" } },
    { stage: "GREEN", testReference: "route.test.ts:12", evidence: { ...base, snapshotHash: "two", status: "passed" } },
    { stage: "REFACTOR", testReference: "route.test.ts:12", evidence: { ...base, snapshotHash: "three", status: "passed" } }
  ]);
  assert.equal(method.status, "TDD");
  assert.equal(recordTddMethod([{ stage: "NOT_APPLICABLE", reason: "Documentation-only wording change." }]).status, "NOT_APPLICABLE");
  assert.throws(() => recordTddMethod([
    { stage: "RED", testReference: "x", evidence: { ...base, status: "passed" } },
    { stage: "GREEN", testReference: "x", evidence: { ...base, status: "passed" } }
  ]), /RED/);
});

test("warns about coupled mocks and tautological regression tests", () => {
  const assessment = assessRegressionTest({
    bugReproducible: true,
    assertionTargetsObservableBehavior: false,
    mocksInternalImplementation: true,
    expectedDerivedFromActual: true
  });
  assert.equal(assessment.useful, false);
  assert.equal(assessment.warnings.length, 3);
});

test("dual review forbids recursive fan-out and validates findings against the snapshot", () => {
  const review = createDualReview({
    snapshotHash: "abc",
    author: "author",
    reviewer: "reviewer",
    separationAvailable: true,
    separationBeneficial: true,
    depth: 0,
    acceptance: { verdict: "fail", findings: [{
      axis: "acceptance",
      file: "src/route.ts",
      line: 12,
      evidence: "Acceptance criterion A is not exercised.",
      severity: "high",
      confidence: "high"
    }] },
    standardsSecurity: { verdict: "pass", findings: [] }
  });
  assert.equal(validateFinding(review.acceptance.findings[0]!, "abc").status, "validated");
  assert.throws(() => validateFinding(review.acceptance.findings[0]!, "changed"), /stale/);
  assert.throws(() => createDualReview({
    snapshotHash: "abc",
    author: "same",
    reviewer: "same",
    separationAvailable: true,
    separationBeneficial: true,
    depth: 0,
    acceptance: { verdict: "pass", findings: [] },
    standardsSecurity: { verdict: "pass", findings: [] }
  }), ReviewPolicyError);
  assert.throws(() => createDualReview({
    snapshotHash: "abc",
    author: "a",
    reviewer: "b",
    separationAvailable: false,
    separationBeneficial: false,
    depth: 1,
    acceptance: { verdict: "pass", findings: [] },
    standardsSecurity: { verdict: "pass", findings: [] }
  }), /recursive/);
});

function gitRunner(): ProcessRunner {
  return async (request): Promise<ProcessResult> => {
    const started = performance.now();
    try {
      const result = await execFileAsync(request.program, [...request.args], {
        cwd: request.cwd,
        encoding: "buffer",
        maxBuffer: request.maxOutputBytes
      });
      return {
        exitCode: 0,
        durationMs: performance.now() - started,
        stdout: result.stdout.toString("utf8"),
        stderr: result.stderr.toString("utf8"),
        outputTruncated: false,
        timedOut: false,
        cancelled: false
      };
    } catch (error) {
      const value = error as { code?: number; stdout?: Buffer; stderr?: Buffer };
      return {
        exitCode: typeof value.code === "number" ? value.code : 1,
        durationMs: performance.now() - started,
        stdout: value.stdout?.toString("utf8") ?? "",
        stderr: value.stderr?.toString("utf8") ?? String(error),
        outputTruncated: false,
        timedOut: false,
        cancelled: false
      };
    }
  };
}
