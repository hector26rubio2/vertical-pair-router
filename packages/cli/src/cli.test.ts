import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "./cli.js";

test("workflow proposal uses local rules and cannot widen project provider policy", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-workflow-plan-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vpr"));
  const models = [
    {
      id: "haiku",
      provider: "claude",
      model: "claude-haiku-5-5",
      tier: "light",
      roles: ["coding"],
    },
    {
      id: "sonnet",
      provider: "claude",
      model: "claude-sonnet-5-5",
      tier: "standard",
      roles: ["orchestrator", "coding", "review"],
    },
    { id: "opus", provider: "claude", model: "claude-opus-5-5", tier: "high", roles: ["review"] },
    { id: "terra", provider: "codex", model: "gpt-6.1-terra", tier: "standard", roles: ["coding"] },
  ];
  await writeFile(
    join(root, ".vpr/profile.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectId: "project_workflow",
      name: "workflow",
      packageManager: "unknown",
      checks: {},
      glossaryPath: "GLOSSARY.md",
      policy: { allowedProviders: ["claude"] },
      orchestration: {
        objective: "reference-cost",
        orchestratorId: "sonnet",
        maxWorkers: 1,
        allowLightCoding: true,
        models,
      },
    }),
  );
  const input = join(root, "request.json"),
    request = {
      kind: "feature",
      taskSignature: "feature-v1",
      complexity: "simple",
      risk: "low",
      hasAcceptanceChecks: true,
      needsPlanning: false,
      currentModelId: "sonnet",
      preferredExecutorId: "haiku",
      plannerId: "sonnet",
      advancedPlannerId: "opus",
      allowedProviders: ["claude", "codex"],
      verifiedModelIds: ["haiku", "sonnet", "opus", "terra"],
      history: [],
      now: "2026-11-16",
    };
  await writeFile(input, JSON.stringify(request));
  let output = "";
  const io = {
    stdout: (text: string) => {
      output += text;
    },
    stderr: (text: string) => {
      output += text;
    },
  };
  assert.equal(await runCli(["models", "plan", "--project", root, "--input", input], io), 0);
  const decision = JSON.parse(output) as {
    executorId: string;
    plannerId: null;
    decisionInferenceTokens: number;
    dispatchPerformed: boolean;
  };
  assert.equal(decision.executorId, "haiku");
  assert.equal(decision.plannerId, null);
  assert.equal(decision.decisionInferenceTokens, 0);
  assert.equal(decision.dispatchPerformed, false);
  await writeFile(
    input,
    JSON.stringify({ ...request, preferredExecutorId: "terra", needsPlanning: true }),
  );
  output = "";
  assert.equal(await runCli(["models", "plan", "--project", root, "--input", input], io), 3);
  assert.equal((JSON.parse(output) as { status: string }).status, "blocked");
  await mkdir(join(root, ".vpr/benchmarks"));
  const rows = Array.from({ length: 3 }, (_, index) => [
    {
      caseId: "direct-" + index,
      taskKind: "feature",
      taskSignature: "feature-v1",
      complexity: "normal",
      risk: "low",
      plannerId: null,
      executorId: "claude-sonnet-5-5",
      executorProvider: "claude",
      executorEffort: "medium",
      accepted: true,
      modelConfirmed: true,
      completeAccounting: true,
      usdMax: 0.05,
      pricesExpireAt: "2099-01-01",
    },
    {
      caseId: "planned-" + index,
      taskKind: "feature",
      taskSignature: "feature-v1",
      complexity: "normal",
      risk: "low",
      plannerId: "claude-sonnet-5-5",
      executorId: "claude-haiku-5-5",
      plannerProvider: "claude",
      executorProvider: "claude",
      plannerEffort: "medium",
      executorEffort: "medium",
      accepted: true,
      modelConfirmed: true,
      completeAccounting: true,
      usdMax: 0.01,
      pricesExpireAt: "2099-01-01",
    },
  ]).flat();
  await writeFile(join(root, ".vpr/benchmarks/workflow-cases.json"), JSON.stringify({ rows }));
  await writeFile(input, JSON.stringify({ ...request, complexity: "normal" }));
  output = "";
  assert.equal(await runCli(["models", "plan", "--project", root, "--input", input], io), 0);
  const local = JSON.parse(output) as {
    status: string;
    executorId: string;
    plannerId: string;
    caseLibraryRowsLoaded: number;
  };
  assert.equal(local.status, "historical-forecast");
  assert.equal(local.executorId, "haiku");
  assert.equal(local.plannerId, "sonnet");
  assert.equal(local.caseLibraryRowsLoaded, 6);
  await writeFile(
    input,
    JSON.stringify({ ...request, complexity: "normal", taskSignature: "unrelated-task" }),
  );
  output = "";
  await runCli(["models", "plan", "--project", root, "--input", input], io);
  assert.equal((JSON.parse(output) as { status: string }).status, "rule-based");
  await writeFile(
    join(root, ".vpr/benchmarks/workflow-cases.json"),
    JSON.stringify({
      rows: rows.map((row) => ({
        ...row,
        executorProvider: "copilot",
        plannerProvider: row.plannerId ? "copilot" : null,
      })),
    }),
  );
  await writeFile(input, JSON.stringify({ ...request, complexity: "normal" }));
  output = "";
  await runCli(["models", "plan", "--project", root, "--input", input], io);
  assert.equal(
    (JSON.parse(output) as { caseLibraryRowsLoaded: number }).caseLibraryRowsLoaded,
    0,
    "same model name from another provider must not reuse Claude costs",
  );
  output = "";
  await runCli(
    [
      "models",
      "plan",
      "--project",
      root,
      "--input",
      input,
      "--capability-query",
      "revisión arquitectura compleja",
    ],
    io,
  );
  const sourced = JSON.parse(output) as {
    capabilityEvidence: { cardId: string; sources: string[] }[];
    decisionInferenceTokens: number;
  };
  assert.ok(sourced.capabilityEvidence.length > 0);
  assert.ok(
    sourced.capabilityEvidence.every(
      (item) => item.cardId.startsWith("claude-") && item.sources.length > 0,
    ),
  );
  assert.equal(sourced.decisionInferenceTokens, 0);
});

