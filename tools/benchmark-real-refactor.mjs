import { mkdir, cp, readFile, writeFile, readdir, symlink, stat } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveExecutable } from "@vpr/runtime";
import { runCli } from "@vpr/cli";
import { runMeasuredClaude } from "./lib/run-measured-claude.mjs";
import { officialCostBreakdown } from "./lib/official-cost-breakdown.mjs";
if (!process.argv.includes("--approve-provider")) throw Error("Native provider approval required");
const flag = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const resume = flag("--resume"),
  selected = flag("--arms")?.split(",");
const repetitions = Number(flag("--repetitions") ?? "1");
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3)
  throw Error("Use one to three bounded repetitions");
const root = resolve("."),
  directory = resume ? resolve(resume) : join(root, ".tmp", "real-refactor-" + Date.now()),
  frozen = join(directory, "frozen");
if (dirname(directory) !== join(root, ".tmp") || !basename(directory).startsWith("real-refactor-"))
  throw Error("Use an isolated real-refactor directory inside .tmp");
if (!resume) {
  await mkdir(frozen, { recursive: true });
  for (const name of ["package.json", "tsconfig.base.json"])
    await cp(join(root, name), join(frozen, name));
  for (const pkg of await readdir(join(root, "packages"), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const target = join(frozen, "packages", pkg.name);
    await mkdir(target, { recursive: true });
    for (const name of ["package.json", "tsconfig.json", "src"])
      await cp(join(root, "packages", pkg.name, name), join(target, name), { recursive: true });
  }
}
const hash = (text) => createHash("sha256").update(text).digest("hex");
const baseline = await readFile(join(frozen, "packages/dashboard/src/server.ts"), "utf8");
const testHash = hash(await readFile(join(frozen, "packages/dashboard/src/server.test.ts")));
const requirement =
  "Refactor the actual VPR dashboard server without behavior changes. Extract presentation (HTML/CSS/browser script) and HTTP response/security helpers " +
  "into at least TWO new cohesive TypeScript modules in packages/dashboard/src/. Keep createDashboardServer and its public interfaces exported through " +
  "the existing server.ts and index.ts. Retain loopback host checks, bearer auth, CSRF/origin protection, size bounds and all responses. Reduce server.ts " +
  "character length by at least 40%. Use NodeNext .js import specifiers. Do not change ANY existing tests, index.ts, package metadata, external packages " +
  "or public behavior. Allowed edits: server.ts and NEW .ts files in packages/dashboard/src/. No dependencies, commands, network, commits or further " +
  "delegation by the executor. The external local harness compiles and runs the preserved dashboard regression suite. This is real repository code, not " +
  "an enterprise-wide migration.";
const report = resume
  ? JSON.parse(await readFile(join(directory, "report.json"), "utf8"))
  : {
      schemaVersion: 1,
      at: new Date().toISOString(),
      scenario: "Structural refactor of actual VPR dashboard source in frozen isolated copies",
      repetitions: 1,
      cacheOrderConfound: true,
      meteringInferenceTokens: 0,
      prices: JSON.parse(await readFile("docs/research/model-price-catalog.json", "utf8")),
      tasks: [
        {
          id: "P02",
          name: "Refactor del dashboard real de VPR",
          level: "complejo acotado",
          kind: "refactor",
          requirement,
          testCount: 0,
          sourceCharacters: baseline.length,
          sourceHash: hash(baseline),
          preservedTestsHash: testHash,
        },
      ],
      rows: [],
    };
if (
  report.tasks[0].sourceHash !== hash(baseline) ||
  report.tasks[0].preservedTestsHash !== testHash ||
  report.tasks[0].requirement !== requirement
)
  throw Error("Frozen source, tests or requirement changed; start a new experiment");
const path = join(directory, "report.json");
let saving = Promise.resolve();
const save = () => {
  const text = JSON.stringify(report, null, 2) + "\n";
  saving = saving.then(() => writeFile(path, text));
  return saving;
};
const claude = await resolveExecutable("claude"),
  compiler = join(root, "node_modules/typescript/bin/tsc");
if (!claude) throw Error("Claude unavailable");
async function command(cwd, args) {
  const start = performance.now();
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  child.stdout.on("data", (chunk) => {
    if (text.length < 200000) text += chunk;
  });
  child.stderr.on("data", () => {});
  const timer = setTimeout(() => child.kill(), 45000);
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  }).finally(() => clearTimeout(timer));
  const n = (key) => Number(text.match(new RegExp("# " + key + " (\\d+)"))?.[1] ?? 0);
  return {
    exitCode,
    passed: n("pass"),
    failed: n("fail"),
    durationMs: Math.round(performance.now() - start),
  };
}
async function inventory(dir, prefix = "") {
  const values = {};
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".vpr"].includes(item.name)) continue;
    const name = prefix + item.name;
    if (item.isSymbolicLink()) throw Error("Unexpected fixture symlink");
    if (item.isDirectory())
      Object.assign(values, await inventory(join(dir, item.name), name + "/"));
    else values[name] = hash(await readFile(join(dir, item.name)));
  }
  return values;
}
const fixture = await inventory(frozen);
const arms = [
  { id: "haiku-solo", executor: "claude-haiku-5-5" },
  { id: "opus-solo", executor: "claude-opus-5-5" },
  { id: "opus-haiku", coordinator: "claude-opus-5-5", executor: "claude-haiku-5-5" },
  { id: "sonnet-solo", executor: "claude-sonnet-5-5" },
  { id: "sonnet-haiku", coordinator: "claude-sonnet-5-5", executor: "claude-haiku-5-5" },
];
if (selected?.some((id) => !arms.some((arm) => arm.id === id))) throw Error("Unknown refactor arm");
const trials = arms
  .filter((arm) => (selected ? selected.includes(arm.id) : !arm.id.startsWith("sonnet")))
  .flatMap((arm) =>
    Array.from({ length: repetitions }, (_, index) => ({
      ...arm,
      strategyArm: arm.id,
      repetition: index + 1,
      id: index === 0 ? arm.id : arm.id + "-repeat-" + (index + 1),
    })),
  );
