import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyFinanzasAnalysis } from "./lib/finanzas-analysis-acceptance.mjs";
import { minimumBenchmarkStandard } from "./lib/minimum-benchmark-standard.mjs";
const flag = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const snapshot = resolve(flag("--snapshot"));
const nativeSources = process.argv.flatMap((arg, i) =>
  arg === "--native-report" ? [resolve(process.argv[i + 1])] : [],
);
const output = resolve(flag("--output") ?? ".vpr/benchmarks/2026-11-17-cost-benefit");
const base = JSON.parse(await readFile(join(output, "data.json"), "utf8"));
const original = JSON.parse(await readFile(join(snapshot, "report.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(snapshot, "frozen/SOURCE-MANIFEST.json"), "utf8"));
const semantic = JSON.parse(await readFile(join(output, "finanzas-semantic-review.json"), "utf8"));
const live = resolve(".tmp/finanzas-live");
await mkdir(live, { recursive: true });
const report = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  prices: original.prices,
  tasks: [...original.tasks],
  rows: [],
  scenario:
    "Real Finanzas experiment; original receipts retained, artifact checks revalidated against published contract",
};
for (const source of nativeSources) {
  const native = JSON.parse(await readFile(source, "utf8"));
  for (const task of native.tasks) {
    const existing = report.tasks.find((t) => t.id === task.id);
    if (!existing) report.tasks.push(task);
    else if (task.expectedArms)
      existing.expectedArms = [
        ...new Set([...(existing.expectedArms ?? []), ...task.expectedArms]),
      ];
  }
  for (const row of native.rows.filter((row) => row.status !== "running")) {
    const staged = row.protocol === "staged-recipe-v1";
    const external = staged
      ? row.checks.external
      : await verifyFinanzasAnalysis(
          row.project,
          join(snapshot, "frozen"),
          manifest,
          manifest.files.map((f) => f.path),
        );
    const minimum = staged
      ? await minimumBenchmarkStandard(
          row,
          native.tasks.find((t) => t.id === row.taskId),
        )
      : null;
    const status = staged
      ? minimum.passed
        ? "accepted"
        : "incomplete"
      : external.exitCode === 0 &&
          row.delegationVerified &&
          row.receipt?.completeAccounting &&
          row.receipt?.terminalReceipt?.success
        ? "accepted"
        : "incomplete";
    const review = Object.entries(semantic.reviews).find(
      ([key, value]) =>
        (value.arm ?? key) === row.arm &&
        value.sourceProject &&
        resolve(value.sourceProject) === resolve(row.project),
    )?.[1];
    report.rows.push({
      ...row,
      minimumStandard: minimum,
      qualityGate: staged ? minimum.passed : row.qualityGate,
      originalStatus: row.status,
      originalArtifactChecks: row.checks.external,
      checks: { ...row.checks, external },
      status,
      sourceReport: source,
      revalidatedAt: report.at,
      revalidationNote:
        "Decision tasks may have files:[] per published contract. Initial validator incorrectly required nonempty files; original result retained.",
      semanticReview: staged
        ? minimum.passed
          ? "passed"
          : "changes-requested"
        : (review?.status ?? (status === "accepted" ? "pending" : "incomplete")),
      semanticAssessment:
        review ??
        (staged && row.qualityReview
          ? {
              status: row.semanticReview,
              strengths: [],
              findings: row.qualityReview.findings.map((f) => ({
                severity: f.severity,
                issue: f.message,
                evidence: f.path + ":" + f.line,
              })),
              conclusion: minimum.passed
                ? "La revisión fresca y los checks aprobaron este artefacto dentro del contrato probado."
                : "No cumple el mínimo: " + minimum.reasons.join("; "),
            }
          : null),
    });
  }
}
const path = join(live, "report.json");
await writeFile(path, JSON.stringify(report, null, 2));
const sources = base.sources.filter(
  (source) => !source.includes("finanzas-live") && !nativeSources.includes(source),
);
const args = ["tools/report-routing-matrix.mjs", "--report", sources[0]];
for (const source of sources.slice(1))
  args.push(source.endsWith("summary.json") ? "--inventory" : "--additional", source);
args.push("--additional", path, "--output", output);
const result = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 1000000 });
if (result.status !== 0) throw Error(result.stderr);
console.log(result.stdout);
console.log(
  JSON.stringify({
    completedRealTrials: report.rows.length,
    rawSources: nativeSources,
    reviewCost: semantic.reviewCost,
  }),
);
