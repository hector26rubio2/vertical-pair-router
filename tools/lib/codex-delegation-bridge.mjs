/** Bounded local stdio MCP bridge for explicit Claude -> signed-in Codex trials. */
import { spawn } from "node:child_process";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { subscriptionEnvironment } from "../../packages/runtime/dist/native-providers.js";
import { codexLaunchEnvironment } from "../../packages/runtime/dist/codex-launch.js";
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--manifest")) throw new Error("Explicit delegation manifest required");
const manifest = JSON.parse(await readFile(resolve(arg("--manifest")), "utf8"));
const cwd = await realpath(manifest.project);
const reviewMode = manifest.mode === "review";
if (reviewMode && (typeof manifest.reviewInput !== "string" || manifest.reviewInput.length > 12000))
  throw Error("Bounded review input required");
const profile = JSON.parse(await readFile(resolve(cwd, ".vpr/profile.json"), "utf8"));
if (!["claude", "codex"].every((provider) => profile.policy.allowedProviders.includes(provider)))
  throw new Error("Cross-provider delegation is not authorized by project policy");
if (profile.policy.allowShell !== true)
  throw new Error("Native Codex file tools require explicit project command authorization");
if (
  !/^gpt-[\w.-]+$/u.test(manifest.model) ||
  !isAbsolute(manifest.executable) ||
  !isAbsolute(manifest.receipt)
)
  throw new Error("Invalid fixed execution manifest");
const receiptRelative = relative(cwd, resolve(manifest.receipt));
if (receiptRelative && !receiptRelative.startsWith("..") && !isAbsolute(receiptRelative))
  throw new Error("Receipt must be outside the worker writable project");
const reply = (id, result, error) =>
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) }) + "\n",
  );
