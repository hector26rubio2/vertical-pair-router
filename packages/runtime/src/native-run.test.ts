import assert from "node:assert/strict";
import test from "node:test";

import type { AgentModel } from "@vpr/core";

import type { NativeAgentRequest, NativeAgentResult } from "./native-agent.js";
import {
  executeNativeRun,
  type NativeCheckOutcome,
  type NativeRunInput,
  type NativeRunPorts,
  type NativeRunReceipt,
} from "./native-run.js";

const model = {
  id: "worker",
  provider: "claude",
  model: "claude-test",
  tier: "light",
  roles: ["coding", "review"],
} as unknown as AgentModel;

interface Phase {
  phase: string;
  modelId: string;
  writeFiles: boolean;
}

function phase(name: string, writeFiles: boolean): Phase {
  return { phase: name, modelId: "worker", writeFiles };
}

function input(phases: Phase[], overrides: Partial<NativeRunInput> = {}, retries = 1): NativeRunInput {
  return {
    runId: "run-1",
    cwd: "/project",
    decision: { phases, maxImplementationRetries: retries } as unknown as NativeRunInput["decision"],
    statuses: [],
    models: [model],
    role: "coding",
    prompt: "Do the task",
    title: "Task title",
    requiredChecks: ["gate"],
    allowedPaths: ["src"],
    allowShell: true,
    phaseTimeoutMs: 1000,
    ...overrides,
  };
}

const passing: NativeCheckOutcome = {
  exitCode: 0,
  timedOut: false,
  cancelled: false,
  outputTruncated: false,
  durationMs: 1,
  stdout: "",
  stderr: "",
};

const failing: NativeCheckOutcome = { ...passing, exitCode: 1, stderr: "assertion failed" };

function answer(text: string, success = true): NativeAgentResult {
  return { success, answer: text, model: "claude-test", usage: [], wallMs: 1, failure: success ? null : "failed" };
}

function harness(overrides: Partial<NativeRunPorts> = {}) {
  const files = new Map<string, string>([
    ["src/a.ts", "one"],
    [".vpr/profile.json", "profile"],
  ]);
  const controller = new AbortController();
  const requests: NativeAgentRequest[] = [];
  const saved: NativeRunReceipt[] = [];
  const ports: NativeRunPorts = {
    signal: controller.signal,
    deadlineReached: () => false,
    runAgent: async (request) => {
      requests.push(request);
      return answer("ok");
    },
    runCheck: async () => passing,
    resolveProtectedPaths: async () => [".vpr/profile.json"],
    snapshotWorkspace: async () => new Map(files),
    graphContext: async () => ({ state: "disabled", text: "", inferenceTokens: 0 }),
    hasSecret: () => false,
    saveReceipt: async (receipt) => {
      saved.push(JSON.parse(JSON.stringify(receipt)));
    },
    ...overrides,
  };
  return { files, controller, requests, saved, ports };
}

test("coding run with passing checks awaits review and records retrieval", async () => {
  const h = harness();
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "CHECKED_AWAITING_REVIEW");
  assert.deepEqual(receipt.retrieval, { state: "disabled", inferenceTokens: 0, characters: 0 });
  assert.equal(receipt.checks.length, 1);
  assert.equal(h.requests[0]?.task, "Task title");
  assert.equal(h.requests[0]?.cwd, "/project");
  assert.deepEqual(h.saved.at(-1), JSON.parse(JSON.stringify(receipt)));
});

test("non-coding run finishes after read-only phases and returns the review summary", async () => {
  const h = harness({ runAgent: async () => answer("looks fine") });
  const outcome = await executeNativeRun(
    input([phase("review", false)], { role: "review" }),
    h.ports,
  );
  assert.equal(outcome.receipt.state, "FINISHED");
  assert.equal(outcome.reviewSummary, "looks fine");
  assert.equal(outcome.receipt.checks.length, 0);
});

test("one repair after failed checks recovers and rechecks with executed feedback", async () => {
  let checks = 0;
  const h = harness({ runCheck: async () => (checks++ === 0 ? failing : passing) });
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "CHECKED_AWAITING_REVIEW");
  assert.deepEqual(
    h.requests.map((request) => request.phase),
    ["implement", "repair"],
  );
  assert.match(h.requests[1]?.prompt ?? "", /gate failed\. [\s\S]*assertion failed/u);
  assert.deepEqual(
    receipt.checks.map((check) => (check as { passed: boolean; attempt: number }).attempt),
    [0, 1],
  );
});

test("failed repair checks end in CHECKS_FAILED after exactly one repair", async () => {
  const h = harness({ runCheck: async () => failing });
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "CHECKS_FAILED");
  assert.equal(h.requests.filter((request) => request.phase === "repair").length, 1);
});

test("no repair is attempted when retries are disabled", async () => {
  const h = harness({ runCheck: async () => failing });
  const { receipt } = await executeNativeRun(input([phase("implement", true)], {}, 0), h.ports);
  assert.equal(receipt.state, "CHECKS_FAILED");
  assert.deepEqual(
    h.requests.map((request) => request.phase),
    ["implement"],
  );
});

