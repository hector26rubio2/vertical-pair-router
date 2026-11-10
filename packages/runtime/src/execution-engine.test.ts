import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { EntityId } from "@vpr/contracts";
import { SqliteStorage } from "@vpr/storage-sqlite";

import {
  CycleDetector,
  EffectInDoubtError,
  ExecutionBudget,
  ExecutionEngine,
  LeaseConflictError,
  terminalStateFromObservation
} from "./index.js";

const projectId = "project_execution" as EntityId;
const runId = "run_execution" as EntityId;

function ids(): (prefix: "evt") => EntityId {
  let value = 0;
  return (prefix) => `${prefix}_${++value}` as EntityId;
}

test("enforces only observable limits and separates provider-internal limits", () => {
  let now = 1_000;
  const budget = new ExecutionBudget({
    limits: {
      maxWallTimeMs: 1_000,
      maxRetries: 1,
      maxRouterIterations: 2,
      maxTokens: 500,
      maxCostUsd: 1
    },
    observability: { tokens: "unavailable", cost: "unavailable" },
    providerInternal: { maxTurns: 20 },
    startedAtMs: now,
    nowMs: () => now
  });

  assert.equal(budget.consumeAttempt().attempt, 1);
  assert.equal(budget.consumeAttempt().attempt, 2);
  assert.throws(() => budget.consumeAttempt(), /retry/);
  assert.equal(budget.consumeRouterIteration().iteration, 1);
  assert.equal(budget.consumeRouterIteration().iteration, 2);
  assert.throws(() => budget.consumeRouterIteration(), /iteration/);
  assert.deepEqual(budget.observeUsage({ tokens: 999, costUsd: 5 }).enforcement, {
    tokens: "unavailable",
    cost: "unavailable"
  });
  assert.deepEqual(budget.providerInternalLimits, { maxTurns: 20 });
  const observedOnly = new ExecutionBudget({
    limits: { maxWallTimeMs: 1_000, maxRetries: 0, maxRouterIterations: 1, maxTokens: 1 },
    observability: { tokens: "observable", cost: "unavailable" },
    providerInternal: {},
    startedAtMs: now,
    nowMs: () => now
  });
  assert.equal(observedOnly.observeUsage({ tokens: 999 }).enforcement.tokens, "observed-only");
  now = 2_001;
  assert.throws(() => budget.assertWithinWallTime(), /wall time/);
});

test("detects repeated command/result cycles but resets on real progress", () => {
  const detector = new CycleDetector(3);
  assert.equal(detector.observe({ command: "test", resultHash: "fail", progressMarker: "a" }).cycle, false);
  assert.equal(detector.observe({ command: "test", resultHash: "fail", progressMarker: "a" }).cycle, false);
  assert.equal(detector.observe({ command: "test", resultHash: "fail", progressMarker: "a" }).cycle, true);
  assert.equal(detector.observe({ command: "test", resultHash: "fail", progressMarker: "b" }).cycle, false);
  assert.equal(detector.observe({ command: "test", resultHash: "pass", progressMarker: "b" }).cycle, false);
});

test("persists leases, cancellation, checkpoints, approvals and exactly-once effect keys", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-engine-"));
  const db = join(root, "runtime.sqlite");
  let now = 1_000;
  const nextId = ids();
  const storage = new SqliteStorage(db);
  await storage.initialize();
  const engine = new ExecutionEngine({
    projectId,
    storage,
    actor: "engine-test",
    now: () => new Date(now).toISOString(),
    nowMs: () => now,
    nextId
  });
  await engine.acquireLease(runId, "worker-a", 500);
  await assert.rejects(engine.acquireLease(runId, "worker-b", 500), LeaseConflictError);
  await engine.saveCheckpoint({
    runId,
    revision: 3,
    state: "RUNNING",
    pending: ["validate"],
    savedAt: new Date(now).toISOString()
  }, "worker-a");
  await engine.requestCancellation(runId, "owner stopped the Run");
  const approval = await engine.requestApproval(runId, {
    category: "destructive",
    summary: "Remove generated cache only"
  });
  await engine.resolveApproval(approval.approvalId, "approved", "owner");

  let effects = 0;
  assert.equal((await engine.executeEffectOnce(runId, "worker-a", "publish:artifact", async (key) => {
    effects += 1;
    assert.equal(key, "publish:artifact");
  })).status, "completed");
  assert.equal((await engine.executeEffectOnce(runId, "worker-a", "publish:artifact", async () => {
    effects += 1;
  })).status, "already-completed");
  assert.equal(effects, 1);
  await assert.rejects(engine.executeEffectOnce(runId, "worker-a", "external:uncertain", async () => {
    throw new Error("connection lost after send");
  }), /connection lost/);
  await assert.rejects(
    engine.executeEffectOnce(runId, "worker-a", "external:uncertain", async () => undefined),
    EffectInDoubtError
  );
  await storage.close();

  const reopened = new SqliteStorage(db);
  await reopened.initialize();
  context.after(async () => {
    await reopened.close();
    await rm(root, { recursive: true, force: true });
  });
  const resumed = new ExecutionEngine({
    projectId,
    storage: reopened,
    actor: "engine-test",
    now: () => new Date(now).toISOString(),
    nowMs: () => now,
    nextId
  });
  const state = await resumed.resume(runId, "worker-a");
  assert.equal(state.checkpoint?.revision, 3);
  assert.equal(state.cancellation?.reason, "owner stopped the Run");
  assert.equal(state.approvals[0]?.status, "approved");
  assert.deepEqual(state.completedEffects, ["publish:artifact"]);

  now = 1_501;
  await resumed.acquireLease(runId, "worker-b", 500);
  assert.equal((await resumed.resume(runId, "worker-b")).lease?.owner, "worker-b");
});

test("terminal states require concrete observations", () => {
  assert.equal(terminalStateFromObservation({ kind: "cancelled", signalObserved: true }), "CANCELLED");
  assert.equal(terminalStateFromObservation({ kind: "validated", checksPassed: true, reviewPassed: true }), "COMPLETED");
  assert.equal(terminalStateFromObservation({ kind: "failed", errorObserved: true }), "FAILED");
  assert.throws(() => terminalStateFromObservation({ kind: "validated", checksPassed: true, reviewPassed: false }), /terminal/);
});
