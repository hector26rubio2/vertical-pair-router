import { runMeasuredClaude } from "./run-measured-claude.mjs";
import { officialCostBreakdown } from "./official-cost-breakdown.mjs";
import { codexReferenceCost } from "./codex-reference-cost.mjs";
import { readFile } from "node:fs/promises";
export const recipeModels = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  terra: "gpt-6.1-terra",
  sol: "gpt-6.1-sol",
};
export const codexMeasuredRecipes = [
  {
    id: "sonnet-codex-terra",
    steps: [
      ["plan", "sonnet"],
      ["implement", "terra"],
    ],
  },
  {
    id: "sonnet-codex-sol",
    steps: [
      ["plan", "sonnet"],
      ["implement", "sol"],
    ],
  },
  {
    id: "opus-codex-terra",
    steps: [
      ["plan", "opus"],
      ["implement", "terra"],
    ],
  },
  {
    id: "opus-codex-sol",
    steps: [
      ["plan", "opus"],
      ["implement", "sol"],
    ],
  },
];
export const measuredRecipes = [
  { id: "haiku-solo", steps: [["implement", "haiku"]] },
  { id: "sonnet-solo", steps: [["implement", "sonnet"]] },
  { id: "opus-solo", steps: [["implement", "opus"]] },
  {
    id: "sonnet-haiku",
    steps: [
      ["plan", "sonnet"],
      ["implement", "haiku"],
    ],
  },
  {
    id: "opus-haiku",
    steps: [
      ["plan", "opus"],
      ["implement", "haiku"],
    ],
  },
  {
    id: "opus-sonnet-haiku",
    steps: [
      ["architecture", "opus"],
      ["technical-plan", "sonnet"],
      ["implement", "haiku"],
    ],
  },
];
export const reviewSchema = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          path: { type: "string" },
          line: { type: "integer" },
          quote: { type: "string" },
          message: { type: "string" },
        },
        required: ["severity", "path", "line", "quote", "message"],
        additionalProperties: false,
      },
    },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: ["approved", "findings", "limitations"],
  additionalProperties: false,
};

export async function measuredRecipePhase({
  executable,
  cwd,
  model,
  phase,
  prompt,
  allowedWrites = [],
  schema,
  timeoutMs = 180000,
  onSnapshot,
}) {
  if (model.startsWith("gpt-")) {
    const { runNativeAgent } = await import("@vpr/runtime");
    const catalog = JSON.parse(
      await readFile(
        new URL("../../docs/research/openai-model-price-catalog.json", import.meta.url),
        "utf8",
      ),
    );
    const result = await runNativeAgent({
      model: {
        id: model,
        provider: "codex",
        model,
        effort: "medium",
        roles: ["coding"],
        tier: "standard",
      },
      cwd,
      prompt,
      sessionId: "benchmark-" + Date.now(),
      phase: phase === "implement" ? "implement" : "plan",
      writeFiles: allowedWrites.length > 0,
      allowedPaths: allowedWrites.length ? allowedWrites : ["."],
      allowShell: true,
      timeoutMs,
      codexPrices: catalog,
      task: "F02 importación CSV · " + phase,
    });
    const models = result.usage.map((u) => {
      const input = u.inputTokens,
        output = u.outputTokens,
        read = u.cacheReadTokens,
        write = u.cacheWriteTokens;
      const priced = codexReferenceCost(
        {
          input_tokens: input + read + write,
          output_tokens: output,
          cached_input_tokens: read,
          cache_write_input_tokens: write,
        },
        model,
        catalog,
      );
      return {
        model,
        provider: "codex",
        role: phase,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: read,
        cacheWriteTokens: write,
        totalTokens: input + output + read + write,
        cost: priced?.cost ?? null,
        modelIdentity: "requested-only",
      };
    });
    const complete =
      result.usage.length > 0 &&
      models.every((m) =>
        ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].every(
          (k) => Number.isSafeInteger(m[k]) && m[k] >= 0,
        ),
      );
    const receipt = {
      models,
      completeAccounting: complete,
      requests: [],
      timings: { wallMs: result.wallMs },
      terminalReceipt: { success: result.success },
      tools: [],
      compactions: [],
      stopped: result.failure,
      contextMeasurement:
        "Native CLI exposes cumulative turn counters; individual request context is unavailable. Requested model identity only.",
    };
    onSnapshot?.(receipt);
    return {
      phase,
      model,
      requestedEffort: "medium",
      receipt,
      answer: result.answer,
      structured: null,
      answerTruncated: result.answerTruncated,
    };
  }
  let answer = "",
    structured = null;
  const writes = allowedWrites.flatMap((path) => ["Write(./" + path + ")", "Edit(./" + path + ")"]);
  const args = [
    "--print",
    "--model",
    model,
    "--effort",
    "medium",
    "--max-turns",
    phase === "implement" ? "25" : "15",
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
    "default",
    "--permission-prompts",
    "none",
    "--add-dir",
    cwd,
    "--tools",
    writes.length ? "Read,Write,Edit" : "Read",
    "--allowedTools",
    [
      "Read(./src/**)",
      "Read(./api-reference/**)",
      "Read(./gestor-Finanzas/**)",
      "Read(./v2-api-finanzas/**)",
      "Read(./finanzas-importador/**)",
      "Read(./.scratch/**)",
      "Read(./analysis/**)",
      "Read(./SOURCE-MANIFEST.json)",
      "Read(./ANALYSIS-CONTRACT.txt)",
      "Read(./TASK.txt)",
      "Read(./CHECK-EVIDENCE.json)",
      "Read(./CHANGESET.patch)",
      "Read(./tsconfig.json)",
      ...writes,
    ].join(","),
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  const receipt = await runMeasuredClaude({
    executable,
    cwd,
    args,
    prompt,
    timeoutMs,
    onSnapshot,
    onResult(event) {
      answer = String(event.result ?? "");
      structured = event.structured_output ?? null;
    },
  });
  return {
    phase,
    model,
    requestedEffort: "medium",
    receipt,
    answer: answer.slice(0, 30000),
    structured,
    answerTruncated: answer.length > 30000,
  };
}