test("unsuccessful repair agent ends INCOMPLETE", async () => {
  const h = harness({
    runCheck: async () => failing,
    runAgent: async (request) => answer("x", request.phase !== "repair"),
  });
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "INCOMPLETE");
});

test("sensitive check output is withheld from repair feedback", async () => {
  const h = harness({
    runCheck: async () => ({ ...failing, stderr: "token=abc" }),
    hasSecret: (output) => output.includes("token="),
  });
  await executeNativeRun(input([phase("implement", true)]), h.ports);
  const prompt = h.requests[1]?.prompt ?? "";
  assert.match(prompt, /Output withheld: sensitive pattern detected\./u);
  assert.ok(!prompt.includes("token=abc"));
});

test("oversized plan handoff stops the run", async () => {
  const h = harness({ runAgent: async () => answer("x".repeat(24000)) });
  const { receipt } = await executeNativeRun(
    input([phase("plan", false), phase("implement", true)]),
    h.ports,
  );
  assert.equal(receipt.state, "HANDOFF_TOO_LARGE");
  assert.equal(receipt.phases.length, 1);
});

test("truncated plan answer stops the run", async () => {
  const h = harness({ runAgent: async () => ({ ...answer("short"), answerTruncated: true }) });
  const { receipt } = await executeNativeRun(input([phase("plan", false)]), h.ports);
  assert.equal(receipt.state, "HANDOFF_TOO_LARGE");
});

test("plan handoff is passed to the implementation phase", async () => {
  const prompts: string[] = [];
  const h = harness({
    runAgent: async (request) => {
      prompts.push(request.prompt);
      return answer(request.phase === "plan" ? "step list" : "ok");
    },
  });
  await executeNativeRun(input([phase("plan", false), phase("implement", true)]), h.ports);
  assert.match(prompts[1] ?? "", /step list/u);
});

test("write outside allowed paths after a phase is SCOPE_CHANGED", async () => {
  const h = harness();
  h.ports = {
    ...h.ports,
    runAgent: async () => {
      h.files.set("outside.ts", "new");
      return answer("ok");
    },
  };
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "SCOPE_CHANGED");
  assert.deepEqual(receipt.workspace?.rejectedPaths, ["outside.ts"]);
  assert.equal(h.requests.length, 0);
});

test("protected file changed by checks is SCOPE_CHANGED", async () => {
  const h = harness();
  h.ports = {
    ...h.ports,
    runCheck: async () => {
      h.files.set(".vpr/profile.json", "tampered");
      return passing;
    },
  };
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "SCOPE_CHANGED");
  assert.deepEqual(receipt.workspace?.rejectedPaths, [".vpr/profile.json"]);
});

test("failed agent without abort is INCOMPLETE", async () => {
  const h = harness({ runAgent: async () => answer("", false) });
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "INCOMPLETE");
  assert.equal(receipt.checks.length, 0);
});

test("abort during a phase is CANCELLED", async () => {
  const h = harness();
  h.ports = {
    ...h.ports,
    runAgent: async () => {
      h.controller.abort();
      return answer("", false);
    },
  };
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "CANCELLED");
});

test("abort before the next phase is CANCELLED", async () => {
  const h = harness();
  h.ports = {
    ...h.ports,
    runAgent: async () => {
      h.controller.abort();
      return answer("ok");
    },
  };
  const { receipt } = await executeNativeRun(
    input([phase("plan", false), phase("implement", true)]),
    h.ports,
  );
  assert.equal(receipt.state, "CANCELLED");
  assert.equal(receipt.phases.length, 1);
});

test("abort during checks is CANCELLED and skips repair", async () => {
  const h = harness();
  h.ports = {
    ...h.ports,
    runCheck: async () => {
      h.controller.abort();
      return { ...failing, cancelled: true };
    },
  };
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "CANCELLED");
  assert.equal(h.requests.length, 1);
});

test("deadline overrides the final state and is saved", async () => {
  const h = harness();
  h.ports = {
    ...h.ports,
    deadlineReached: () => true,
    runAgent: async () => {
      h.controller.abort();
      return answer("", false);
    },
  };
  const { receipt } = await executeNativeRun(input([phase("implement", true)]), h.ports);
  assert.equal(receipt.state, "DEADLINE");
  assert.equal(h.saved.at(-1)?.state, "DEADLINE");
});

test("thrown port error ends INCOMPLETE and codex without shell permission is rejected", async () => {
  const broken = harness({
    snapshotWorkspace: async () => {
      throw new Error("snapshot failed");
    },
  });
  const first = await executeNativeRun(input([phase("implement", true)]), broken.ports);
  assert.equal(first.receipt.state, "INCOMPLETE");
  const codex = { ...model, provider: "codex" } as unknown as AgentModel;
  const h = harness();
  const second = await executeNativeRun(
    input([phase("implement", true)], { models: [codex], allowShell: false }),
    h.ports,
  );
  assert.equal(second.receipt.state, "INCOMPLETE");
  assert.equal(h.requests.length, 0);
});
