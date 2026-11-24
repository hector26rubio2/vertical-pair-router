import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { runMeasuredClaude } from "./lib/run-measured-claude.mjs";
import { officialCostBreakdown } from "./lib/official-cost-breakdown.mjs";
import { codexReferenceCost } from "./lib/codex-reference-cost.mjs";
import { resolveExecutable } from "@vpr/runtime";
import { runCli } from "@vpr/cli";
if (!process.argv.includes("--approve-provider"))
  throw Error("Explicit cross-provider native usage approval required");
const root = resolve("."),
  directory = join(root, ".tmp", "codex-review-" + Date.now());
await mkdir(directory, { recursive: true });
const [claude, codex] = await Promise.all([
  resolveExecutable("claude"),
  resolveExecutable("codex"),
]);
if (!claude || !codex) throw Error("Native CLIs required");
const claudePrices = JSON.parse(await readFile("docs/research/model-price-catalog.json", "utf8")),
  codexPrices = JSON.parse(await readFile("docs/research/openai-model-price-catalog.json", "utf8"));
const source =
  "export function reserve(state,id,quantity) { if(quantity<=0)return false; state.stock-=quantity; if(state.stock<0)return false; state.orders[id]=quantity; return true; }";
const reviewInput =
  "Review this inventory reservation function. Contracts: quantity must be a positive safe integer, a repeated order ID must not decrement stock again, " +
  "and a rejected reservation must leave stock unchanged. Allowed issue IDs: invalid-quantity, duplicate-order, rejected-stock-mutation, sql-injection, " +
  "network-leak. Report only real defects.\n" +
  source;
const expected = ["duplicate-order", "invalid-quantity", "rejected-stock-mutation"];
const task = {
  id: "R01",
  name: "Revisión de reservas: validación, idempotencia y atomicidad",
  level: "medio",
  kind: "bug-analysis",
  requirement: reviewInput,
  testCount: 4,
};
const report = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  scenario:
    "Claude delegates a bounded read-only synthetic code review to native Codex; no implementation",
  repetitions: 1,
  meteringInferenceTokens: 0,
  tasks: [task],
  rows: [],
  prices: claudePrices,
};
const path = join(directory, "report.json");
const save = () => writeFile(path, JSON.stringify(report, null, 2) + "\n");
for (const model of ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"]) {
  const arm = "sonnet-codex-" + model.replace("gpt-", ""),
    project = join(directory, arm);
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ name: "vpr-review-fixture", private: true, type: "module" }),
  );
  await writeFile(join(project, "review-input.txt"), reviewInput);
  await runCli(["init", "--project", project, "--apply"], {
    stdout() {},
    stderr(text) {
      throw Error(text);
    },
  });
  const profilePath = join(project, ".vpr/profile.json"),
    profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.policy.allowedProviders = ["local", "claude", "codex"];
  profile.policy.allowShell = true;
  await writeFile(profilePath, JSON.stringify(profile));
  const manifest = join(directory, arm + "-manifest.json"),
    receiptPath = join(directory, arm + "-receipt.json");
  await writeFile(
    manifest,
    JSON.stringify({
      project,
      executable: codex,
      model,
      receipt: receiptPath,
      mode: "review",
      reviewInput,
    }),
  );
  const row = {
    taskId: "R01",
    arm,
    project,
    executionRole: "review",
    coordinatorModel: "claude-sonnet-5-5",
    executorModel: model,
    status: "running",
    startedAt: new Date().toISOString(),
    acceptanceHash: createHash("sha256")
      .update(reviewInput + "|" + expected.join(","))
      .digest("hex"),
  };
  report.rows.push(row);
  await save();
  const mcp = {
    mcpServers: {
      vpr_codex: {
        command: process.execPath,
        args: [join(root, "tools/lib/codex-delegation-bridge.mjs"), "--manifest", manifest],
      },
    },
  };
  const agents = {
    "vpr-orchestrator": {
      description: "Delegate bounded code review",
      model: "claude-sonnet-5-5",
      effort: "medium",
      tools: ["Read", "mcp__vpr_codex__execute"],
      prompt:
        "Read review-input.txt and call mcp__vpr_codex__execute exactly once with the review scope. The tool is pinned to a READ-ONLY review. No file edits or " +
        "implementation. Do not independently solve or repeat the review. Summarize returned findings briefly.",
    },
  };
  const args = [
    "--print",
    "--model",
    "claude-sonnet-5-5",
    "--effort",
    "medium",
    "--max-turns",
    "8",
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
    JSON.stringify(mcp),
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--tools",
    "Read",
    "--allowedTools",
    "Read,mcp__vpr_codex__execute",
    "--agents",
    JSON.stringify(agents),
    "--agent",
    "vpr-orchestrator",
  ];
  console.log(JSON.stringify({ phase: "running", task: "R01", arm, report: path }));
  row.receipt = await runMeasuredClaude({
    executable: claude,
    cwd: project,
    args,
    prompt:
      "Delegate review-input.txt to the pinned Codex reviewer exactly once. Review only; no implementation.",
    timeoutMs: 200000,
  });
  try {
    row.codexReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch {
    row.codexReceipt = null;
  }
  const worker = codexReferenceCost(row.codexReceipt?.usage, model, codexPrices);
  row.models = row.receipt.models.map((item) => ({
    ...item,
    provider: "claude",
    role: "orquestador de revisión",
    cost: officialCostBreakdown(item, row.receipt.requests, claudePrices),
  }));
  if (worker) row.models.push({ ...worker, role: "revisor" });
  const actual = row.codexReceipt?.reviewResult?.issueIds ?? [];
  const findings = expected.every((id) => actual.includes(id)),
    noFalsePositives =
      actual.length === 3 &&
      new Set(actual).size === 3 &&
      actual.every((id) => expected.includes(id));
  const inputUnchanged =
    (await readFile(join(project, "review-input.txt"), "utf8")) === reviewInput;
  const calls = row.receipt.tools.filter((item) => item.name === "mcp__vpr_codex__execute");
  row.delegationVerified =
    calls.length === 1 && !calls[0].failed && row.codexReceipt?.completed === true;
  row.checks = {
    own: {
      exitCode: 0,
      passed: 0,
      failed: 0,
      durationMs: 0,
      kind: "not-applicable-read-only-review",
    },
    external: {
      exitCode: findings && noFalsePositives && inputUnchanged ? 0 : 1,
      passed:
        expected.filter((id) => actual.includes(id)).length +
        Number(noFalsePositives && inputUnchanged),
      failed:
        expected.filter((id) => !actual.includes(id)).length +
        Number(!noFalsePositives || !inputUnchanged),
      durationMs: 0,
    },
  };
  row.totals = Object.fromEntries(
    ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"].map(
      (key) => [key, row.models.reduce((sum, item) => sum + item[key], 0)],
    ),
  );
  row.totalCost =
    row.models.length === 2 && row.models.every((item) => item.cost)
      ? {
          min: row.models.reduce((sum, item) => sum + item.cost.totalUsd.min, 0),
          max: row.models.reduce((sum, item) => sum + item.cost.totalUsd.max, 0),
        }
      : null;
  row.status =
    row.delegationVerified &&
    row.receipt.completeAccounting &&
    row.receipt.terminalReceipt?.success &&
    row.checks.external.exitCode === 0
      ? "accepted"
      : "incomplete";
  row.finishedAt = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      phase: "measured",
      arm,
      status: row.status,
      findings: row.codexReceipt?.reviewResult,
      cost: row.totalCost,
      tokens: row.totals,
    }),
  );
}
console.log(JSON.stringify({ report: path }));
