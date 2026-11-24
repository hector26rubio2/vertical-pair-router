import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  retrieveCapabilities,
  type CapabilityCard,
  type EmpiricalCapability,
} from "@vpr/knowledge";
import type { CliIo } from "./cli.js";
import { flagValue, moduleDirectory, readFirstJson } from "./models-shared.js";

export const modelQueryUsage =
  "Usage: vpr models query --query <task> [--project <path>]\n";
const verificationWindowMs = 300_000;

interface BenchmarkEvidence {
  observations: EmpiricalCapability[];
  verified: Set<string>;
}

async function readBenchmarkEvidence(
  directory: string,
  now: number,
): Promise<BenchmarkEvidence> {
  const observations: EmpiricalCapability[] = [];
  const verified = new Set<string>();
  try {
    for (const file of await readdir(directory)) {
      if (!/^model-cases-\d+\.json$/u.test(file)) continue;
      const content = await readFile(join(directory, file), "utf8");
      if (Buffer.byteLength(content) > 1_048_576)
        throw new Error("Benchmark report exceeds 1 MiB");
      const report = JSON.parse(content) as {
        at?: string;
        rows?: Record<string, unknown>[];
      };
      if (!Array.isArray(report.rows)) continue;
      for (const [index, row] of report.rows.entries()) {
        if (
          row.modelVerification !== "confirmed" ||
          row.source !== "provider_reported" ||
          typeof row.requestedModel !== "string" ||
          typeof row.complexity !== "string" ||
          typeof row.checksPassed !== "boolean" ||
          typeof row.totalTokens !== "number"
        )
          continue;
        observations.push({
          evidenceId: `${file}:${index}`,
          cardId: row.requestedModel,
          taskTags: [row.complexity, "coding", String(row.taskId)],
          modelConfirmed: true,
          qualityPassed: row.checksPassed,
          totalTokens: row.totalTokens,
          ...(typeof row.requestedEffort === "string"
            ? { requestedEffort: row.requestedEffort }
            : {}),
        });
        const age = now - Date.parse(report.at ?? "");
        if (Number.isFinite(age) && age >= 0 && age < verificationWindowMs)
          verified.add(row.requestedModel);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { observations, verified };
}

export async function runModelQuery(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const query = flagValue(args, "--query");
  if (!query) {
    io.stderr(modelQueryUsage);
    return 2;
  }
  const local = moduleDirectory();
  const catalog = await readFirstJson<{
    checkedAt: string;
    cards: CapabilityCard[];
  }>([
    resolve(local, "../data/model-capabilities.json"),
    resolve(local, "../../../docs/research/model-capability-catalog.json"),
  ]);
  if (!catalog || !Array.isArray(catalog.cards))
    throw new Error("Model capability catalog unavailable");
  const root = resolve(flagValue(args, "--project") ?? process.cwd());
  const now = Date.now();
  const { observations, verified } = await readBenchmarkEvidence(
    join(root, ".vpr", "benchmarks"),
    now,
  );
  const results = retrieveCapabilities({
    queryTags: [query],
    allowedProviders: ["claude", "codex", "copilot"],
    verifiedCardIds: [...verified],
    cards: catalog.cards,
    observations,
    now: new Date(now).toISOString(),
  });
  io.stdout(
    JSON.stringify({
      decisionInferenceTokens: 0,
      catalogCheckedAt: catalog.checkedAt,
      availabilityTtlMs: verificationWindowMs,
      results,
    }) + "\n",
  );
  return 0;
}
