import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeProviderStatus, NativeAgentRequest } from "@vpr/runtime";
import { runAgentCommand } from "./agent-command.js";

async function fixture(context: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "vpr-native-flow-unit-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vpr"));
  const previous = process.env.VPR_GLOBAL_PROFILE;
  process.env.VPR_GLOBAL_PROFILE = join(root, "absent-global.json");
  context.after(async () => {
    if (previous === undefined) delete process.env.VPR_GLOBAL_PROFILE;
    else process.env.VPR_GLOBAL_PROFILE = previous;
  });
  await writeFile(
    join(root, ".vpr/profile.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectId: "project_unit_flow",
      name: "unit",
      packageManager: "unknown",
      checks: { gate: { program: process.execPath, args: ["gate.mjs"] } },
      glossaryPath: "GLOSSARY.md",
      policy: { allowShell: true, allowedProviders: ["local", "claude"] },
      orchestration: {
        orchestratorId: "light",
        maxWorkers: 1,
        allowLightCoding: true,
        objective: "reference-cost",
        models: [
          {
            id: "light",
            provider: "claude",
            model: "claude-haiku-5-5",
            tier: "light",
            roles: ["coding", "orchestrator"],
          },
          {
            id: "reviewer",
            provider: "claude",
            model: "claude-sonnet-5-5",
            tier: "standard",
            roles: ["review"],
          },
        ],
      },
    }),
  );
  await writeFile(
    join(root, "gate.mjs"),
    "import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(readFileSync('value.txt','utf8'),'correct');",
  );
  const task = join(root, "task.json");
  await writeFile(
    task,
    JSON.stringify({
      title: "Unit orchestration only",
      prompt: "Correct value.txt",
      kind: "bugfix",
      complexity: "simple",
      risk: "low",
      needsPlanning: false,
      reviewerId: "reviewer",
      allowedPaths: ["value.txt"],
      requiredChecks: ["gate"],
    }),
  );
  const status: NativeProviderStatus = {
    provider: "claude",
    status: "ready",
    accountKey: null,
    models: [
      {
        model: "claude-haiku-5-5",
        supportedEfforts: ["medium"],
        access: "listed",
      },
      {
        model: "claude-sonnet-5-5",
        supportedEfforts: ["medium"],
        access: "listed",
      },
    ],
    quota: "available",
    reason: "unit test double, no provider request",
    observedAt: new Date().toISOString(),
    inferenceTokens: 0,
  };
  let output = "";
  const io = {
    stdout: (value: string) => {
      output += value;
    },
    stderr: () => {},
  };
  return { root, task, status, io, output: () => JSON.parse(output) };
}

