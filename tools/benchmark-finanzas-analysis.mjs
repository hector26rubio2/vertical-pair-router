import { mkdir, cp, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { resolveExecutable } from "@vpr/runtime";
import { runMeasuredClaude } from "./lib/run-measured-claude.mjs";
import { officialCostBreakdown } from "./lib/official-cost-breakdown.mjs";
import { verifyFinanzasAnalysis } from "./lib/finanzas-analysis-acceptance.mjs";

if (!process.argv.includes("--approve-provider"))
  throw Error("Explicit native-provider authorization required");
const flag = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const root = resolve("."),
  source = resolve(flag("--source") ?? "D:/estudio/finanzas");
const directory = resolve(
  flag("--resume") ?? join(root, ".tmp", "finanzas-analysis-" + Date.now()),
);
if (
  dirname(directory) !== join(root, ".tmp") ||
  !basename(directory).startsWith("finanzas-analysis-")
)
  throw Error("Use an isolated finanzas-analysis directory");
const frozen = join(directory, "frozen");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const paths = [
  ".scratch/gestor-finanzas-importador-datos/spec.md",
  "gestor-Finanzas/src/app/features/movements/importar/importar-movimientos.ts",
  "gestor-Finanzas/src/app/features/movements/importar/importar-movimientos.html",
  "gestor-Finanzas/src/app/features/movements/importar/importar-movimientos.spec.ts",
  "gestor-Finanzas/src/app/features/movements/importar/extracto-parse.ts",
  "gestor-Finanzas/src/app/features/movements/importar/extracto-parse.spec.ts",
  "gestor-Finanzas/src/app/core/utils/csv.ts",
  "gestor-Finanzas/src/app/core/state/view-model.ts",
  "gestor-Finanzas/src/app/core/api/ledger.api.ts",
  "gestor-Finanzas/src/app/core/api/privacy.api.ts",
  "gestor-Finanzas/src/app/core/api/api-writes.ts",
  "gestor-Finanzas/src/app/shared/movements/movements-book.service.ts",
  "v2-api-finanzas/src/Finanzas.Host/Endpoints/PersonalDataEndpoints.cs",
  "v2-api-finanzas/src/Finanzas.Host/Endpoints/LedgerEndpoints.cs",
  "v2-api-finanzas/src/Finanzas.Application/PersonalData/PersonalDataPorts.cs",
  "v2-api-finanzas/src/Finanzas.Application/Ledger/LedgerUseCases.cs",
  "v2-api-finanzas/src/Finanzas.Contracts/Ledger/MovementRequests.cs",
  "v2-api-finanzas/src/Finanzas.Infrastructure/Persistence/PersonalData/PersonalDataExporter.cs",
  "v2-api-finanzas/src/Finanzas.Infrastructure/Persistence/PersonalData/PersonalDataService.cs",
  "v2-api-finanzas/src/Finanzas.Infrastructure/Persistence/Queries/Ledger/LedgerStore.cs",
  "v2-api-finanzas/src/Finanzas.Infrastructure/Persistence/Queries/Ledger/MovementRules.cs",
  "finanzas-importador/README.md",
  "finanzas-importador/src/finanzas_importador/__init__.py",
  "finanzas-importador/src/finanzas_importador/drafts.py",
  "finanzas-importador/src/finanzas_importador/pdf.py",
  "finanzas-importador/src/finanzas_importador/templates.py",
  "finanzas-importador/src/finanzas_importador/service.py",
  "finanzas-importador/tests/test_drafts.py",
  "finanzas-importador/tests/test_templates.py",
  "finanzas-importador/tests/test_service.py",
];
const requirement =
  "Actúa como ingeniero senior full stack sobre esta instantánea real, parcial y con cambios locales de Finanzas. El owner quiere implementar la feature " +
  "descrita en .scratch/gestor-finanzas-importador-datos/spec.md. Investiga el código disponible y diseña un plan ejecutable que distinga lo ya " +
  "implementado de lo propuesto, identifique riesgos y decisiones pendientes, detalle tareas/dependencias por capa, estrategia de migración, rollback y " +
  "pruebas de aceptación. No supongas que los distintos mecanismos de importación/exportación son equivalentes. No implementes la feature ni cambies " +
  "código. No inventes endpoints, garantías ni decisiones del owner. Sólo puedes escribir analysis/report.json. Los archivos disponibles están en " +
  "SOURCE-MANIFEST.json; el repositorio completo y la base de datos no están disponibles. No ejecutes comandos ni delegues de nuevo si eres el ejecutor. " +
  "El contrato del informe está en ANALYSIS-CONTRACT.txt. La calidad semántica se revisa aparte; cumplir la estructura no demuestra que el plan sea " +
  "correcto.";
const contract =
  "Write JSON analysis/report.json with: summary:string; currentFlows:array of {name,status,evidence:[{path,line,quote}]}; risks:array of " +
  "{title,impact,evidence:[{path,line,quote}],mitigation}; tasks:array of {id,title,layer,files:string[],dependsOn:string[],acceptance:string[]}; " +
  "openDecisions:string[]; migration:string[]; rollback:string[]; testPlan:array of {name,layer,acceptance}. Evidence must cite copied source paths, " +
  "exact 1-based line numbers and an exact nonblank substring of that line (8..180 chars). At least 3 currentFlows, 5 evidence-backed risks, 8 " +
  "dependency-linked tasks, 3 open decisions, 3 test scenarios. All arrays should contain substantive engineering content. Paths of proposed new files " +
  "are allowed in tasks, not as evidence. Return JSON only in the file, finish with a brief summary. No source edits or external calls.";
await mkdir(frozen, { recursive: true });
if (!flag("--resume")) {
  for (const name of paths) {
    await mkdir(dirname(join(frozen, name)), { recursive: true });
    await cp(join(source, name), join(frozen, name));
  }
  const manifest = await Promise.all(
    paths.map(async (name) => {
      const buffer = await readFile(join(frozen, name));
      return {
        path: name,
        bytes: buffer.length,
        sha256: hash(buffer),
        lines: buffer.toString("utf8").split(/\r?\n/u).length,
      };
    }),
  );
  await writeFile(
    join(frozen, "SOURCE-MANIFEST.json"),
    JSON.stringify(
      {
        scope:
          "Partial current working-copy snapshot; no secrets, database, logs or real statements",
        files: manifest,
      },
      null,
      2,
    ),
  );
  await writeFile(join(frozen, "ANALYSIS-CONTRACT.txt"), contract);
}
const prices = JSON.parse(await readFile("docs/research/model-price-catalog.json", "utf8"));
const manifest = JSON.parse(await readFile(join(frozen, "SOURCE-MANIFEST.json"), "utf8"));
const reportPath = join(directory, "report.json");
const report = flag("--resume")
  ? JSON.parse(await readFile(reportPath, "utf8"))
  : {
      schemaVersion: 1,
      at: new Date().toISOString(),
      scenario:
        "Real partial Finanzas snapshot: full-stack requirements and architecture analysis; no implementation",
      prices,
      meteringInferenceTokens: 0,
      tasks: [
        {
          id: "F01",
          name: "Diseñar la integración real de importación de datos en Finanzas",
          level: "complejo · análisis full stack",
          kind: "requirements",
          executionRole: "inventory",
          requirement,
          testCount: 8,
          sourceFiles: manifest.files.length,
          sourceCharacters: manifest.files.reduce((s, f) => s + f.bytes, 0),
          snapshotHash: hash(JSON.stringify(manifest)),
          qualityScope:
            "Artifact structure and exact source citations only; semantic engineering review required",
        },
      ],
      rows: [],
    };
let saving = Promise.resolve();
const save = () => {
  const text = JSON.stringify(report, null, 2) + "\n";
  saving = saving.then(() => writeFile(reportPath, text));
  return saving;
};
const claude = await resolveExecutable("claude");
if (!claude) throw Error("Claude unavailable");
const arms = [
  { id: "haiku-solo", executor: "claude-haiku-5-5" },
  { id: "sonnet-haiku", planner: "claude-sonnet-5-5", executor: "claude-haiku-5-5" },
  { id: "opus-haiku", planner: "claude-opus-5-5", executor: "claude-haiku-5-5" },
  { id: "sonnet-solo", executor: "claude-sonnet-5-5" },
  { id: "opus-solo", executor: "claude-opus-5-5" },
];
const selected = flag("--arms")?.split(",");
if (selected?.some((id) => !arms.some((a) => a.id === id))) throw Error("Unknown strategy");

for (const arm of arms.filter((a) => !selected || selected.includes(a.id))) {
  if (report.rows.some((r) => r.arm === arm.id)) continue;
  const project = join(directory, arm.id);
  await cp(frozen, project, { recursive: true });
  await mkdir(join(project, "analysis"), { recursive: true });
  const executorPrompt =
    "Use Read on SOURCE-MANIFEST.json, ANALYSIS-CONTRACT.txt and the relevant copied source. " +
    requirement;
  const agents = arm.planner
    ? {
        "vpr-orchestrator": {
          description: "Analyze and delegate the architecture artifact",
          model: arm.planner,
          effort: "medium",
          tools: ["Read", "Agent(vpr-executor)"],
          prompt:
            "You are the read-only senior planner/reviewer. Investigate the real source, define the plan and delegate the report to exactly ONE foreground " +
            "vpr-executor. Do not override its model. After return, read the artifact and summarize unresolved concerns. Do not implement edits yourself or start " +
            "another worker.",
        },
        "vpr-executor": {
          description: "Create architecture report",
          model: arm.executor,
          effort: "medium",
          tools: ["Read", "Write", "Edit"],
          prompt: executorPrompt,
        },
      }
    : {
        "vpr-baseline": {
          description: "Analyze the full-stack feature alone",
          model: arm.executor,
          effort: "medium",
          tools: ["Read", "Write", "Edit"],
          prompt: executorPrompt,
        },
      };
  const args = [
    "--print",
    "--model",
    arm.planner ?? arm.executor,
    "--effort",
    "medium",
    "--max-turns",
    "35",
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
    arm.planner ? "vpr-orchestrator" : "vpr-baseline",
  ];
  const row = {
    taskId: "F01",
    arm: arm.id,
    project,
    executionRole: "inventory",
    coordinatorModel: arm.planner ?? null,
    executorModel: arm.executor,
    status: "running",
    startedAt: new Date().toISOString(),
    acceptanceHash: hash(contract),
    fixtureHash: hash(JSON.stringify(manifest)),
    semanticReview: "pending",
  };
  report.rows.push(row);
  await save();
  console.log(
    JSON.stringify({
      phase: "running",
      arm: arm.id,
      report: reportPath,
      files: manifest.files.length,
    }),
  );
  row.receipt = await runMeasuredClaude({
    executable: claude,
    cwd: project,
    args,
    prompt: requirement + (arm.planner ? " Delegate the artifact to vpr-executor." : ""),
    timeoutMs: 300000,
    onSnapshot(value) {
      row.receipt = value;
      void save();
    },
  });
  row.checks = {
    own: { exitCode: 0, passed: 0, failed: 0, durationMs: 0, kind: "not-applicable-analysis" },
    external: await verifyFinanzasAnalysis(project, frozen, manifest, paths),
  };
  const calls = row.receipt.tools.filter((t) => t.name === "Agent" && !t.parentToolUseId);
  row.delegationVerified = arm.planner
    ? calls.length === 1 &&
      calls[0].failed === false &&
      calls[0].endMs !== null &&
      !row.receipt.tools.some((t) => !t.parentToolUseId && ["Write", "Edit"].includes(t.name))
    : calls.length === 0;
  const wanted = [arm.planner, arm.executor].filter(Boolean);
  row.modelIntegrity =
    wanted.every((id) => row.receipt.models.some((m) => m.model === id)) &&
    row.receipt.models.every((m) => wanted.includes(m.model));
  row.models = row.receipt.models.map((model) => ({
    ...model,
    role: arm.planner
      ? model.model === arm.executor
        ? "ejecutor de análisis"
        : "orquestador y revisión"
      : "analista único",
    cost: officialCostBreakdown(model, row.receipt.requests, prices),
  }));
  row.totalCost =
    row.models.length && row.models.every((m) => m.cost)
      ? {
          min: row.models.reduce((s, m) => s + m.cost.totalUsd.min, 0),
          max: row.models.reduce((s, m) => s + m.cost.totalUsd.max, 0),
        }
      : null;
  row.status =
    row.checks.external.exitCode === 0 &&
    row.delegationVerified &&
    row.modelIntegrity &&
    row.receipt.completeAccounting &&
    row.receipt.terminalReceipt?.success
      ? "accepted"
      : "incomplete";
  row.finishedAt = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      phase: "measured",
      arm: arm.id,
      status: row.status,
      checks: row.checks.external,
      cost: row.totalCost,
      tokens: row.receipt.totals,
      semanticReview: row.semanticReview,
    }),
  );
}
await saving;
console.log(JSON.stringify({ report: reportPath }));
