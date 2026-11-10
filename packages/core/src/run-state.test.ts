import assert from "node:assert/strict";
import test from "node:test";

import type { Run } from "@vpr/contracts";

import {
  InvalidRunTransitionError,
  transitionRun,
  transitionRunIdempotent
} from "./run-state.js";

const baseRun: Run = {
  runId: "run_001" as const,
  taskId: "task_001" as const,
  state: "PENDING" as const,
  revision: 0,
  createdAt: "2026-11-09T12:00:00.000Z",
  updatedAt: "2026-11-09T12:00:00.000Z"
};

test("advances through the complete happy path", () => {
  const states = [
    "ANALYZING",
    "READY",
    "RUNNING",
    "VALIDATING",
    "REVIEW",
    "COMPLETED"
  ] as const;

  const completed = states.reduce<Run>(
    (run, state, index) =>
      transitionRun(run, state, `2026-11-09T12:00:0${index + 1}.000Z`),
    baseRun
  );

  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.revision, 6);
});

test("rejects skipping required validation and review states", () => {
  assert.throws(
    () => transitionRun(baseRun, "COMPLETED", "2026-11-09T12:01:00.000Z"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidRunTransitionError);
      assert.equal(error.from, "PENDING");
      assert.equal(error.to, "COMPLETED");
      return true;
    }
  );
});

test("requires approval to resume through ANALYZING", () => {
  const waiting = transitionRun(baseRun, "NEEDS_APPROVAL", "2026-11-09T12:01:00.000Z");
  const resumed = transitionRun(waiting, "ANALYZING", "2026-11-09T12:02:00.000Z");

  assert.equal(resumed.state, "ANALYZING");
  assert.equal(resumed.revision, 2);
});

test("terminal states cannot transition", () => {
  const failed = transitionRun(baseRun, "FAILED", "2026-11-09T12:01:00.000Z");

  assert.throws(() =>
    transitionRun(failed, "ANALYZING", "2026-11-09T12:02:00.000Z")
  );
});

test("repeating an already-observed state is idempotent", () => {
  const analyzing = transitionRun(baseRun, "ANALYZING", "2026-11-09T12:01:00.000Z");
  assert.equal(
    transitionRunIdempotent(analyzing, "ANALYZING", "2026-11-09T12:02:00.000Z"),
    analyzing
  );
});