test("shows subscription plan prices separately and measures only observed quota deltas", async (context) => {
  let output = "";
  const io = {
    stdout: (value: string) => {
      output += value;
    },
    stderr: (value: string) => {
      output += value;
    },
  };
  assert.equal(await runCli(["models", "subscriptions", "--plan", "claude-pro"], io), 0);
  const catalog = JSON.parse(output) as {
    selectedPlan: { monthlyUsd: number; perModelQuotaRates: null };
    subscriptionQuotaDelta: null;
    actualAccountPlanDetected: boolean;
  };
  assert.equal(catalog.selectedPlan.monthlyUsd, 20);
  assert.equal(catalog.selectedPlan.perModelQuotaRates, null);
  assert.equal(catalog.subscriptionQuotaDelta, null);
  assert.equal(catalog.actualAccountPlanDetected, false);
  const root = await mkdtemp(join(tmpdir(), "vpr-subscription-input-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const before = {
    bucketId: "weekly",
    planId: "claude-pro",
    resetAt: "2026-11-19T00:00:00Z",
    observedAt: "2026-11-12T00:00:00Z",
    usedPercent: 5,
    source: "user_reported",
  };
  const input = join(root, "snapshots.json");
  await writeFile(
    input,
    JSON.stringify({
      before,
      after: { ...before, observedAt: "2026-11-12T00:05:00Z", usedPercent: 7 },
      isolated: true,
    }),
  );
  output = "";
  assert.equal(await runCli(["models", "quota", "--input", input], io), 0);
  assert.equal((JSON.parse(output) as { usedPercentagePoints: number }).usedPercentagePoints, 2);
});

test("queries sourced model evidence locally without inference", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-local-model-query-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let output = "";
  assert.equal(
    await runCli(["models", "query", "--project", root, "--query", "codigo simple"], {
      stdout: (value) => {
        output += value;
      },
      stderr: (value) => {
        output += value;
      },
    }),
    0,
  );
  const result = JSON.parse(output) as {
    decisionInferenceTokens: number;
    results: { card: { id: string }; sampleSize: number; accountVerified: boolean }[];
  };
  assert.equal(result.decisionInferenceTokens, 0);
  assert.equal(result.results[0]?.card.id, "claude-haiku-5-5");
  assert.ok(result.results.every((row) => row.sampleSize === 0 && !row.accountVerified));
});