test("native orchestration performs one repair after real failed checks, rechecks, and exposes review without persisting it", async (context) => {
  const f = await fixture(context);
  const calls: string[] = [];
  const result = await runAgentCommand(["run", "--project", f.root, "--input", f.task], f.io, {
    inspectProvider: async () => f.status,
    runNativeAgent: async (request) => {
      calls.push(request.phase);
      if (request.writeFiles)
        await writeFile(
          join(f.root, "value.txt"),
          request.phase === "repair" ? "correct" : "incorrect",
        );
      if (request.phase === "repair") assert.match(request.prompt, /gate failed/);
      return {
        success: true,
        answer:
          request.phase === "review"
            ? "review summary visible only to the caller"
            : "unit execution double",
        model: request.model.model,
        usage: [],
        wallMs: 0,
        failure: null,
      };
    },
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, ["implement", "repair", "review"]);
  const receipt = f.output();
  assert.deepEqual(
    receipt.checks.map((r: { passed: boolean }) => r.passed),
    [false, true],
  );
  assert.equal(receipt.state, "CHECKED_AWAITING_REVIEW");
  assert.match(receipt.reviewSummary, /visible only/);
  const stored = await readFile(receipt.receipt, "utf8");
  assert.ok(!stored.includes("visible only"));
  assert.ok(!stored.includes("Correct value.txt"));
  await assert.rejects(access(join(f.root, ".vpr/native-run.lock")));
});

test("native orchestration caps repairs at one and refuses an overlapping run before dispatch", async (context) => {
  const f = await fixture(context);
  let calls = 0;
  const services = {
    inspectProvider: async () => f.status,
    runNativeAgent: async (request: NativeAgentRequest) => {
      calls++;
      await writeFile(join(f.root, "value.txt"), "still incorrect");
      return {
        success: true,
        answer: "unit double",
        model: request.model.model,
        usage: [],
        wallMs: 0,
        failure: null,
      };
    },
  };
  assert.equal(
    await runAgentCommand(["run", "--project", f.root, "--input", f.task], f.io, services),
    1,
  );
  assert.equal(calls, 2);
  assert.equal(f.output().state, "CHECKS_FAILED");
  await writeFile(join(f.root, ".vpr/native-run.lock"), '{"runId":"other-owner"}');
  await assert.rejects(
    runAgentCommand(["run", "--project", f.root, "--input", f.task], f.io, services),
    /Another native run/,
  );
  assert.equal(calls, 2);
});

test("an actor cannot obtain green checks by replacing their check script or modifying unrelated user work", async (context) => {
  const f = await fixture(context);
  let calls = 0;
  await writeFile(join(f.root, "owner.txt"), "OWNER CONTENT");
  const code = await runAgentCommand(["run", "--project", f.root, "--input", f.task], f.io, {
    inspectProvider: async () => f.status,
    runNativeAgent: async (request) => {
      calls++;
      await writeFile(join(f.root, "gate.mjs"), "process.exit(0);");
      await writeFile(join(f.root, "owner.txt"), "changed outside scope");
      return {
        success: true,
        answer: "unit double, not a model execution",
        model: request.model.model,
        usage: [],
        wallMs: 0,
        failure: null,
      };
    },
  });
  assert.equal(code, 1);
  assert.equal(calls, 1);
  assert.equal(f.output().state, "SCOPE_CHANGED");
  assert.deepEqual(f.output().checks, []);
  assert.ok(f.output().workspace.rejectedPaths.includes("gate.mjs"));
  assert.ok(f.output().workspace.rejectedPaths.includes("owner.txt"));
  assert.equal(await readFile(join(f.root, "owner.txt"), "utf8"), "changed outside scope");
});

test("the overall deadline aborts the actor and releases its project lock without running checks", async (context) => {
  const f = await fixture(context),
    task = JSON.parse(await readFile(f.task, "utf8"));
  task.phaseTimeoutMs = 1000;
  task.totalTimeoutMs = 1000;
  await writeFile(f.task, JSON.stringify(task));
  let calls = 0;
  const code = await runAgentCommand(["run", "--project", f.root, "--input", f.task], f.io, {
    inspectProvider: async () => f.status,
    runNativeAgent: async (request) => {
      calls++;
      await new Promise<void>((done) =>
        request.signal!.addEventListener("abort", () => done(), {
          once: true,
        }),
      );
      return {
        success: false,
        answer: "",
        model: request.model.model,
        usage: [],
        wallMs: 1000,
        failure: "cancelled",
      };
    },
  });
  assert.equal(code, 1);
  assert.equal(calls, 1);
  assert.equal(f.output().state, "DEADLINE");
  assert.deepEqual(f.output().checks, []);
  await assert.rejects(access(join(f.root, ".vpr/native-run.lock")));
});

const preselectionModels = [
  {
    id: "light",
    provider: "claude",
    model: "claude-haiku-5-5",
    tier: "light",
    roles: ["coding", "inventory"],
  },
  {
    id: "standard",
    provider: "claude",
    model: "claude-sonnet-5-5",
    tier: "standard",
    roles: ["orchestrator", "coding", "review"],
  },
  {
    id: "advanced",
    provider: "claude",
    model: "claude-opus-5-5",
    tier: "high",
    roles: ["orchestrator", "coding", "review"],
  },
  {
    id: "codex-standard",
    provider: "codex",
    model: "gpt-5-codex",
    tier: "standard",
    roles: ["coding", "review"],
  },
];

async function previewDecision(
  context: { after: (fn: () => Promise<unknown>) => void },
  taskOverrides: Record<string, unknown>,
  limitedProviders: readonly string[] = [],
) {
  const f = await fixture(context);
  const profilePath = join(f.root, ".vpr/profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.policy.allowedProviders = ["claude", "codex"];
  profile.orchestration.orchestratorId = "standard";
  profile.orchestration.models = preselectionModels;
  await writeFile(profilePath, JSON.stringify(profile));
  await writeFile(
    f.task,
    JSON.stringify({
      title: "Preselection",
      prompt: "Correct value.txt",
      kind: "bugfix",
      allowedPaths: ["value.txt"],
      requiredChecks: ["gate"],
      ...taskOverrides,
    }),
  );
  const statusFor = (provider: "claude" | "codex"): NativeProviderStatus => ({
    ...f.status,
    provider,
    models: preselectionModels
      .filter((model) => model.provider === provider)
      .map((model) => ({
        model: model.model,
        supportedEfforts: ["medium"],
        access: "listed" as const,
      })),
    quota: limitedProviders.includes(provider) ? "limit-reached" : "available",
    observedAt: new Date().toISOString(),
  });
  const code = await runAgentCommand(["detect", "--project", f.root, "--input", f.task], f.io, {
    inspectProvider: async (provider) => statusFor(provider as "claude" | "codex"),
    runNativeAgent: async () => {
      throw Error("preview must not dispatch");
    },
  });
  const { decision } = f.output();
  return {
    code,
    status: decision.status,
    mode: decision.mode,
    plannerId: decision.plannerId,
    technicalPlannerId: decision.technicalPlannerId,
    executorId: decision.executorId,
    reviewerId: decision.reviewerId,
    workerCount: decision.workerCount,
    phases: decision.phases,
    candidates: decision.candidates.map(
      (row: Record<string, unknown>) =>
        `${row.plannerId}|${row.technicalPlannerId}|${row.reviewerId}|${row.executorId}`,
    ),
    quotaChecks: decision.quotaChecks.map((row: Record<string, unknown>) => [
      row.provider,
      row.state,
      row.source,
    ]),
  };
}

test("preview preselects planner, executor and reviewer from capabilities when the task names none", async (context) => {
  assert.deepEqual(await previewDecision(context, {}), {
    code: 0,
    status: "rule-based",
    mode: "plan-implement-review",
    plannerId: "standard",
    technicalPlannerId: null,
    executorId: "light",
    reviewerId: "standard",
    workerCount: 1,
    phases: [
      { phase: "plan", modelId: "standard", writeFiles: false },
      { phase: "implement", modelId: "light", writeFiles: true },
      { phase: "review", modelId: "standard", writeFiles: false },
    ],
    candidates: [
      "standard|null|standard|light",
      "standard|null|standard|codex-standard",
      "standard|null|standard|standard",
      "standard|null|standard|advanced",
    ],
    quotaChecks: [
      ["claude", "available", "provider_reported"],
      ["codex", "available", "provider_reported"],
    ],
  });
});

test("preview keeps explicit planner and preferred executor ids from the task", async (context) => {
  assert.deepEqual(
    await previewDecision(context, {
      plannerId: "advanced",
      preferredExecutorId: "codex-standard",
      currentModelId: "standard",
      complexity: "normal",
      risk: "medium",
      needsPlanning: true,
    }),
    {
      code: 0,
      status: "rule-based",
      mode: "plan-implement-review",
      plannerId: "advanced",
      technicalPlannerId: null,
      executorId: "codex-standard",
      reviewerId: "advanced",
      workerCount: 1,
      phases: [
        { phase: "plan", modelId: "advanced", writeFiles: false },
        { phase: "implement", modelId: "codex-standard", writeFiles: true },
        { phase: "review", modelId: "advanced", writeFiles: false },
      ],
      candidates: [
        "advanced|null|advanced|codex-standard",
        "advanced|null|advanced|light",
        "advanced|null|advanced|standard",
        "advanced|null|advanced|advanced",
      ],
      quotaChecks: [
        ["claude", "available", "provider_reported"],
        ["codex", "available", "provider_reported"],
      ],
    },
  );
});

test("preview excludes a provider that reached its limit", async (context) => {
  assert.deepEqual(
    await previewDecision(
      context,
      {
        complexity: "normal",
        risk: "medium",
        needsPlanning: false,
        preferredExecutorId: "codex-standard",
      },
      ["codex"],
    ),
    {
      code: 0,
      status: "rule-based",
      mode: "direct-current",
      plannerId: null,
      technicalPlannerId: null,
      executorId: "standard",
      reviewerId: null,
      workerCount: 0,
      phases: [{ phase: "implement", modelId: "standard", writeFiles: true }],
      candidates: [
        "null|null|null|standard",
        "null|null|null|advanced",
        "standard|null|standard|light",
        "standard|null|standard|standard",
        "standard|null|standard|advanced",
      ],
      quotaChecks: [
        ["claude", "available", "provider_reported"],
        ["codex", "limit-reached", "provider_reported"],
      ],
    },
  );
});

test("preview sends a simple low-risk checked task to the light coding model", async (context) => {
  assert.deepEqual(
    await previewDecision(context, {
      complexity: "simple",
      risk: "low",
      needsPlanning: false,
    }),
    {
      code: 0,
      status: "rule-based",
      mode: "direct-worker",
      plannerId: null,
      technicalPlannerId: null,
      executorId: "light",
      reviewerId: null,
      workerCount: 1,
      phases: [{ phase: "implement", modelId: "light", writeFiles: true }],
      candidates: [
        "null|null|null|light",
        "null|null|null|codex-standard",
        "null|null|null|standard",
        "null|null|null|advanced",
        "standard|null|standard|light",
        "standard|null|standard|codex-standard",
        "standard|null|standard|standard",
        "standard|null|standard|advanced",
      ],
      quotaChecks: [
        ["claude", "available", "provider_reported"],
        ["codex", "available", "provider_reported"],
      ],
    },
  );
});

test("preview of a complex high-risk task uses the advanced planner", async (context) => {
  assert.deepEqual(
    await previewDecision(context, {
      complexity: "complex",
      risk: "high",
      needsPlanning: true,
    }),
    {
      code: 0,
      status: "rule-based",
      mode: "plan-implement-review",
      plannerId: "advanced",
      technicalPlannerId: null,
      executorId: "light",
      reviewerId: "advanced",
      workerCount: 1,
      phases: [
        { phase: "plan", modelId: "advanced", writeFiles: false },
        { phase: "implement", modelId: "light", writeFiles: true },
        { phase: "review", modelId: "advanced", writeFiles: false },
      ],
      candidates: [
        "advanced|null|advanced|light",
        "advanced|null|advanced|codex-standard",
        "advanced|null|advanced|standard",
        "advanced|null|advanced|advanced",
      ],
      quotaChecks: [
        ["claude", "available", "provider_reported"],
        ["codex", "available", "provider_reported"],
      ],
    },
  );
});
