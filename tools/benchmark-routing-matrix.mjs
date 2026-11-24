import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { benchmarkTasks, acceptanceSource } from "./lib/benchmark-tasks.mjs";
import { workflowTasks, workflowAcceptance } from "./lib/workflow-benchmark-tasks.mjs";
import { runMeasuredClaude } from "./lib/run-measured-claude.mjs";
import { officialCostBreakdown } from "./lib/official-cost-breakdown.mjs";
import { resolveExecutable } from "@vpr/runtime";
import { runCli } from "@vpr/cli";

if (!process.argv.includes("--approve-provider"))
  throw new Error("Explicit --approve-provider required for native subscription execution");
const flag = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const suite = flag("--suite") ?? "functions";
if (!["functions", "workflows"].includes(suite)) throw new Error("Unknown benchmark suite");
const tasks = suite === "workflows" ? workflowTasks : benchmarkTasks;
const testCount = (task) => task.checks?.length ?? task.cases.length;
const root = resolve(".");
const directory = resolve(flag("--resume") ?? join(root, ".tmp", "routing-matrix-" + Date.now()));
if (!relative(join(root, ".tmp"), directory).match(/^routing-matrix-[\w-]+$/u))
  throw new Error("Use an isolated .tmp/routing-matrix-* directory");