test("plans a Task and persists real check evidence in the same backlog", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-task-flow-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vpr"));
  await writeFile(
    join(root, ".vpr", "profile.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectId: "project_flow",
      name: "fixture",
      packageManager: "unknown",
      glossaryPath: "GLOSSARY.md",
      checks: { test: { program: process.execPath, args: ["-e", "process.exit(0)"] } },
      policy: { allowShell: false },
    }),
  );
  const db = join(root, "events.sqlite");
  const storyFile = join(root, "story.json");
  await writeFile(
    storyFile,
    JSON.stringify({
      title: "Flow",
      need: "Run checks",
      desiredOutcome: "Persisted evidence",
      acceptanceCriteria: ["check passes"],
      exclusions: [],
      openQuestions: [],
      attachments: [],
    }),
  );
  let output = "";
  const io = {
    stdout: (value: string) => {
      output += value;
    },
    stderr: (value: string) => {
      output += value;
    },
  };
  await runCli(
    ["story", "--db", db, "--project-id", "project_flow", "--input", storyFile, "--apply"],
    io,
  );
  const storyId = (JSON.parse(output) as { story: { story: { storyId: string } } }).story.story
    .storyId;
  const planFile = join(root, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      workflow: "feature",
      slices: [
        {
          outcome: "Validate flow",
          acceptanceCriteria: ["test passes"],
          demoPath: "test",
          allowedPaths: ["src"],
          requiredChecks: ["test"],
          risk: "low",
          changesPublicApi: false,
          dependsOn: [],
        },
      ],
    }),
  );
  output = "";
  assert.equal(
    await runCli(
      [
        "task",
        "plan",
        "--project",
        root,
        "--db",
        db,
        "--story-id",
        storyId,
        "--input",
        planFile,
        "--apply",
      ],
      io,
    ),
    0,
  );
  const taskId = (JSON.parse(output) as { tasks: { taskId: string }[] }).tasks[0]!.taskId;
  output = "";
  assert.equal(
    await runCli(["task", "check", "--project", root, "--db", db, "--task-id", taskId], io),
    0,
  );
  assert.equal((JSON.parse(output) as { applied: boolean }).applied, false);
  output = "";
  assert.equal(
    await runCli(
      ["task", "check", "--project", root, "--db", db, "--task-id", taskId, "--approve-checks"],
      io,
    ),
    0,
  );
  assert.equal((JSON.parse(output) as { run: { state: string } }).run.state, "REVIEW");
  output = "";
  await runCli(["task", "list", "--project", root, "--db", db], io);
  assert.equal((JSON.parse(output) as { runs: unknown[] }).runs.length, 1);
  const runId = (JSON.parse(output) as { runs: { runId: string }[] }).runs[0]!.runId;
  const reviewFile = join(root, "review.md");
  await writeFile(reviewFile, "Reviewed fixture diff and passing check evidence.");
  output = "";
  await runCli(
    [
      "task",
      "review",
      "--project",
      root,
      "--db",
      db,
      "--run-id",
      runId,
      "--approve-review",
      "--review-reference",
      reviewFile,
    ],
    io,
  );
  assert.equal((JSON.parse(output) as { run: { state: string } }).run.state, "COMPLETED");
  output = "";
  await runCli(
    [
      "task",
      "plan",
      "--project",
      root,
      "--db",
      db,
      "--story-id",
      storyId,
      "--input",
      planFile,
      "--apply",
    ],
    io,
  );
  const failingTaskId = (JSON.parse(output) as { tasks: { taskId: string }[] }).tasks[0]!.taskId;
  const profile = JSON.parse(await readFile(join(root, ".vpr", "profile.json"), "utf8"));
  profile.checks.test.args = ["-e", "process.exit(7)"];
  await writeFile(join(root, ".vpr", "profile.json"), JSON.stringify(profile));
  output = "";
  assert.equal(
    await runCli(
      [
        "task",
        "check",
        "--project",
        root,
        "--db",
        db,
        "--task-id",
        failingTaskId,
        "--approve-checks",
      ],
      io,
    ),
    1,
  );
  assert.equal((JSON.parse(output) as { run: { state: string } }).run.state, "FAILED");
});

test("runs a real local check and returns machine-readable completion", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-cli-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const writes: string[] = [];

  const exitCode = await runCli(["doctor", "--db", join(directory, "vpr.sqlite")], {
    stdout: (value) => writes.push(value),
    stderr: (value) => writes.push(value),
  });

  assert.equal(exitCode, 0);
  const output = JSON.parse(writes.join("")) as {
    state: string;
    evidence: { exitCode: number };
    capabilities: { id: string; state: string }[];
  };
  assert.equal(output.state, "COMPLETED");
  assert.equal(output.evidence.exitCode, 0);
  assert.equal(
    output.capabilities.find((capability) => capability.id === "node")?.state,
    "available",
  );
});