export function mergeRecipeReceipts(phases, prices) {
  const requests = phases.flatMap((p, index) =>
    (p.receipt.requests ?? []).map((request) => ({
      ...request,
      id: index + ":" + request.id,
      phase: p.phase,
    })),
  );
  const ids = [...new Set(phases.flatMap((p) => p.receipt.models.map((m) => m.model)))];
  const keys = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens",
  ];
  const models = ids.map((model) => {
    const values = phases.flatMap((p) => p.receipt.models.filter((m) => m.model === model));
    const counters = Object.fromEntries(
      keys.map((key) => [key, values.reduce((sum, m) => sum + m[key], 0)]),
    );
    const role = [
      ...new Set(
        phases.filter((p) => p.receipt.models.some((m) => m.model === model)).map((p) => p.phase),
      ),
    ].join(" + ");
    const codex = values.some((value) => value.provider === "codex");
    const result = { model, ...counters, role, provider: codex ? "codex" : "claude" };
    const cost = codex ? mergeCodexCosts(values) : officialCostBreakdown(result, requests, prices);
    return { ...result, cost };
  });
  const complete = phases.length > 0 && phases.every((p) => p.receipt.completeAccounting);
  const totals = Object.fromEntries(
    keys.map((key) => [key, models.reduce((sum, m) => sum + m[key], 0)]),
  );
  return {
    models,
    totalCost:
      complete && models.length && models.every((m) => m.cost)
        ? {
            min: models.reduce((sum, m) => sum + m.cost.totalUsd.min, 0),
            max: models.reduce((sum, m) => sum + m.cost.totalUsd.max, 0),
          }
        : null,
    receipt: {
      accounting: complete
        ? "whole-tree-per-phase-provider-reported"
        : "observed-phase-lower-bound",
      completeAccounting: complete,
      requests,
      totals,
      timings: { wallMs: phases.reduce((sum, p) => sum + p.receipt.timings.wallMs, 0) },
      terminalReceipt: { success: phases.every((p) => p.receipt.terminalReceipt?.success) },
      tools: phases.flatMap((p) => p.receipt.tools.map((t) => ({ ...t, phase: p.phase }))),
      compactions: phases.flatMap((p) =>
        (p.receipt.compactions ?? []).map((c) => ({ ...c, phase: p.phase })),
      ),
    },
  };
}

function mergeCodexCosts(values) {
  if (!values.length || values.some((v) => !v.cost)) return null;
  const keys = ["inputUsd", "outputUsd", "cacheReadUsd", "cacheWriteUsd", "totalUsd"];
  return {
    ...values[0].cost,
    ...Object.fromEntries(
      keys.map((key) => [
        key,
        {
          min: values.reduce((s, v) => s + v.cost[key].min, 0),
          max: values.reduce((s, v) => s + v.cost[key].max, 0),
        },
      ]),
    ),
    unknownContextTier: values.some((v) => v.cost.unknownContextTier),
    contextPromptUpperBound:
      Math.max(...values.map((v) => v.cost.contextPromptUpperBound ?? 0)) || null,
  };
}
