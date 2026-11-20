import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { estimateApiReferenceCost } from "@vpr/observability";
const at = process.argv.indexOf("--report");
if (at < 0 || !process.argv[at + 1]) throw new Error("--report required");
const path = resolve(process.argv[at + 1]);
const report = JSON.parse(await readFile(path, "utf8"));
const catalog = JSON.parse(await readFile("docs/research/model-price-catalog.json", "utf8"));
const baseline = report.rows.find((row) => row.arm === "baseline");
const rows = report.rows.map((row) => {
  const checksPassed =
    row.ownChecks?.exitCode === 0 && row.acceptanceChecks?.exitCode === 0 && row.allowedChanges;
  const comparableQuality =
    checksPassed &&
    baseline?.checksPassed &&
    baseline.baseTree === row.baseTree &&
    row.modelVerification === "confirmed";
  const hasCounters = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].every(
    (key) => Number.isSafeInteger(row[key]) && row[key] >= 0,
  );
  const cost = hasCounters
    ? estimateApiReferenceCost(
        {
          ...row,
          observedModel: row.observedModels?.[0],
          modelConfirmed: row.modelVerification === "confirmed" && row.observedModels.length === 1,
          requestCount: Object.keys(row.toolCounts).length ? 2 : 1,
          now: new Date().toISOString(),
        },
        catalog,
      )
    : null;
  return {
    arm: row.arm,
    model: row.observedModels?.[0] ?? null,
    totalTokens: row.totalTokens,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    qualityPassed: checksPassed,
    processExitCode: row.exitCode,
    stopped: row.stopped,
    durationMs: row.durationMs,
    tokenDeltaPercent:
      comparableQuality && baseline.totalTokens > 0
        ? 100 * (row.totalTokens / baseline.totalTokens - 1)
        : null,
    completeRuntimeComparison: comparableQuality && row.exitCode === 0 && row.stopped === null,
    apiReferenceCost: cost,
    quotaSavingPercent: null,
    costUnavailableReason: cost
      ? null
      : "No confirmed per-request context tier or complete counters; cumulative context must not be priced as a single request",
  };
});
const summary = {
  sourceReport: path,
  acceptanceHash: report.acceptanceHash,
  exploratory: true,
  measuredTokensIncludingFailedAttempts: rows.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0),
  unmeasuredAttemptCount: rows.filter((row) => row.totalTokens === null).length,
  quotaSavingPercent: null,
  subscriptionLifetimeIncrease: null,
  warning:
    "One trial per arm, fixed order and cache reuse. Failed attempts are retained. API reference costs are independent of included subscription quota. Process timeouts remain visible.",
  rows,
};
const target = join(dirname(path), "summary.json");
await writeFile(target, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ target, ...summary }, null, 2));