let used = false;
let activeChild;
function terminate(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => child.kill());
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  }
}
async function execute(plan) {
  const start = performance.now();
  const args = [
    "--no-daemon",
    "-a",
    "never",
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    reviewMode ? "read-only" : "workspace-write",
    "--json",
    "-C",
    cwd,
    "-m",
    manifest.model,
    "-c",
    'model_reasoning_effort="medium"',
    "-c",
    "features.multi_agent=false",
    "-c",
    'web_search="disabled"',
    "-c",
    "sandbox_workspace_write.network_access=false",
    "-",
  ];
  const env = await codexLaunchEnvironment(manifest.executable, subscriptionEnvironment());
  // Native subscription authentication only. Never copy credentials into the manifest.
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"])
    delete env[key];
  // A native child is a separate session. Do not point its tools at the parent
  // desktop session's IPC channel or attribute it to the parent's active turn.
  // Managed permission and sandbox variables are deliberately preserved.
  for (const key of [
    "CODEX_APP_TOOLS_PIPE_PATH",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "CODEX_TOOL_CALL_ID",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  ])
    delete env[key];
  const child = spawn(manifest.executable, args, {
    cwd,
    env,
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  activeChild = child;
  let pending = "",
    bytes = 0,
    usage = null,
    completed = false,
    summary = "",
    errorCount = 0,
    toolCalls = 0;
  const itemTypes = new Set();
  const observe = (line) => {
    try {
      const e = JSON.parse(line);
      if (e.type === "turn.completed") {
        usage = e.usage;
        completed = true;
      }
      if (e.type === "turn.failed" || e.type === "error") errorCount++;
      if (e.type === "item.completed" && e.item?.type) itemTypes.add(e.item.type);
      if (e.type === "item.completed" && e.item?.type === "agent_message")
        summary = String(e.item.text ?? "").slice(0, 6000);
      if (
        e.type === "item.completed" &&
        ["command_execution", "file_change"].includes(e.item?.type)
      )
        toolCalls++;
    } catch {}
  };
  const timer = setTimeout(() => terminate(child), 150000);
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 4_000_000) {
      terminate(child);
      return;
    }
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) observe(line);
  });
  child.stderr.on("data", () => {});
  child.stdin.on("error", () => {});
  const prompt = reviewMode
    ? 'Review only the synthetic code below. Do not use tools, edit files or delegate. Return only JSON {"issueIds":[...]}. Select actual defects from the allowed IDs in the review input; no invented IDs.\n' +
      manifest.reviewInput +
      "\nOrchestrator's review scope:\n" +
      plan +
      ""
    : "Work only in " +
      cwd +
      (". Implement FEATURE.txt. Read the existing source. Do not access files outside this isolated project, credentials, network, other agents or " +
        "providers. Edit only the paths authorized in FEATURE.txt and add behavioral tests. Do not install dependencies or make commits. The external " +
        "harness runs acceptance after completion; do not claim unexecuted tests passed.\nClaude's implementation plan:\n") +
      plan +
      "";
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
    child.stdin.end(prompt);
  }).finally(() => clearTimeout(timer));
  activeChild = undefined;
  if (pending) observe(pending);
  const keys = [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
  ];
  const valid =
    usage &&
    keys.every((key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0) &&
    usage.cached_input_tokens + usage.cache_write_input_tokens <= usage.input_tokens;
  let reviewResult = null;
  if (reviewMode)
    try {
      const result = JSON.parse(summary.replace(/^```(?:json)?\s*|\s*```$/gu, ""));
      if (
        Array.isArray(result.issueIds) &&
        result.issueIds.length <= 10 &&
        result.issueIds.every((id) => typeof id === "string" && /^[a-z-]{1,60}$/u.test(id))
      )
        reviewResult = { issueIds: result.issueIds };
    } catch {}
  const receipt = {
    provider: "codex",
    requestedModel: manifest.model,
    modelVerification: "explicit-cli-model; response-model-not-exposed",
    effort: "medium",
    source: "provider_reported",
    completed: completed && exitCode === 0 && !!valid,
    exitCode,
    usage: valid ? usage : null,
    durationMs: Math.round(performance.now() - start),
    toolCalls,
    errorCount,
    itemTypes: [...itemTypes],
    diagnosticClass: reviewMode
      ? "read-only-review"
      : /read.only|solo lectura/iu.test(summary)
        ? "read-only"
        : /tool|herramienta/iu.test(summary) && toolCalls === 0
          ? "tool-access"
          : toolCalls === 0
            ? "no-observed-file-tools"
            : "file-tools-observed",
    reviewResult,
    rawContentPersisted: false,
  };
  await writeFile(manifest.receipt, JSON.stringify(receipt, null, 2) + "\n");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          completed: receipt.completed,
          summary: summary.slice(0, 600),
          requestedModel: manifest.model,
          usage: receipt.usage,
        }),
      },
    ],
    isError: !receipt.completed,
  };
}
const reader = createInterface({ input: process.stdin });
reader.on("close", () => {
  if (activeChild) terminate(activeChild);
});
reader.on("line", async (line) => {
  if (Buffer.byteLength(line) > 65536) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return;
  try {
    if (request.method === "initialize")
      return reply(request.id, {
        protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vpr-codex-delegation", version: "0.0.0" },
      });
    if (request.method === "ping") return reply(request.id, {});
    if (request.method === "tools/list")
      return reply(request.id, {
        tools: [
          {
            name: "execute",
            description:
              "Delegate this authorized isolated implementation to native Codex with its ChatGPT login. Exactly one call; model and project fixed by owner manifest.",
            inputSchema: {
              type: "object",
              properties: { plan: { type: "string", minLength: 20, maxLength: 6000 } },
              required: ["plan"],
              additionalProperties: false,
            },
          },
        ],
      });
    if (request.method === "tools/call") {
      if (
        used ||
        request.params?.name !== "execute" ||
        typeof request.params?.arguments?.plan !== "string" ||
        request.params.arguments.plan.length < 20 ||
        request.params.arguments.plan.length > 6000
      )
        throw new Error("Invalid, duplicate or unauthorized delegation");
      used = true;
      return reply(request.id, await execute(request.params.arguments.plan));
    }
    reply(request.id, null, { code: -32601, message: "Method not supported" });
  } catch {
    reply(request.id, null, {
      code: -32000,
      message: "Local delegation failed; inspect metadata receipt. No automatic retry.",
    });
  }
});
