import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { EntityId, Task } from "@vpr/contracts";
import { SqliteStorage } from "@vpr/storage-sqlite";

import {
  CoordinationError,
  OrchestrationRegistry,
  PathLockManager,
  assessCleanup,
  assessIntegration,
  selectRunnableTasks,
  validateWorkerOutput
} from "./index.js";

const storyId = "story_orchestration" as EntityId;

function task(id: string, status: Task["status"], dependencies: readonly EntityId[] = []): Task {
  return {
    taskId: `task_${id}` as EntityId,
    storyId,
    outcome: id,
    acceptanceCriteria: [`${id} works`],
    dependencies,
    allowedPaths: [`packages/${id}`],
    requiredChecks: ["pnpm check"],
    workflow: "feature",
    demoPath: `demo ${id}`,
    requiresHumanReview: false,
    status
  };
}

test("limits runnable DAG Tasks and waits for dependencies", () => {
  const a = task("a", "READY");
  const b = task("b", "PENDING", [a.taskId]);
  const c = task("c", "READY");
  const d = task("d", "READY");
  assert.deepEqual(
    selectRunnableTasks([a, b, c, d], new Set([c.taskId]), 2).map((item) => item.taskId),
    [a.taskId]
  );
  assert.throws(() => selectRunnableTasks([a], new Set(), 0), /parallelism/);
});

test("blocks overlapping paths in shared workspaces but allows isolated worktrees", () => {
  const locks = new PathLockManager();
  locks.acquire({ owner: "run-a", paths: ["packages/runtime"] });
  assert.throws(
    () => locks.acquire({ owner: "run-b", paths: ["packages/runtime/src"] }),
    CoordinationError
  );
  locks.release("run-a");
  locks.acquire({ owner: "run-a", paths: ["packages/runtime"], isolationId: "worktree-a" });
  locks.acquire({ owner: "run-b", paths: ["packages/runtime/src"], isolationId: "worktree-b" });
  assert.equal(locks.list().length, 2);
});

test("validates traceable worker output and forbids nested full-plan delegation", () => {
  const assignment = {
    runId: "run_a" as EntityId,
    taskId: "task_a" as EntityId,
    owner: "worker-a",
    branch: "codex/task-a",
    worktree: "D:/worktrees/task-a",
    baseCommit: "abc",
    lockOwner: "run-a",
    allowedPaths: ["packages/runtime"],
    requiredChecks: ["pnpm check"]
  } as const;
  const output = validateWorkerOutput(assignment, {
    runId: assignment.runId,
    taskId: assignment.taskId,
    contextPackPath: ".vpr/context/task-a.json",
    commit: "def",
    changedPaths: ["packages/runtime/src/orchestration.ts"],
    checks: [{ id: "pnpm check", status: "passed", snapshotHash: "snap" }],
    diffSnapshotHash: "snap",
    reviewSnapshotHash: "snap",
    delegatedFullPlan: false
  });
  assert.equal(output.valid, true);
  assert.throws(() => validateWorkerOutput(assignment, {
    runId: assignment.runId,
    taskId: assignment.taskId,
    contextPackPath: ".vpr/context/task-a.json",
    commit: "def",
    changedPaths: ["packages/core/outside.ts"],
    checks: [{ id: "pnpm check", status: "passed", snapshotHash: "snap" }],
    diffSnapshotHash: "snap",
    reviewSnapshotHash: "snap",
    delegatedFullPlan: false
  }), /allowed paths/);
  assert.throws(() => validateWorkerOutput(assignment, {
    runId: assignment.runId,
    taskId: assignment.taskId,
    contextPackPath: ".vpr/context/task-a.json",
    commit: "def",
    changedPaths: [],
    checks: [{ id: "pnpm check", status: "passed", snapshotHash: "snap" }],
    diffSnapshotHash: "snap",
    reviewSnapshotHash: "snap",
    delegatedFullPlan: true
  }), /orchestrator/);
});

test("integration asks for help before discarding work and cleanup preserves dirty trees", () => {
  assert.deepEqual(assessIntegration({
    assignmentBaseCommit: "abc",
    currentBaseCommit: "changed",
    conflicts: ["packages/runtime/src/index.ts"],
    resolutionMayDiscardWork: true
  }), {
    status: "needs-help",
    reason: "Integration conflict or moved base may discard worker changes."
  });
  assert.deepEqual(assessCleanup({ integrated: false, dirty: true, untrackedPaths: ["notes.txt"] }), {
    action: "preserve",
    reason: "Worktree has unintegrated or uncommitted work."
  });
  assert.equal(assessCleanup({ integrated: true, dirty: false, untrackedPaths: [] }).action, "remove");
});

test("persists assignment, validated worker commit and integrated commit", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-orchestration-"));
  const storage = new SqliteStorage(join(root, "events.sqlite"));
  await storage.initialize();
  context.after(async () => {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  });
  let id = 0;
  const registry = new OrchestrationRegistry({
    projectId: "project_orchestration" as EntityId,
    storage,
    actor: "coordinator",
    now: () => "2026-11-09T16:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}` as EntityId
  });
  const assignment = {
    runId: "run_trace" as EntityId,
    taskId: "task_trace" as EntityId,
    owner: "worker-a",
    branch: "codex/trace",
    worktree: "D:/worktrees/trace",
    baseCommit: "abc",
    lockOwner: "run-trace",
    allowedPaths: ["packages/runtime"],
    requiredChecks: ["pnpm check"]
  } as const;
  await registry.register(assignment);
  await registry.recordOutput({
    runId: assignment.runId,
    taskId: assignment.taskId,
    contextPackPath: ".vpr/context/trace.json",
    commit: "worker123",
    changedPaths: ["packages/runtime/src/orchestration.ts"],
    checks: [{ id: "pnpm check", status: "passed", snapshotHash: "snap" }],
    diffSnapshotHash: "snap",
    reviewSnapshotHash: "snap",
    delegatedFullPlan: false
  });
  await registry.markIntegrated(assignment.runId, "main456");
  assert.deepEqual(await registry.get(assignment.runId), {
    assignment,
    status: "integrated",
    workerCommit: "worker123",
    integratedCommit: "main456"
  });
});