test("previews init without writing and applies only with --apply", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-init-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  const previewWrites: string[] = [];

  const previewCode = await runCli(["init", "--project", root], {
    stdout: (value) => previewWrites.push(value),
    stderr: (value) => previewWrites.push(value),
  });
  const preview = JSON.parse(previewWrites.join("")) as { action: string; applied: boolean };

  assert.equal(previewCode, 0);
  assert.equal(preview.action, "create");
  assert.equal(preview.applied, false);
  await assert.rejects(readFile(join(root, ".vpr", "profile.json"), "utf8"), /ENOENT/);

  const applyWrites: string[] = [];
  const applyCode = await runCli(["init", "--project", root, "--apply"], {
    stdout: (value) => applyWrites.push(value),
    stderr: (value) => applyWrites.push(value),
  });
  const applied = JSON.parse(applyWrites.join("")) as { applied: boolean };

  assert.equal(applyCode, 0);
  assert.equal(applied.applied, true);
  assert.equal(
    (
      JSON.parse(await readFile(join(root, ".vpr", "profile.json"), "utf8")) as {
        schemaVersion: number;
      }
    ).schemaVersion,
    1,
  );
});

test("previews and applies a Story through the shared BacklogService", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-story-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const input = join(root, "story.json");
  const db = join(root, "backlog.sqlite");
  await writeFile(
    input,
    JSON.stringify({
      title: "CLI Story",
      need: "Create backlog items without a dashboard.",
      desiredOutcome: "A previewed and confirmed Story.",
      acceptanceCriteria: ["A later invocation recovers it."],
      exclusions: [],
      openQuestions: [],
      attachments: [],
    }),
  );

  const previewWrites: string[] = [];
  assert.equal(
    await runCli(["story", "--db", db, "--project-id", "project_cli", "--input", input], {
      stdout: (value) => previewWrites.push(value),
      stderr: (value) => previewWrites.push(value),
    }),
    0,
  );
  const preview = JSON.parse(previewWrites.join("")) as { action: string; applied: boolean };
  assert.deepEqual(preview, { action: "create", applied: false });

  const applyWrites: string[] = [];
  assert.equal(
    await runCli(
      ["story", "--db", db, "--project-id", "project_cli", "--input", input, "--apply"],
      {
        stdout: (value) => applyWrites.push(value),
        stderr: (value) => applyWrites.push(value),
      },
    ),
    0,
  );
  const applied = JSON.parse(applyWrites.join("")) as {
    applied: boolean;
    story: { revision: number; story: { status: string } };
  };
  assert.equal(applied.applied, true);
  assert.equal(applied.story.revision, 1);
  assert.equal(applied.story.story.status, "READY");

  const duplicateWrites: string[] = [];
  await runCli(["story", "--db", db, "--project-id", "project_cli", "--input", input], {
    stdout: (value) => duplicateWrites.push(value),
    stderr: (value) => duplicateWrites.push(value),
  });
  assert.equal((JSON.parse(duplicateWrites.join("")) as { action: string }).action, "duplicate");
});

test("exports JSONL and deletes project data only with exact confirmation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-data-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const input = join(root, "story.json");
  const db = join(root, "backlog.sqlite");
  const output = join(root, "events.jsonl");
  await writeFile(
    input,
    JSON.stringify({
      title: "Exportable Story",
      need: "Keep a portable local event history.",
      desiredOutcome: "A JSONL export that can be inspected without SQLite.",
      acceptanceCriteria: ["The export contains the Story event."],
      exclusions: [],
      openQuestions: [],
      attachments: [],
    }),
  );
  const sink = { stdout: (_value: string) => undefined, stderr: (_value: string) => undefined };

  assert.equal(
    await runCli(
      ["story", "--db", db, "--project-id", "project_data", "--input", input, "--apply"],
      sink,
    ),
    0,
  );
  assert.equal(
    await runCli(
      ["data", "export", "--db", db, "--project-id", "project_data", "--out", output],
      sink,
    ),
    0,
  );
  assert.match(await readFile(output, "utf8"), /backlog\.story\.created/);

  const retentionWrites: string[] = [];
  assert.equal(
    await runCli(
      [
        "data",
        "retention",
        "--db",
        db,
        "--project-id",
        "project_data",
        "--before",
        "2099-01-01T00:00:00.000Z",
      ],
      {
        stdout: (value) => retentionWrites.push(value),
        stderr: (value) => retentionWrites.push(value),
      },
    ),
    0,
  );
  assert.equal(
    (JSON.parse(retentionWrites.join("")) as { candidates: number; applied: boolean }).candidates,
    0,
  );
  assert.equal(
    (JSON.parse(retentionWrites.join("")) as { candidates: number; applied: boolean }).applied,
    false,
  );

  await assert.rejects(
    runCli(
      ["data", "delete", "--db", db, "--project-id", "project_data", "--confirm", "project_other"],
      sink,
    ),
    /exact project id/,
  );
  assert.equal(
    await runCli(
      ["data", "delete", "--db", db, "--project-id", "project_data", "--confirm", "project_data"],
      sink,
    ),
    0,
  );
});