for (const arm of trials) {
  const previous = report.rows.find((row) => row.arm === arm.id);
  if (previous) {
    if (previous.status !== "accepted")
      throw Error("Inspect the incomplete attempt before rerunning");
    continue;
  }
  const project = join(directory, arm.id);
  await cp(frozen, project, { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(project, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const pkg of await readdir(join(project, "packages"))) {
    const dependencies = join(root, "packages", pkg, "node_modules");
    try {
      await stat(dependencies);
      await symlink(
        dependencies,
        join(project, "packages", pkg, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (arm.coordinator) {
    await runCli(["init", "--project", project, "--apply"], {
      stdout() {},
      stderr(text) {
        throw Error(text);
      },
    });
    const p = join(project, ".vpr/profile.json"),
      profile = JSON.parse(await readFile(p, "utf8"));
    profile.policy.allowedProviders = ["local", "claude"];
    await writeFile(p, JSON.stringify(profile, null, 2) + "\n");
  }
  const row = {
    taskId: "P02",
    arm: arm.id,
    strategyArm: arm.strategyArm,
    repetition: arm.repetition,
    project,
    coordinatorModel: arm.coordinator ?? null,
    executorModel: arm.executor,
    status: "preflight",
    fixtureHash: hash(JSON.stringify(fixture)),
    acceptanceHash: testHash,
  };
  report.rows.push(row);
  await save();
  const runBuild = () =>
    command(project, [compiler, "-b", "packages/dashboard", "--pretty", "false"]);
  const runTests = () =>
    command(project, [
      "--test",
      "--test-reporter=tap",
      "--test-timeout=12000",
      "packages/dashboard/dist/server.test.js",
    ]);
  row.preflight = { build: await runBuild(), tests: await runTests() };
  await save();
  if (row.preflight.build.exitCode || row.preflight.tests.exitCode || !row.preflight.tests.passed)
    throw Error("Original repository fixture must pass before inference");
  report.tasks[0].testCount = row.preflight.tests.passed;
  const prompt =
    "Read packages/dashboard/src/server.ts and the preserved tests. " +
    requirement +
    " Finish with a short summary. Existing regression tests are sufficient for this behavior-preserving refactor; do not claim to have run them.";
  const agents = arm.coordinator
    ? {
        "vpr-orchestrator": {
          description: "Plan the structural refactor and review",
          model: arm.coordinator,
          effort: "medium",
          tools: ["Read", "Agent(vpr-executor)"],
          prompt:
            "Read the dashboard source, create a precise module-boundary plan and delegate all edits to exactly ONE foreground vpr-executor. Do not override its " +
            "model. You are read-only. After it returns read the result and summarize concerns, no second implementation loop. The external harness compiles and " +
            "runs unchanged regression tests.",
        },
        "vpr-executor": {
          description: "Refactor dashboard",
          model: arm.executor,
          effort: "medium",
          maxTurns: 18,
          tools: ["Read", "Write", "Edit"],
          prompt,
        },
      }
    : {
        "vpr-baseline": {
          description: "Refactor alone",
          model: arm.executor,
          effort: "medium",
          tools: ["Read", "Write", "Edit"],
          prompt,
        },
      };
  const args = [
    "--print",
    "--model",
    arm.coordinator ?? arm.executor,
    "--effort",
    "medium",
    "--max-turns",
    "20",
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
  if (arm.coordinator) args.push("--plugin-dir", join(root, "dist/npm/plugin"));
  row.status = "running";
  row.startedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ phase: "running", arm: arm.id, report: path }));
  row.receipt = await runMeasuredClaude({
    executable: claude,
    cwd: project,
    args,
    prompt: arm.coordinator
      ? requirement.replace(
          "further delegation by the executor",
          "further delegation by the executor",
        ) + " Delegate implementation to vpr-executor."
      : prompt,
    timeoutMs: 240000,
    onSnapshot(value) {
      row.receipt = value;
      void save();
    },
  });
  row.finishedAt = new Date().toISOString();
  row.checks = {
    own: { ...(await runBuild()), kind: "typecheck-build" },
    external: await runTests(),
  };
  const after = await inventory(project);
  row.changedPaths = [...new Set([...Object.keys(fixture), ...Object.keys(after)])].filter(
    (name) => fixture[name] !== after[name],
  );
  row.allowedChanges = row.changedPaths.every(
    (name) =>
      name === "packages/dashboard/src/server.ts" ||
      (name.startsWith("packages/dashboard/src/") && name.endsWith(".ts") && !fixture[name]),
  );
  row.acceptanceUnchanged =
    testHash === hash(await readFile(join(project, "packages/dashboard/src/server.test.ts")));
  row.serverCharacters = (
    await readFile(join(project, "packages/dashboard/src/server.ts"), "utf8")
  ).length;
  row.newModules = row.changedPaths.filter((name) => !fixture[name] && name.endsWith(".ts")).length;
  row.structuralAcceptance = row.serverCharacters <= baseline.length * 0.6 && row.newModules >= 2;
  const calls = row.receipt.tools.filter((tool) => tool.name === "Agent" && !tool.parentToolUseId);
  row.delegationVerified = arm.coordinator
    ? calls.length === 1 &&
      calls[0].failed === false &&
      calls[0].endMs !== null &&
      !row.receipt.tools.some(
        (tool) => !tool.parentToolUseId && ["Write", "Edit"].includes(tool.name),
      )
    : calls.length === 0;
  const wanted = [arm.coordinator, arm.executor].filter(Boolean);
  row.modelIntegrity =
    wanted.every((id) => row.receipt.models.some((model) => model.model === id)) &&
    row.receipt.models.every((model) => wanted.includes(model.model));
  row.models = row.receipt.models.map((model) => ({
    ...model,
    role: arm.coordinator
      ? model.model === arm.executor
        ? "ejecutor"
        : "orquestador y revisión"
      : "ejecutor único",
    cost: officialCostBreakdown(model, row.receipt.requests, report.prices),
  }));
  row.totalCost =
    row.models.length && row.models.every((model) => model.cost)
      ? {
          min: row.models.reduce((s, m) => s + m.cost.totalUsd.min, 0),
          max: row.models.reduce((s, m) => s + m.cost.totalUsd.max, 0),
        }
      : null;
  row.status =
    row.checks.own.exitCode === 0 &&
    row.checks.external.exitCode === 0 &&
    row.checks.external.passed === report.tasks[0].testCount &&
    row.allowedChanges &&
    row.acceptanceUnchanged &&
    row.structuralAcceptance &&
    row.delegationVerified &&
    row.modelIntegrity &&
    row.receipt.completeAccounting &&
    row.receipt.terminalReceipt?.success
      ? "accepted"
      : "incomplete";
  await save();
  console.log(
    JSON.stringify({
      phase: "measured",
      arm: arm.id,
      status: row.status,
      cost: row.totalCost,
      tokens: row.receipt.totals,
      checks: row.checks,
      serverCharacters: row.serverCharacters,
      newModules: row.newModules,
    }),
  );
}
await saving;
console.log(JSON.stringify({ report: path }));