const path = join(directory, "report.json");
await mkdir(directory, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const catalog = JSON.parse(
  await readFile(join(root, "docs/research/model-price-catalog.json"), "utf8"),
);
const executable = await resolveExecutable("claude");
if (!executable) throw new Error("Claude native CLI unavailable");
const plugin = join(root, "dist/npm/plugin");
const arms = [
  { id: "sonnet-solo", executor: "claude-sonnet-5-5" },
  { id: "haiku-solo", executor: "claude-haiku-5-5" },
  { id: "sonnet-haiku", coordinator: "claude-sonnet-5-5", executor: "claude-haiku-5-5" },
  { id: "haiku-sonnet", coordinator: "claude-haiku-5-5", executor: "claude-sonnet-5-5" },
  { id: "opus-solo", executor: "claude-opus-5-5", complexOnly: true },
  {
    id: "opus-haiku",
    coordinator: "claude-opus-5-5",
    executor: "claude-haiku-5-5",
    complexOnly: true,
  },
];
const selectedArms = flag("--arms")?.split(",");
if (selectedArms?.some((id) => !arms.some((arm) => arm.id === id)))
  throw new Error("Unknown requested arm");
const specHash = hash(JSON.stringify(tasks));
const report = flag("--resume")
  ? JSON.parse(await readFile(path, "utf8"))
  : {
      schemaVersion: 1,
      at: new Date().toISOString(),
      specHash,
      scenario: "Controlled native CLI execution; same task and external acceptance per arm",
      suite,
      selectedArms: selectedArms ?? arms.map((arm) => arm.id),
      tasks: tasks.map(({ cases, checks, files, ...task }) => ({
        ...task,
        testCount: testCount({ cases, checks }),
        classification: "manual, relative to this bounded benchmark",
      })),
      repetitions: 1,
      rotatedOrder: true,
      cacheOrderConfound: true,
      adaptiveRoutingProven: false,
      meteringInferenceTokens: 0,
      excludesDevelopmentAndEarlierExperiments: true,
      subscriptionBillingMeasured: false,
      prices: { checkedAt: catalog.checkedAt, source: catalog.cards[0].source },
      rows: [],
    };
if (report.specHash !== specHash) throw new Error("Specifications changed: start a new experiment");
let saving = Promise.resolve();
const save = () => {
  const value = JSON.stringify(report, null, 2) + "\n";
  saving = saving.then(() => writeFile(path, value));
  return saving;
};
async function files(dir, prefix = "") {
  const result = {};
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name === ".vpr") continue;
    const key = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error("Unexpected symlink in trial");
    if (item.isDirectory()) Object.assign(result, await files(join(dir, item.name), key + "/"));
    else result[key] = hash(await readFile(join(dir, item.name)));
  }
  return result;
}
async function check(project, external) {
  const start = performance.now();
  const child = spawn(
    process.execPath,
    ["--test", "--test-reporter=tap", "--test-timeout=5000", external],
    {
      cwd: project,
      env: { ...process.env, VPR_BENCH_PROJECT: project },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    if (output.length < 100000) output += chunk;
  });
  child.stderr.on("data", () => {});
  const timer = setTimeout(() => child.kill(), 10000);
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  }).finally(() => clearTimeout(timer));
  const count = (name) => Number(output.match(new RegExp("# " + name + " (\\d+)"))?.[1] ?? 0);
  return {
    exitCode,
    passed: count("pass"),
    failed: count("fail"),
    cancelled: count("cancelled"),
    durationMs: Math.round(performance.now() - start),
  };
}
const disabled = new Set(
  report.rows.filter((row) => row.unavailableModel).map((row) => row.unavailableModel),
);
function accepted(row, task) {
  return (
    row.checks.external.exitCode === 0 &&
    row.checks.external.passed === testCount(task) &&
    row.checks.own.exitCode === 0 &&
    row.checks.own.passed > 0 &&
    row.allowedChanges &&
    row.acceptanceUnchanged &&
    row.delegationVerified &&
    row.modelIntegrity &&
    row.receipt.completeAccounting &&
    row.receipt.terminalReceipt?.success
  );
}
// Local revalidation consumes no inference and never overwrites a native receipt.
for (const row of report.rows) {
  if (!row.receipt || row.status === "accepted") continue;
  const task = tasks.find((task) => task.id === row.taskId);
  row.checks = {
    external: await check(row.project, join(directory, task.id + "-acceptance.mjs")),
    own: await check(row.project, "test/*.test.mjs"),
  };
  row.status = accepted(row, task) ? "accepted" : "incomplete";
}
await save();
for (const [index, task] of tasks.entries()) {
  const applicable = arms.filter(
    (arm) =>
      (!selectedArms || selectedArms.includes(arm.id)) &&
      (!arm.complexOnly ||
        task.level.includes("complejo") ||
        (arm.id === "opus-haiku" && process.argv.includes("--planning-control"))),
  );
  const ordered = [
    ...applicable.slice(index % applicable.length),
    ...applicable.slice(0, index % applicable.length),
  ];
  for (const arm of ordered) {
    if (report.rows.some((row) => row.taskId === task.id && row.arm === arm.id)) continue;
    const requested = [arm.coordinator, arm.executor].filter(Boolean);
    if (requested.some((model) => disabled.has(model))) continue;
    const project = join(directory, task.id + "-" + arm.id);
    await mkdir(join(project, "src"), { recursive: true });
    await mkdir(join(project, "test"), { recursive: true });
    await writeFile(join(project, "FEATURE.txt"), task.requirement + "\n");
    await writeFile(
      join(project, "src/solution.mjs"),
      `export function ${task.entry}() { throw new Error('not implemented'); }\n`,
    );
    for (const [name, content] of Object.entries(task.files ?? {})) {
      await writeFile(join(project, name), content);
    }
    const external = join(directory, task.id + "-acceptance.mjs");
    await writeFile(
      external,
      suite === "workflows" ? workflowAcceptance(task) : acceptanceSource(task),
    );
    const before = await files(project);
    if (arm.coordinator) {
      // VPR initialization detects the technology from package metadata; this is
      // harness-owned setup, not agent implementation or an acceptance change.
      await writeFile(
        join(project, "package.json"),
        JSON.stringify({
          name: "vpr-routing-trial",
          private: true,
          type: "module",
          scripts: { test: "node --test test/*.test.mjs" },
        }) + "\n",
      );
      before["package.json"] = hash(await readFile(join(project, "package.json")));
      await runCli(["init", "--project", project, "--apply"], {
        stdout() {},
        stderr(value) {
          throw new Error(value);
        },
      });
      const profilePath = join(project, ".vpr/profile.json");
      const profile = JSON.parse(await readFile(profilePath, "utf8"));
      profile.policy.allowedProviders = ["local", "claude"];
      await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n");
    }
    const allowedPaths = task.allowedPaths ?? ["src/", "test/"];
    const executorPrompt =
      "Implement FEATURE.txt and add at least one behavioral test in test/*.test.mjs. Edit only these allowed paths: " +
      allowedPaths.join(", ") +
      (". Read the existing files first. No dependencies, network, commands or further delegation. Only file tools are available. A local external " +
        "harness runs the same independent tests after completion. Do not claim tests ran. Finish with a concise summary.");
    const agents = arm.coordinator
      ? {
          "vpr-orchestrator": {
            description: "Analyze and delegate implementation",
            model: arm.coordinator,
            effort: "medium",
            tools: ["Read", "Agent(vpr-executor)"],
            prompt:
              "Analyze this bounded task, then delegate implementation and test writing to exactly ONE foreground vpr-executor. Give a concise implementation plan " +
              "and file paths. No model override on Agent. You have read-only access. After the executor finishes, inspect src/solution.mjs, report concerns without " +
              "editing or another delegation. External harness tests the result. Do not claim tests ran.",
          },
          "vpr-executor": {
            description: "Implement and write behavioral tests",
            model: arm.executor,
            effort: "medium",
            maxTurns: 12,
            tools: ["Read", "Write", "Edit"],
            prompt: executorPrompt,
          },
        }
      : {
          "vpr-baseline": {
            description: "Implement directly",
            model: arm.executor,
            effort: "medium",
            tools: ["Read", "Write", "Edit"],
            prompt: executorPrompt,
          },
        };
    const row = {
      taskId: task.id,
      arm: arm.id,
      coordinatorModel: arm.coordinator ?? null,
      executorModel: arm.executor,
      status: "running",
      project,
      fixtureHash: hash(JSON.stringify(before)),
      acceptanceHash: hash(await readFile(external)),
      preflight: await check(project, external),
    };
    report.rows.push(row);
    row.startedAt = new Date().toISOString();
    await save();
    console.log(JSON.stringify({ phase: "running", task: task.id, arm: arm.id, report: path }));
    const args = [
      "--print",
      "--model",
      arm.coordinator ?? arm.executor,
      "--effort",
      "medium",
      "--max-turns",
      "16",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--no-session-persistence",
      "--prompt-suggestions",
      "false",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--add-dir",
      project,
      "--tools",
      "Read,Write,Edit,Agent",
      "--allowedTools",
      "Read,Write,Edit,Agent(vpr-executor)",
      "--agents",
      JSON.stringify(agents),
      "--agent",
      arm.coordinator ? "vpr-orchestrator" : "vpr-baseline",
    ];
    if (arm.coordinator) args.push("--plugin-dir", plugin);
    row.receipt = await runMeasuredClaude({
      executable,
      cwd: project,
      args,
      prompt: `Work in ${project}. ${arm.coordinator ? "Analyze then delegate to vpr-executor." : executorPrompt}\n${task.requirement}`,
      timeoutMs: 150000,
      onSnapshot(value) {
        row.receipt = value;
        void save();
      },
    });
    row.finishedAt = new Date().toISOString();
    row.checks = {
      external: await check(project, external),
      own: await check(project, "test/*.test.mjs"),
    };
    const after = await files(project);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (key) => before[key] !== after[key],
    );
    row.changedPaths = changed;
    row.allowedChanges = changed.every((key) =>
      allowedPaths.some((path) => (path.endsWith("/") ? key.startsWith(path) : key === path)),
    );
    row.acceptanceUnchanged = row.acceptanceHash === hash(await readFile(external));
    const calls = row.receipt.tools.filter(
      (tool) => tool.name === "Agent" && !tool.parentToolUseId,
    );
    row.delegationVerified = arm.coordinator
      ? calls.length === 1 &&
        calls[0].targetAgent === "vpr-executor" &&
        calls[0].failed === false &&
        calls[0].endMs !== null &&
        !row.receipt.tools.some(
          (tool) => !tool.parentToolUseId && ["Edit", "Write"].includes(tool.name),
        )
      : calls.length === 0;
    row.models = row.receipt.models.map((model) => ({
      ...model,
      role: !arm.coordinator
        ? "ejecutor único"
        : model.model === arm.executor
          ? "ejecutor"
          : "orquestador y revisión",
      cost: officialCostBreakdown(model, row.receipt.requests, catalog),
    }));
    row.modelIntegrity =
      requested.every((model) =>
        row.models.some((value) => value.model === model && value.totalTokens > 0),
      ) && row.models.every((model) => requested.includes(model.model));
    row.totalCost =
      row.models.length && row.models.every((model) => model.cost)
        ? {
            min: row.models.reduce((sum, model) => sum + model.cost.totalUsd.min, 0),
            max: row.models.reduce((sum, model) => sum + model.cost.totalUsd.max, 0),
          }
        : null;
    row.status = accepted(row, task) ? "accepted" : "incomplete";
    // An unmetered failure must remain visible; never call it a free successful arm.
    if (!row.receipt.models.length && !row.receipt.terminalReceipt?.success) {
      row.unavailableModel = arm.coordinator ?? arm.executor;
      disabled.add(row.unavailableModel);
    }
    await save();
    console.log(
      JSON.stringify({
        phase: "measured",
        task: task.id,
        arm: arm.id,
        status: row.status,
        tokens: row.receipt.totals.totalTokens,
        cost: row.totalCost,
        external: row.checks.external,
        own: row.checks.own,
      }),
    );
  }
}
await saving;
console.log(JSON.stringify({ report: path, rows: report.rows.length }));
