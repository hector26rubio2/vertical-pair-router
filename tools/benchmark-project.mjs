import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { runCli } from "../packages/cli/dist/index.js";
import { resolveExecutable } from "../packages/runtime/dist/index.js";
import { BacklogService, createStoryDraftFromGrill } from "../packages/backlog/dist/index.js";
import { SqliteStorage } from "../packages/storage-sqlite/dist/index.js";
import { createContextPack } from "../packages/knowledge/dist/index.js";
import {
  verifyModelReceipt,
  estimateApiReferenceCost,
} from "../packages/observability/dist/index.js";
import { detectSubscriptionPlan } from "../packages/cli/dist/subscription-detection.js";

// Deliberately opt-in: coding runs use the user's native Claude subscription.
if (!process.argv.includes("--approve-provider"))
  throw new Error("--approve-provider required: real model executions consume account usage");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = await resolveExecutable("claude");
if (!executable) throw new Error("Claude Code unavailable");
const resumeAt = process.argv.indexOf("--resume");
const pilot =
  resumeAt < 0
    ? join(root, ".tmp", "inventory-pilot-" + Date.now())
    : resolve(process.argv[resumeAt + 1]);
if (
  dirname(pilot) !== join(root, ".tmp") ||
  !pilot.split(/[\\/]/u).at(-1).startsWith("inventory-pilot-")
)
  throw new Error("Resume must target an isolated pilot inside .tmp");
await mkdir(pilot, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const reportPath = join(pilot, "report.json");
const rows = resumeAt < 0 ? [] : JSON.parse(await readFile(reportPath, "utf8")).rows;
const feature = await readFile(join(root, "tests/fixtures/inventory-pilot/FEATURE.txt"), "utf8");
const acceptance = join(root, "tools/lib/inventory-acceptance.mjs");
const acceptanceHash = hash(await readFile(acceptance));
const prices = JSON.parse(
  await readFile(join(root, "docs/research/model-price-catalog.json"), "utf8"),
);

async function execute(program, args, cwd, { input, timeoutMs = 30_000, env = {} } = {}) {
  const start = performance.now();
  const child = spawn(program, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    bytes = 0,
    stopped = null;
  const stop = (reason) => {
    stopped = reason;
    child.kill();
  };
  let timer = setTimeout(() => stop("timeout"), timeoutMs);
  let partialLine = "",
    receiptSeen = false;
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (data) => {
      bytes += data.length;
      if (bytes > 8_000_000) {
        stop("output-limit");
        return;
      }
      const chunk = data.toString();
      stdout += chunk;
      partialLine += chunk;
      const lines = partialLine.split(/\r?\n/u);
      partialLine = lines.pop() ?? "";
      for (const line of lines) {
        try {
          if (!receiptSeen && JSON.parse(line).type === "result") {
            receiptSeen = true;
            clearTimeout(timer);
            // No more inference follows the terminal receipt. Bound shutdown
            // separately so inherited child pipes cannot hold the pilot open.
            timer = setTimeout(() => stop("post-result-cleanup"), 10_000);
          }
        } catch {
          /* ordinary command output is not JSON */
        }
      }
    });
    child.stderr.on("data", (data) => {
      if (stderr.length < 4096) stderr += data.toString();
    });
    child.once("close", done);
    child.stdin.end(input);
  }).finally(() => clearTimeout(timer));
  return { exitCode, durationMs: Math.round(performance.now() - start), stopped, stdout, stderr };
}
async function git(args, cwd) {
  const result = await execute("git", args, cwd);
  if (result.exitCode !== 0) throw new Error("Pilot Git operation failed: " + result.stderr);
  return result.stdout.trim();
}
async function checks(cwd, external) {
  const result = await execute(
    process.execPath,
    ["--test", "--test-reporter=tap", external ? acceptance : "test/*.test.mjs"],
    cwd,
    { env: { VPR_PILOT_PROJECT: cwd } },
  );
  const count = (name) =>
    Number(result.stdout.match(new RegExp("# " + name + " (\\d+)"))?.[1] ?? 0);
  return {
    exitCode: result.exitCode,
    passed: count("pass"),
    failed: count("fail"),
    durationMs: result.durationMs,
    stopped: result.stopped,
  };
}
async function save() {
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        at: new Date().toISOString(),
        pilot,
        scenario:
          "Same-model real HTTP/SQLite project: ordinary workflow versus native VPR plugin plus local context/backlog",
        exploratory: true,
        repetitions: 1,
        fixedOrder: true,
        cacheOrderConfound: true,
        meteringInferenceTokens: 0,
        decisionInferenceTokens: 0,
        actualSubscriptionQuotaDelta: null,
        acceptanceHash,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
}

// The host protects every file under a loaded plugin root. Load the packaged
// copy, not this repository root (which also contains the isolated pilot).
const pluginRoot = join(root, "dist/npm/plugin");
await stat(join(pluginRoot, ".claude-plugin/plugin.json"));
const arms = process.argv.includes("--include-haiku")
  ? ["baseline", "vpr-packaged", "vpr-packaged-haiku"]
  : ["baseline", "vpr-packaged"];
