import assert from "node:assert/strict";
import test from "node:test";

import type {
  DomainEvent,
  EntityId,
  ProcessRunner,
  Run,
  StorageAdapter
} from "@vpr/contracts";

import { executeCheckRun } from "./execute-check.js";

class MemoryStorage implements StorageAdapter {
  public readonly events: DomainEvent[] = [];
  async initialize(): Promise<void> {}
  async appendEvent(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
  async readEvents(projectId: EntityId): Promise<readonly DomainEvent[]> {
    return this.events.filter((event) => event.projectId === projectId);
  }
  async close(): Promise<void> {}
}

const run: Run = {
  runId: "run_vertical",
  taskId: "task_vertical",
  state: "PENDING",
  revision: 0,
  createdAt: "2026-11-09T12:00:00.000Z",
  updatedAt: "2026-11-09T12:00:00.000Z"
};

test("completes a Run and persists redacted evidence for a passing check", async () => {
  const storage = new MemoryStorage();
  const processRunner: ProcessRunner = async () => ({
    exitCode: 0,
    durationMs: 12,
    stdout: "ok token=super-secret-value",
    stderr: "",
    outputTruncated: false,
    timedOut: false,
    cancelled: false
  });

  const result = await executeCheckRun({
    projectId: "project_vertical",
    storyId: "story_vertical",
    run,
    actor: "test",
    checkName: "unit",
    request: {
      program: process.execPath,
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    },
    processRunner,
    storage,
    now: (() => {
      let tick = 0;
      return () => `2026-11-09T12:00:${String(++tick).padStart(2, "0")}.000Z`;
    })(),
    nextId: (() => {
      let id = 0;
      return (prefix) => `${prefix}_${++id}` as EntityId;
    })()
  });

  assert.equal(result.run.state, "COMPLETED");
  assert.match(result.evidence.summary, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(storage.events), /super-secret-value/);
  assert.deepEqual(
    storage.events.filter((event) => event.type === "RunStateChanged").map((event) => event.payload),
    [
      { from: "PENDING", to: "ANALYZING" },
      { from: "ANALYZING", to: "READY" },
      { from: "READY", to: "RUNNING" },
      { from: "RUNNING", to: "VALIDATING" },
      { from: "VALIDATING", to: "REVIEW" },
      { from: "REVIEW", to: "COMPLETED" }
    ]
  );
});

test("fails the Run when check output is truncated", async () => {
  const storage = new MemoryStorage();
  const result = await executeCheckRun({
    projectId: "project_vertical",
    storyId: "story_vertical",
    run,
    actor: "test",
    checkName: "unit",
    request: {
      program: process.execPath,
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    },
    processRunner: async () => ({
      exitCode: 0,
      durationMs: 12,
      stdout: "partial",
      stderr: "",
      outputTruncated: true,
      timedOut: false,
      cancelled: false
    }),
    storage,
    now: () => "2026-11-09T12:01:00.000Z",
    nextId: (prefix) => `${prefix}_fixed` as EntityId
  });

  assert.equal(result.run.state, "FAILED");
  assert.equal(result.evidence.outputTruncated, true);
});

