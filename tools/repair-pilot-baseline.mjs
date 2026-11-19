import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { runMeasuredClaude } from "./lib/run-measured-claude.mjs";
import { resolveExecutable } from "../packages/runtime/dist/index.js";

const at = process.argv.indexOf("--report");
if (!process.argv.includes("--approve-provider") || at < 0)
  throw new Error("--approve-provider --report required");
const reportPath = resolve(process.argv[at + 1]);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const row = report.rows.find((row) => row.arm === "sonnet-solo");
if (
  !row ||
  row.status !== "incomplete" ||
  dirname(dirname(reportPath)) !== resolve(".tmp") ||
  dirname(row.cwd) !== dirname(reportPath)
)
  throw new Error("Repair only a bounded incomplete pilot baseline");
if (row.repairAttempts?.length)
  throw new Error("One repair maximum; preserve and inspect previous evidence");
const executable = await resolveExecutable("claude");
if (!executable) throw new Error("Claude unavailable");
let saving = Promise.resolve();
const save = () => {
  const content = JSON.stringify(report, null, 2) + "\n";
  saving = saving.then(() => writeFile(reportPath, content));
  return saving;
};
const attempt = {
  role: "sole-executor-reviewer",
  reason:
    "Own durability test cleanup failed EPERM: remove temporary directory after both servers and DB connections close, including on assertion failure",
  status: "running",
};
row.repairAttempts = [attempt];
await save();
const agents = {
  "vpr-baseline": {
    description: "Repairs own generated test cleanup",
    model: "claude-sonnet-5-5",
    effort: "medium",
    tools: ["Read", "Edit", "Write"],
    prompt:
      "Fix only your generated test cleanup using the exact observed failure. Do not change feature behavior, specification, package files or existing " +
      "base.test.mjs. Every server/DB must close before deleting its directory, including after assertion failures. The deterministic harness runs checks; do " +
      "not claim execution. No delegation or subprocesses. Finish with a short summary.",
  },
};
const args = [
  "--print",
  "--model",
  "claude-sonnet-5-5",
  "--effort",
  "medium",
  "--max-turns",
  "6",
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
  row.cwd,
  "--tools",
  "Read,Edit,Write",
  "--allowedTools",
  "Read,Edit,Write",
  "--agents",
  JSON.stringify(agents),
  "--agent",
  "vpr-baseline",
];
console.log(JSON.stringify({ phase: "repair-own-tests", reportPath, model: "claude-sonnet-5-5" }));
attempt.receipt = await runMeasuredClaude({
  executable,
  cwd: row.cwd,
  args,
  timeoutMs: 90000,
  prompt:
    "Read test/reservations.test.mjs. The state survives reopen test fails in context.after with EPERM because rmSync is registered before the second " +
    "server/store cleanup. Fix with try/finally that closes first and second instances before deleting the temporary directory. Preserve all assertions. Do " +
    "not edit src/.",
  onSnapshot(value) {
    attempt.receipt = value;
    void save();
  },
});
async function check(external) {
  const start = performance.now();
  const child = spawn(
    process.execPath,
    [
      "--test",
      "--test-isolation=none",
      "--test-timeout=5000",
      "--test-reporter=tap",
      external ? resolve("tools/lib/inventory-acceptance.mjs") : "test/*.test.mjs",
    ],
    {
      cwd: row.cwd,
      env: { ...process.env, VPR_PILOT_PROJECT: row.cwd },
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  let text = "";
  const timer = setTimeout(() => child.kill(), 12000);
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (data) => {
      if (text.length < 50000) text += data;
    });
    child.once("close", done);
  }).finally(() => clearTimeout(timer));
  const number = (name) => Number(text.match(new RegExp("# " + name + " (\\d+)"))?.[1] ?? 0);
  return {
    exitCode,
    passed: number("pass"),
    failed: number("fail"),
    cancelled: number("cancelled"),
    durationMs: Math.round(performance.now() - start),
  };
}
attempt.checks = { own: await check(false), acceptance: await check(true) };
attempt.status =
  attempt.checks.own.exitCode === 0 &&
  attempt.checks.acceptance.exitCode === 0 &&
  attempt.receipt.completeAccounting &&
  attempt.receipt.terminalReceipt?.success
    ? "accepted"
    : "incomplete";
row.statusAfterRepair = attempt.status;
await save();
await saving;
console.log(JSON.stringify({ reportPath, attempt }));
