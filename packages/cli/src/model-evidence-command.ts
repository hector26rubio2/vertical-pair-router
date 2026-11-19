import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  retrieveCapabilities,
  type CapabilityCard,
  type EmpiricalCapability,
} from "@vpr/knowledge";
import type { CliIo } from "./cli.js";
import { measureSubscriptionQuota, type SubscriptionSnapshot } from "@vpr/observability";
import { detectSubscriptionPlan } from "./subscription-detection.js";
import { parseProjectProfile } from "@vpr/config";
import {
  routeWorkflow,
  inspectCodexAccount,
  inspectProvider,
  type WorkflowRoutingRequest,
  type WorkflowCase,
} from "@vpr/runtime";

export async function runModelEvidenceCommand(args: readonly string[], io: CliIo): Promise<number> {
  const flag = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  if (args[0] === "prices") {
    const provider = flag("--provider");
    const catalogs: Record<string, { packaged: string; source: string }> = {
      claude: { packaged: "model-prices.json", source: "model-price-catalog.json" },
      codex: { packaged: "openai-model-prices.json", source: "openai-model-price-catalog.json" },
      copilot: {
        packaged: "copilot-model-prices.json",
        source: "copilot-model-price-catalog.json",
      },
    };
    const selected = provider ? catalogs[provider] : undefined;
    if (!selected) {
      io.stderr("Usage: vpr models prices --provider <claude|codex|copilot>\n");
      return 2;
    }
    const local = dirname(fileURLToPath(import.meta.url));
    let catalog: { expiresAt: string; cards: unknown[] } | undefined;
    for (const path of [
      resolve(local, "../data", selected.packaged),
      resolve(local, "../../../docs/research", selected.source),
    ]) {
      try {
        catalog = JSON.parse(await readFile(path, "utf8")) as typeof catalog;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (
      !catalog ||
      !Array.isArray(catalog.cards) ||
      !Number.isFinite(Date.parse(catalog.expiresAt))
    )
      throw new TypeError("Price catalog unavailable");
    io.stdout(
      JSON.stringify({
        provider,
        catalog,
        expired: Date.parse(catalog.expiresAt) < Date.now(),
        inferenceTokens: 0,
        accountAvailabilityVerified: false,
        actualAccountCharge: null,
      }) + "\n",
    );
    return 0;
  }
  if (args[0] === "status") {
    const provider = flag("--provider");
    if (!provider || !["claude", "codex", "copilot"].includes(provider)) {
      io.stderr("Usage: vpr models status --provider <claude|codex|copilot>\n");
      return 2;
    }
    io.stdout(
      JSON.stringify(
        provider === "codex"
          ? await inspectCodexAccount()
          : await inspectProvider(provider as "claude" | "copilot", []),
      ) + "\n",
    );
    return 0;
  }
  if (args[0] === "plan") {
    const input = flag("--input");
    if (!input) {
      io.stderr("Usage: vpr models plan --input <workflow-request.json> [--project <path>]\n");
      return 2;
    }
    const root = resolve(flag("--project") ?? process.cwd());
    const profile = parseProjectProfile(
      JSON.parse(await readFile(join(root, ".vpr/profile.json"), "utf8")),
    );
    if (!profile.orchestration)
      throw new Error("Configure orchestration before requesting a workflow plan");
    const policy = profile.orchestration;
    const content = await readFile(resolve(input), "utf8");
    if (Buffer.byteLength(content) > 1_048_576) throw new Error("Workflow request exceeds 1 MiB");
    let request = JSON.parse(content) as WorkflowRoutingRequest;
    if (
      !request ||
      !["currentModelId", "preferredExecutorId", "plannerId", "advancedPlannerId"].every(
        (key) => typeof request[key as keyof WorkflowRoutingRequest] === "string",
      ) ||
      !Array.isArray(request.allowedProviders) ||
      !request.allowedProviders.every((value) => typeof value === "string") ||
      !Array.isArray(request.verifiedModelIds) ||
      !request.verifiedModelIds.every((value) => typeof value === "string") ||
      !Array.isArray(request.history)
    )
      throw new TypeError("Invalid workflow request");
    if (
      request.executorModelIds !== undefined &&
      (!Array.isArray(request.executorModelIds) ||
        request.executorModelIds.length > 20 ||
        !request.executorModelIds.every((id) => typeof id === "string"))
    )
      throw new TypeError("Invalid executor alternatives");
    let availabilityVerification = "input-declared; not a live provider probe";
    let capabilityEvidence: unknown[] = [];
    const capabilityQuery = flag("--capability-query");
    if (capabilityQuery) {
      const local = dirname(fileURLToPath(import.meta.url));
      let cards: CapabilityCard[] | undefined;
      for (const path of [
        resolve(local, "../data/model-capabilities.json"),
        resolve(local, "../../../docs/research/model-capability-catalog.json"),
      ]) {
        try {
          cards = (JSON.parse(await readFile(path, "utf8")) as { cards: CapabilityCard[] }).cards;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (!Array.isArray(cards)) throw new TypeError("Capability catalog unavailable");
      const matches = retrieveCapabilities({
        queryTags: [capabilityQuery],
        allowedProviders: request.allowedProviders.filter((provider) =>
          profile.policy.allowedProviders?.includes(provider),
        ),
        verifiedCardIds: [],
        cards,
        observations: [],
        now: new Date().toISOString(),
        limit: 20,
      });
      const modelIds = matches.flatMap((match) =>
        policy.models
          .filter(
            (model) =>
              model.provider === match.card.provider &&
              model.model === match.card.model &&
              model.roles.includes(request.executionRole ?? "coding"),
          )
          .map((model) => model.id),
      );
      request = {
        ...request,
        executorModelIds: [...new Set([...(request.executorModelIds ?? []), ...modelIds])].slice(
          0,
          20,
        ),
      };
      capabilityEvidence = matches.map((match) => ({
        cardId: match.card.id,
        sources: match.card.sources,
        matchedTerms: match.matchedTerms,
        documentedCapabilityOnly: true,
      }));
    }
    if (
      args.includes("--live-status") &&
      request.allowedProviders.includes("codex") &&
      profile.policy.allowedProviders?.includes("codex")
    ) {
      const status = await inspectCodexAccount();
      const verifiedCodex = policy.models
        .filter(
          (model) =>
            model.provider === "codex" &&
            status.models.some(
              (item) =>
                item.model === model.model &&
                item.supportedEfforts.includes(model.effort ?? "medium"),
            ),
        )
        .map((model) => model.id);
      const states = status.buckets
        .filter((bucket) => bucket.limitId === "codex")
        .map((bucket) => bucket.delegationCapacity);
      const state = states.includes("limit-reached")
        ? "limit-reached"
        : states.length && states.every((value) => value === "available-at-observation")
          ? "available"
          : "unknown";
      request = {
        ...request,
        verifiedModelIds: [
          ...request.verifiedModelIds.filter(
            (id) => policy.models.find((model) => model.id === id)?.provider !== "codex",
          ),
          ...verifiedCodex,
        ],
        providerCapacity: [
          ...(request.providerCapacity ?? []).filter((item) => item.provider !== "codex"),
          {
            provider: "codex",
            state,
            observedAt: new Date().toISOString(),
            source: "provider_reported",
          },
        ],
      };
      availabilityVerification =
        "Codex model/effort and quota: native metadata probe; other providers: input-declared; file-tool access not verified";
    }
    const localHistory: WorkflowCase[] = [];
    try {
      const text = await readFile(join(root, ".vpr/benchmarks/workflow-cases.json"), "utf8");
      if (Buffer.byteLength(text) > 1_048_576)
        throw new Error("Workflow case library exceeds 1 MiB");
      const library = JSON.parse(text) as {
        rows?: (WorkflowCase & {
          executorEffort?: string;
          plannerEffort?: string;
          executorProvider?: string;
          plannerProvider?: string | null;
        })[];
      };
      if (!Array.isArray(library.rows)) throw new TypeError("Invalid local workflow case library");
      for (const row of library.rows) {
        if (
          !row ||
          typeof row.caseId !== "string" ||
          typeof row.executorId !== "string" ||
          typeof row.taskSignature !== "string"
        )
          continue;
        const executorIds =
          row.plannerId === null
            ? [
                request.currentModelId,
                request.preferredExecutorId,
                ...(request.executorModelIds ?? []),
              ]
            : [
                request.preferredExecutorId,
                ...(request.executorModelIds ?? []),
                request.currentModelId,
              ];
        const executor = executorIds
          .map((id) =>
            policy.models.find(
              (model) =>
                model.id === id &&
                model.provider === row.executorProvider &&
                model.model === row.executorId &&
                (model.effort ?? "medium") === row.executorEffort,
            ),
          )
          .find((model) => model !== undefined);
        const planner =
          row.plannerId === null
            ? null
            : policy.models.find(
                (model) =>
                  [request.plannerId, request.advancedPlannerId].includes(model.id) &&
                  model.provider === row.plannerProvider &&
                  model.model === row.plannerId &&
                  (model.effort ?? "medium") === row.plannerEffort,
              );
        if (!executor || planner === undefined) continue;
        localHistory.push({ ...row, executorId: executor.id, plannerId: planner?.id ?? null });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const result = routeWorkflow(policy, {
      ...request,
      history: [...(request.history as readonly WorkflowCase[]), ...localHistory],
      allowedProviders: request.allowedProviders.filter((provider) =>
        profile.policy.allowedProviders?.includes(provider),
      ),
      now: new Date().toISOString(),
    });
    io.stdout(
      JSON.stringify({
        ...result,
        caseLibraryRowsLoaded: localHistory.length,
        availabilityVerification,
        capabilityEvidence,
      }) + "\n",
    );
    return result.status === "blocked" ? 3 : 0;
  }
  if (args[0] === "quota") {
    const input = flag("--input");
    if (!input) {
      io.stderr("Usage: vpr models quota --input <before-after.json>\n");
      return 2;
    }
    const content = await readFile(resolve(input), "utf8");
    if (Buffer.byteLength(content) > 65536) throw new Error("Quota input exceeds 64 KiB");
    const snapshots = JSON.parse(content) as {
      before: SubscriptionSnapshot;
      after: SubscriptionSnapshot;
      isolated: boolean;
    };
    if (
      !snapshots.before ||
      !snapshots.after ||
      typeof snapshots.isolated !== "boolean" ||
      ![snapshots.before.source, snapshots.after.source].every((source) =>
        ["provider_reported", "user_reported"].includes(source),
      )
    )
      throw new TypeError("Invalid quota snapshots");
    io.stdout(JSON.stringify(measureSubscriptionQuota(snapshots)) + "\n");
    return 0;
  }
  if (args[0] === "subscriptions") {
    const local = dirname(fileURLToPath(import.meta.url));
    let catalog: { expiresAt: string; plans: { id: string }[] } | undefined;
    for (const path of [
      resolve(local, "../data/subscriptions.json"),
      resolve(local, "../../../docs/research/subscription-catalog.json"),
    ]) {
      try {
        catalog = JSON.parse(await readFile(path, "utf8")) as typeof catalog;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!catalog || !Array.isArray(catalog.plans))
      throw new Error("Subscription catalog unavailable");
    const explicitPlan = flag("--plan");
    const detectedPlan = args.includes("--detect")
      ? await detectSubscriptionPlan(flag("--provider") ?? "")
      : null;
    const planId = explicitPlan ?? detectedPlan;
    io.stdout(
      JSON.stringify({
        ...catalog,
        selectedPlan: catalog.plans.find((plan) => plan.id === planId) ?? null,
        selectedPlanId: planId ?? null,
        selectedPlanSource: explicitPlan
          ? "user_reported"
          : detectedPlan
            ? "provider_reported"
            : "unavailable",
        expired: Date.parse(catalog.expiresAt) < Date.now(),
        actualAccountPlanDetected: !!detectedPlan,
        decisionInferenceTokens: 0,
        subscriptionQuotaDelta: null,
      }) + "\n",
    );
    return 0;
  }
  const query = flag("--query");
  if (args[0] !== "query" || !query) {
    io.stderr("Usage: vpr models query --query <task> [--project <path>]\n");
    return 2;
  }
  const local = dirname(fileURLToPath(import.meta.url));
  let catalog: { checkedAt: string; cards: CapabilityCard[] } | undefined;
  for (const path of [
    resolve(local, "../data/model-capabilities.json"),
    resolve(local, "../../../docs/research/model-capability-catalog.json"),
  ]) {
    try {
      catalog = JSON.parse(await readFile(path, "utf8")) as typeof catalog;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!catalog || !Array.isArray(catalog.cards))
    throw new Error("Model capability catalog unavailable");
  const root = resolve(flag("--project") ?? process.cwd());
  const directory = join(root, ".vpr", "benchmarks");
  const observations: EmpiricalCapability[] = [];
  const verified = new Set<string>();
  const now = Date.now();
  try {
    for (const file of await readdir(directory)) {
      if (!/^model-cases-\d+\.json$/u.test(file)) continue;
      const content = await readFile(join(directory, file), "utf8");
      if (Buffer.byteLength(content) > 1_048_576) throw new Error("Benchmark report exceeds 1 MiB");
      const report = JSON.parse(content) as { at?: string; rows?: Record<string, unknown>[] };
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
        if (Number.isFinite(age) && age >= 0 && age < 300_000) verified.add(row.requestedModel);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
      availabilityTtlMs: 300_000,
      results,
    }) + "\n",
  );
  return 0;
}
