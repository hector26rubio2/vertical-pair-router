import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { resolveExecutable } from "@vpr/runtime";
import { inspectCodexAccount } from "@vpr/runtime";
import { runMeasuredClaude } from "./lib/run-measured-claude.mjs";
import { officialCostBreakdown } from "./lib/official-cost-breakdown.mjs";
import { codexReferenceCost } from "./lib/codex-reference-cost.mjs";
import { verifyFinanzasAnalysis } from "./lib/finanzas-analysis-acceptance.mjs";
if (!process.argv.includes("--approve-provider"))
  throw Error("Explicit native cross-provider authorization required");
const at = process.argv.indexOf("--snapshot");
if (at < 0) throw Error("A frozen existing experiment is required");
const root = resolve("."),
  original = resolve(process.argv[at + 1]);
const directory = join(root, ".tmp", "finanzas-codex-" + Date.now());
await mkdir(directory, { recursive: true });
const flag = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const base = JSON.parse(await readFile(join(original, "report.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(original, "frozen/SOURCE-MANIFEST.json"), "utf8"));
const paths = manifest.files.map((f) => f.path);
const contract = await readFile(join(original, "frozen/ANALYSIS-CONTRACT.txt"), "utf8");
const [claude, codex] = await Promise.all([
  resolveExecutable("claude"),
  resolveExecutable("codex"),
]);
if (!claude || !codex) throw Error("Native Claude and Codex required");
const availability = await inspectCodexAccount();
const wanted = ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"];
const models = wanted.filter((model) => availability.models?.some((m) => m.model === model));
if (models.length !== wanted.length)
  throw Error("Requested priced models must be listed by this native account");
const prices = JSON.parse(await readFile("docs/research/openai-model-price-catalog.json", "utf8"));
const report = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  scenario:
    "Real Finanzas full-stack analysis: Claude Sonnet/Opus delegates read-only analysis to native Codex. Inline source delivery differs from Claude file tools.",
  prices: base.prices,
  tasks: base.tasks,
  rows: [],
  meteringInferenceTokens: 0,
};
const reportPath = join(directory, "report.json");
let saving = Promise.resolve();
const save = () => {
  const text = JSON.stringify(report, null, 2) + "\n";
  saving = saving.then(() => writeFile(reportPath, text));
  return saving;
};
for (const planner of flag("--planners")?.split(",") ?? ["claude-sonnet-5-5", "claude-opus-5-5"])
  for (const model of models.filter(
    (model) => !flag("--models") || flag("--models").split(",").includes(model),
  )) {
    if (!["claude-sonnet-5-5", "claude-opus-5-5"].includes(planner))
      throw Error("Unsupported coordinator");
    const arm =
        planner.replace("claude-", "").replace(/-\d.*$/u, "") +
        "-codex-" +
        model.replace("gpt-", ""),
      project = join(directory, arm);
    await cp(join(original, "frozen"), project, { recursive: true });
    await mkdir(join(project, "analysis"), { recursive: true });
    const receiptPath = join(directory, arm + "-receipt.json"),
      manifestPath = join(directory, arm + "-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        project,
        executable: codex,
        model,
        receipt: receiptPath,
        authorization: "owner-authorized-native-read-only-finanzas-analysis",
        requirement: base.tasks[0].requirement,
      }),
    );
    const mcp = {
      mcpServers: {
        vpr_codex: {
          command: process.execPath,
          args: [
            join(root, "tools/lib/finanzas-codex-analysis-bridge.mjs"),
            "--manifest",
            manifestPath,
          ],
        },
      },
    };
    const agents = {
      "vpr-orchestrator": {
        description: "Plan and delegate full-stack analysis",
        model: planner,
        effort: "medium",
        tools: ["Read", "mcp__vpr_codex__execute"],
        prompt:
          "Read the real snapshot manifest, task spec and relevant source. Define a senior full-stack analysis plan, then call mcp__vpr_codex__execute with that " +
          "plan, ideally below 4000 characters and at most 6000. Permit exactly ONE native model execution. If the tool explicitly reports modelDispatched:false " +
          "and correctionAllowed:true, shorten the invalid plan and correct the call ONCE; no other retry. The model is fixed by the owner manifest. You are " +
          "read-only. Codex returns the analysis JSON and the harness materializes analysis/report.json; no source edits. After it returns read that file and " +
          "summarize unresolved concerns. Do not repeat a started worker or independently replace its artifact.",
      },
    };
    const args = [
      "--print",
      "--model",
      planner,
      "--effort",
      "medium",
      "--max-turns",
      "24",
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
      "--add-dir",
      project,
      "--tools",
      "Read",
      "--allowedTools",
      "Read,mcp__vpr_codex__execute",
      "--agents",
      JSON.stringify(agents),
      "--agent",
      "vpr-orchestrator",
    ];
    const row = {
      taskId: "F01",
      arm,
      project,
      executionRole: "inventory",
      coordinatorModel: planner,
      executorModel: model,
      semanticReview: "pending",
      status: "running",
      startedAt: new Date().toISOString(),
      acceptanceHash: createHash("sha256").update(contract).digest("hex"),
      fixtureHash: base.tasks[0].snapshotHash,
      deliveryConfound:
        "Codex receives the entire selected snapshot inline; Claude uses file reads. No claim of model-only causal comparison.",
    };
    report.rows.push(row);
    await save();
    console.log(JSON.stringify({ phase: "running", arm, report: reportPath }));
    row.receipt = await runMeasuredClaude({
      executable: claude,
      cwd: project,
      args,
      prompt:
        base.tasks[0].requirement +
        " You may not write files. Plan and delegate exactly one native Codex execution through the MCP tool, then review the artifact. An explicitly authorized correction of rejected arguments before dispatch is allowed once.",
      timeoutMs: 360000,
      onSnapshot(value) {
        row.receipt = value;
        void save();
      },
    });
    try {
      row.codexReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    } catch {
      row.codexReceipt = null;
    }
    row.models = row.receipt.models.map((m) => ({
      ...m,
      provider: "claude",
      role: "orquestador y revisión",
      cost: officialCostBreakdown(m, row.receipt.requests, base.prices),
    }));
    const worker = codexReferenceCost(row.codexReceipt?.usage, model, prices);
    if (worker) row.models.push({ ...worker, role: "ejecutor de análisis" });
    row.totals = Object.fromEntries(
      ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"].map(
        (key) => [key, row.models.reduce((s, m) => s + m[key], 0)],
      ),
    );
    row.totalCost =
      row.models.length === 2 && row.models.every((m) => m.cost)
        ? {
            min: row.models.reduce((s, m) => s + m.cost.totalUsd.min, 0),
            max: row.models.reduce((s, m) => s + m.cost.totalUsd.max, 0),
          }
        : null;
    row.checks = {
      own: { exitCode: 0, passed: 0, failed: 0, durationMs: 0, kind: "not-applicable-analysis" },
      external: await verifyFinanzasAnalysis(project, join(original, "frozen"), manifest, paths),
    };
    const calls = row.receipt.tools.filter((t) => t.name === "mcp__vpr_codex__execute");
    row.delegationVerified =
      calls.filter((t) => t.failed === false).length === 1 &&
      calls.length <= 2 &&
      row.codexReceipt?.completed === true;
    row.status =
      row.delegationVerified &&
      row.checks.external.exitCode === 0 &&
      row.receipt.completeAccounting &&
      row.receipt.terminalReceipt?.success
        ? "accepted"
        : "incomplete";
    row.finishedAt = new Date().toISOString();
    await save();
    console.log(
      JSON.stringify({
        phase: "measured",
        arm,
        status: row.status,
        cost: row.totalCost,
        tokens: row.totals,
        checks: row.checks.external,
      }),
    );
  }
await saving;
console.log(JSON.stringify({ report: reportPath }));
