import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { retrieveCapabilities, type CapabilityCard } from "@vpr/knowledge";
import {
  routeWorkflow,
  inspectCodexAccount,
  type WorkflowRoutingRequest,
  type WorkflowCase,
} from "@vpr/runtime";
import type { CliIo } from "./cli.js";
import { readProjectProfile } from "./project-workspace.js";
import { flagValue, moduleDirectory, readFirstJson } from "./models-shared.js";

type ProjectProfile = Awaited<ReturnType<typeof readProjectProfile>>;
type OrchestrationPolicy = NonNullable<ProjectProfile["orchestration"]>;

interface CaseLibraryRow extends WorkflowCase {
  executorEffort?: string;
  plannerEffort?: string;
  executorProvider?: string;
  plannerProvider?: string | null;
}

interface RequestRefinement {
  request: WorkflowRoutingRequest;
  availabilityVerification: string;
}

const inputDeclaredAvailability = "input-declared; not a live provider probe";
const liveCodexAvailability =
  "Codex model/effort and quota: native metadata probe; other providers: input-declared; file-tool access not verified";

async function readWorkflowRequest(
  input: string,
): Promise<WorkflowRoutingRequest> {
  const content = await readFile(resolve(input), "utf8");
  if (Buffer.byteLength(content) > 1_048_576)
    throw new Error("Workflow request exceeds 1 MiB");
  const request = JSON.parse(content) as WorkflowRoutingRequest;
  if (
    !request ||
    ![
      "currentModelId",
      "preferredExecutorId",
      "plannerId",
      "advancedPlannerId",
    ].every(
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
  return request;
}

async function applyCapabilityQuery(
  request: WorkflowRoutingRequest,
  capabilityQuery: string,
  profile: ProjectProfile,
  policy: OrchestrationPolicy,
): Promise<{ request: WorkflowRoutingRequest; capabilityEvidence: unknown[] }> {
  const local = moduleDirectory();
  const cards = (
    await readFirstJson<{ cards: CapabilityCard[] }>([
      resolve(local, "../data/model-capabilities.json"),
      resolve(local, "../../../docs/research/model-capability-catalog.json"),
    ])
  )?.cards;
  if (!Array.isArray(cards))
    throw new TypeError("Capability catalog unavailable");
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
  return {
    request: {
      ...request,
      executorModelIds: [
        ...new Set([...(request.executorModelIds ?? []), ...modelIds]),
      ].slice(0, 20),
    },
    capabilityEvidence: matches.map((match) => ({
      cardId: match.card.id,
      sources: match.card.sources,
      matchedTerms: match.matchedTerms,
      documentedCapabilityOnly: true,
    })),
  };
}

async function applyLiveCodexStatus(
  request: WorkflowRoutingRequest,
  policy: OrchestrationPolicy,
): Promise<RequestRefinement> {
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
    : states.length &&
        states.every((value) => value === "available-at-observation")
      ? "available"
      : "unknown";
  return {
    request: {
      ...request,
      verifiedModelIds: [
        ...request.verifiedModelIds.filter(
          (id) =>
            policy.models.find((model) => model.id === id)?.provider !==
            "codex",
        ),
        ...verifiedCodex,
      ],
      providerCapacity: [
        ...(request.providerCapacity ?? []).filter(
          (item) => item.provider !== "codex",
        ),
        {
          provider: "codex",
          state,
          observedAt: new Date().toISOString(),
          source: "provider_reported",
        },
      ],
    },
    availabilityVerification: liveCodexAvailability,
  };
}

function resolveLocalHistoryRow(
  row: CaseLibraryRow,
  request: WorkflowRoutingRequest,
  policy: OrchestrationPolicy,
): WorkflowCase | undefined {
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
  if (!executor || planner === undefined) return undefined;
  return { ...row, executorId: executor.id, plannerId: planner?.id ?? null };
}

async function loadLocalHistory(
  root: string,
  request: WorkflowRoutingRequest,
  policy: OrchestrationPolicy,
): Promise<WorkflowCase[]> {
  const localHistory: WorkflowCase[] = [];
  try {
    const text = await readFile(
      join(root, ".vpr/benchmarks/workflow-cases.json"),
      "utf8",
    );
    if (Buffer.byteLength(text) > 1_048_576)
      throw new Error("Workflow case library exceeds 1 MiB");
    const library = JSON.parse(text) as { rows?: CaseLibraryRow[] };
    if (!Array.isArray(library.rows))
      throw new TypeError("Invalid local workflow case library");
    for (const row of library.rows) {
      if (
        !row ||
        typeof row.caseId !== "string" ||
        typeof row.executorId !== "string" ||
        typeof row.taskSignature !== "string"
      )
        continue;
      const resolved = resolveLocalHistoryRow(row, request, policy);
      if (resolved) localHistory.push(resolved);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return localHistory;
}

export async function runModelPlan(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const input = flagValue(args, "--input");
  if (!input) {
    io.stderr(
      "Usage: vpr models plan --input <workflow-request.json> [--project <path>]\n",
    );
    return 2;
  }
  const root = resolve(flagValue(args, "--project") ?? process.cwd());
  const profile = await readProjectProfile(root);
  if (!profile.orchestration)
    throw new Error(
      "Configure orchestration before requesting a workflow plan",
    );
  const policy = profile.orchestration;
  let request = await readWorkflowRequest(input);
  let availabilityVerification = inputDeclaredAvailability;
  let capabilityEvidence: unknown[] = [];
  const capabilityQuery = flagValue(args, "--capability-query");
  if (capabilityQuery) {
    const refined = await applyCapabilityQuery(
      request,
      capabilityQuery,
      profile,
      policy,
    );
    request = refined.request;
    capabilityEvidence = refined.capabilityEvidence;
  }
  if (
    args.includes("--live-status") &&
    request.allowedProviders.includes("codex") &&
    profile.policy.allowedProviders?.includes("codex")
  ) {
    const refined = await applyLiveCodexStatus(request, policy);
    request = refined.request;
    availabilityVerification = refined.availabilityVerification;
  }
  const localHistory = await loadLocalHistory(root, request, policy);
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