for (const arm of arms) {
  if (rows.some((row) => row.arm === arm)) continue;
  const model = arm.endsWith("haiku") ? "claude-haiku-5-5" : "claude-sonnet-5-5";
  const usesVpr = arm !== "baseline";
  const cwd = join(pilot, arm);
  if (!(await stat(join(cwd, ".git")).catch(() => null))) {
    await cp(join(root, "tests/fixtures/inventory-pilot"), cwd, { recursive: true });
    await git(["init", "--initial-branch=main"], cwd);
    await git(["add", "."], cwd);
    await git(
      [
        "-c",
        "user.name=VPR local pilot",
        "-c",
        "user.email=pilot@localhost",
        "-c",
        "core.hooksPath=",
        "commit",
        "-m",
        "Identical inventory pilot baseline",
      ],
      cwd,
    );
  }
  if (await git(["ls-files", "--modified", "--others", "--exclude-standard"], cwd))
    throw new Error(
      "Existing unfinished pilot has changes; preserve and inspect it before resuming",
    );
  const baseTree = await git(["rev-parse", "HEAD^{tree}"], cwd);
  const originalChecks = await checks(cwd, false),
    redChecks = await checks(cwd, true);
  if (originalChecks.exitCode !== 0 || redChecks.failed !== 6)
    throw new Error("Pilot preconditions failed");
  let storage, service, run, contextPack, profile;
  if (usesVpr) {
    const io = {
      stdout() {},
      stderr(value) {
        throw new Error(value);
      },
    };
    if ((await runCli(["init", "--project", cwd, "--apply"], io)) !== 0)
      throw new Error("Init failed");
    profile = JSON.parse(await readFile(join(cwd, ".vpr/profile.json"), "utf8"));
    profile.policy.allowedProviders = ["local", "claude"];
    const planId = await detectSubscriptionPlan("claude");
    if (planId)
      profile.subscriptions = [{ provider: "claude", planId, source: "provider_reported" }];
    profile.checks = { test: { program: process.execPath, args: ["--test", "test/*.test.mjs"] } };
    await writeFile(join(cwd, ".vpr/profile.json"), JSON.stringify(profile, null, 2) + "\n");
    storage = new SqliteStorage(join(cwd, ".vpr/local.sqlite"));
    await storage.initialize();
    service = new BacklogService({
      projectId: profile.projectId,
      storage,
      actor: "vpr-project-pilot",
      confirmation: "required",
      now: () => new Date().toISOString(),
      nextId: (prefix) => `${prefix}_${randomUUID()}`,
    });
    const draft = createStoryDraftFromGrill({
      projectId: profile.projectId,
      title: "Durable idempotent inventory reservations",
      need: "Reserve stock safely over HTTP",
      desiredOutcome: "Correct persistent reservations without duplicate decrements",
      acceptanceCriteria: feature.split("\n").filter(Boolean),
      exclusions: ["Publication", "External dependencies"],
      openQuestions: [],
      attachments: ["FEATURE.txt"],
    });
    const story = await service.commitStory(await service.previewStory(draft), { confirmed: true });
    const [task] = await service.planTasks(story.story.storyId, "feature", [
      {
        outcome: draft.desiredOutcome,
        acceptanceCriteria: draft.acceptanceCriteria,
        demoPath: "POST /reservations",
        allowedPaths: ["src/", "test/"],
        requiredChecks: ["test"],
        risk: "medium",
        changesPublicApi: true,
        dependsOn: [],
      },
    ]);
    run = await service.createRun(task.taskId);
    for (const state of ["ANALYZING", "READY", "RUNNING"])
      await service.transitionRun(run.runId, state);
    contextPack = await createContextPack({
      root: cwd,
      storyId: story.story.storyId,
      taskId: task.taskId,
      commit: await git(["rev-parse", "HEAD"], cwd),
      createdAt: new Date().toISOString(),
      files: ["src/store.mjs", "src/server.mjs", "FEATURE.txt"].map((path) => ({ path })),
      pending: [],
      maxTotalBytes: 12000,
    });
    await writeFile(join(cwd, ".vpr/context.json"), JSON.stringify(contextPack, null, 2) + "\n");
  }
  const tools = "Read,Edit,Write,Bash,Glob,Grep,Skill";
  const args = [
    "--print",
    "--model",
    model,
    "--effort",
    "medium",
    "--max-turns",
    "18",
    "--output-format",
    "stream-json",
    "--verbose",
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
    cwd,
    "--tools",
    tools,
    "--allowedTools",
    "Read,Edit,Write,Glob,Grep,Skill,Bash(node --test*),Bash(git diff*),Bash(git status*)",
  ];
  if (usesVpr) args.push("--plugin-dir", pluginRoot);
  const prompt =
    (usesVpr ? "/vertical-pair-router:vpr-feature " : "") +
    ("Implement FEATURE.txt in this local project. Working directory is " +
      cwd +
      ("; all file edits must be inside it. Use behavioral tests, run node --test test/*.test.mjs after the last change and review git diff. Modify " +
        "only src/ and new files under test/. Do not change existing test/base.test.mjs, package files or FEATURE.txt. Do not install dependencies, " +
        "commit, access the network or delegate.\n")) +
    (usesVpr
      ? "The local runner already created Story " +
        contextPack.storyId +
        ", Task " +
        contextPack.taskId +
        " and Run " +
        run.runId +
        (". Context references are src/store.mjs and src/server.mjs (also .vpr/context.json). Read those directly; do not scan unrelated files. " +
          "Backlog persistence and external acceptance are handled by the local runner.\n")
      : "") +
    feature;
  console.log(JSON.stringify({ phase: "coding", arm, cwd, model, reportPath }));
  const result = await execute(executable, args, cwd, { input: prompt, timeoutMs: 300_000 });
  const events = result.stdout.split(/\r?\n/u).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const final = events.findLast((event) => event.type === "result");
  const observed = events
    .filter((event) => event.type === "assistant")
    .map((event) => event.message?.model)
    .filter(Boolean);
  const receipt = verifyModelReceipt(model, observed);
  const usage = final?.usage;
  const counters = usage
    ? {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      }
    : null;
  if (
    counters &&
    Object.values(counters).some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    throw new Error("Invalid usage");
  const ownChecks = await checks(cwd, false),
    acceptanceChecks = await checks(cwd, true);
  const changedPaths = (
    await git(["ls-files", "--modified", "--others", "--exclude-standard"], cwd)
  )
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
  const allowedChanges = changedPaths.every(
    (path) =>
      (path.startsWith("src/") || path.startsWith("test/")) && path !== "test/base.test.mjs",
  );
  const toolCounts = {};
  for (const event of events)
    for (const part of event.message?.content ?? [])
      if (part.type === "tool_use") toolCounts[part.name] = (toolCounts[part.name] ?? 0) + 1;
  const row = {
    arm,
    cwd,
    baseTree,
    originalChecks,
    redChecks,
    requestedModel: model,
    requestedEffort: "medium",
    effortVerification: "requested-only",
    modelVerification: receipt.status,
    observedModels: receipt.observedModels,
    exitCode: result.exitCode,
    stopped: result.stopped,
    durationMs: result.durationMs,
    resultSubtype: final?.subtype ?? null,
    permissionDenials:
      final?.permission_denials?.map((item) => ({
        tool: item.tool_name,
        path: item.tool_input?.file_path ?? null,
      })) ?? [],
    toolCounts,
    source: "provider_reported",
    ...counters,
    totalTokens: counters ? Object.values(counters).reduce((a, b) => a + b, 0) : null,
    ownChecks,
    acceptanceChecks,
    changedPaths,
    allowedChanges,
    checksPassed: ownChecks.exitCode === 0 && acceptanceChecks.exitCode === 0 && allowedChanges,
    pluginLoaded: events.some(
      (event) =>
        event.type === "system" &&
        event.subtype === "init" &&
        JSON.stringify(event.plugins ?? []).includes("vertical-pair-router"),
    ),
    pluginSkillUsed: events.some((event) =>
      event.message?.content?.some?.(
        (part) =>
          part.type === "tool_use" &&
          part.name === "Skill" &&
          String(part.input?.skill).includes("vpr-feature"),
      ),
    ),
  };
  row.cost = counters
    ? estimateApiReferenceCost(
        {
          ...counters,
          requestCount: Object.keys(toolCounts).length ? 2 : 1,
          observedModel: receipt.observedModels[0],
          modelConfirmed: receipt.status === "confirmed" && receipt.observedModels.length === 1,
          now: new Date().toISOString(),
        },
        prices,
      )
    : null;
  rows.push(row);
  await save();
  if (storage) {
    await storage.appendEvent({
      schemaVersion: 1,
      eventId: `evt_${randomUUID()}`,
      projectId: profile.projectId,
      taskId: run.taskId,
      runId: run.runId,
      actor: "vpr-project-pilot",
      occurredAt: new Date().toISOString(),
      type: "AgentUsageObserved",
      payload: {
        provider: "claude",
        agentId: `${arm}-executor`,
        scope: "session",
        model,
        ...counters,
        source: "provider_reported",
        role: "executor",
      },
    });
    await service.transitionRun(run.runId, "VALIDATING");
    await service.transitionRun(
      run.runId,
      result.stopped === "timeout" ? "CANCELLED" : row.checksPassed ? "REVIEW" : "FAILED",
    );
    await storage.close();
  }
  console.log(JSON.stringify({ phase: "measured", ...row }));
  if (!final || (result.stopped && result.stopped !== "post-result-cleanup")) break;
}
console.log(JSON.stringify({ reportPath, pilot, completedArms: rows.length }));
