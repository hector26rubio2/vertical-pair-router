export interface AgentModel {
  readonly id: string;
  readonly provider: "claude" | "codex" | "copilot";
  readonly model: string;
  readonly effort?: "low" | "medium" | "high";
  readonly tier: "light" | "standard" | "high";
  readonly roles: readonly ("orchestrator" | "inventory" | "coding" | "review")[];
}
export interface AgentRoutingPolicy {
  readonly objective?: "tokens" | "reference-cost" | "subscription-quota";
  readonly orchestratorId: string;
  readonly maxWorkers: number;
  readonly allowLightCoding: boolean;
  readonly models: readonly AgentModel[];
}
export type WorkflowKind =
  | "team-conflict"
  | "feature"
  | "requirements"
  | "bug-analysis"
  | "bugfix"
  | "init"
  | "refactor"
  | "project-analysis"
  | "improvement";
type ExecutionRole = "coding" | "review" | "inventory";
type Complexity = "simple" | "normal" | "complex";
type Risk = "low" | "medium" | "high";
export interface WorkflowCase {
  readonly caseId: string;
  readonly taskKind: WorkflowKind;
  readonly executionRole?: ExecutionRole;
  readonly taskSignature: string;
  readonly complexity: Complexity;
  readonly risk: Risk;
  readonly plannerId: string | null;
  readonly technicalPlannerId?: string | null;
  readonly reviewerId?: string | null;
  readonly executorId: string;
  readonly accepted: boolean;
  readonly modelConfirmed: boolean;
  readonly completeAccounting: boolean;
  readonly usdMax: number;
  readonly pricesExpireAt: string;
}
export interface WorkflowRoles {
  readonly currentModelId: string;
  readonly preferredExecutorId: string;
  readonly plannerId: string;
  readonly advancedPlannerId: string;
  readonly executorModelIds: readonly string[];
  readonly technicalPlannerId?: string;
  readonly reviewerId?: string;
}
export interface WorkflowRoutingRequest {
  readonly kind: WorkflowKind;
  readonly executionRole?: ExecutionRole;
  readonly taskSignature: string;
  readonly complexity: Complexity;
  readonly risk: Risk;
  readonly hasAcceptanceChecks: boolean;
  readonly needsPlanning: boolean;
  readonly currentModelId?: string;
  readonly preferredExecutorId?: string;
  readonly executorModelIds?: readonly string[] | "eligible";
  readonly providerCapacity?: readonly {
    readonly provider: string;
    readonly state: "available" | "limit-reached" | "unknown";
    readonly observedAt: string;
    readonly source: "provider_reported";
  }[];
  readonly requireKnownCapacity?: boolean;
  readonly fallbackIneligibleRoles?: boolean;
  readonly plannerId?: string;
  readonly advancedPlannerId?: string;
  readonly technicalPlannerId?: string;
  readonly reviewerId?: string;
  readonly planningMode?: "auto" | "two-stage" | "three-stage";
  readonly allowedProviders: readonly string[];
  readonly verifiedModelIds: readonly string[];
  readonly history: readonly WorkflowCase[] | ((roles: WorkflowRoles) => readonly WorkflowCase[]);
  readonly now: string;
}

type Request = WorkflowRoutingRequest;
type ResolvedRequest = Omit<Request, "history"> &
  WorkflowRoles & { history: readonly WorkflowCase[] };
type Candidate = {
  plannerId: string | null;
  technicalPlannerId: string | null;
  reviewerId: string | null;
  executorId: string;
  evidenceIds: string[];
  evidenceTruncated: boolean;
  samples: number;
  qualityRate: number | null;
  usdPerAccepted: number | null;
};
type Model = AgentModel | undefined;

const tierRank = { light: 0, standard: 1, high: 2 };
const workflowKinds = [
  "team-conflict",
  "feature",
  "requirements",
  "bug-analysis",
  "bugfix",
  "init",
  "refactor",
  "project-analysis",
  "improvement",
];
const quotaFreshnessMs = 300_000;
const minimumComparableSamples = 3;
const minimumQualityRate = 0.8;

function validateTaskMetadata(input: Request) {
  if (
    !workflowKinds.includes(input.kind) ||
    !["simple", "normal", "complex"].includes(input.complexity) ||
    !["low", "medium", "high"].includes(input.risk) ||
    typeof input.hasAcceptanceChecks !== "boolean" ||
    typeof input.needsPlanning !== "boolean" ||
    typeof input.taskSignature !== "string" ||
    input.taskSignature.length === 0 ||
    input.taskSignature.length > 200 ||
    !Number.isFinite(Date.parse(input.now))
  )
    throw new TypeError("Invalid workflow task metadata");
}

function validateExecutorAlternatives(input: Request) {
  if (
    input.executorModelIds !== undefined &&
    input.executorModelIds !== "eligible" &&
    (!Array.isArray(input.executorModelIds) ||
      input.executorModelIds.length > 20 ||
      !input.executorModelIds.every((id) => typeof id === "string"))
  )
    throw new TypeError("Invalid executor alternatives");
}

function validatePlanningRecipe(input: Request) {
  if (
    (input.planningMode !== undefined &&
      !["auto", "two-stage", "three-stage"].includes(input.planningMode)) ||
    [input.technicalPlannerId, input.reviewerId].some(
      (id) => id !== undefined && (typeof id !== "string" || id.length === 0),
    )
  )
    throw new TypeError("Invalid planning recipe");
}

function validateProviderCapacity(input: Request) {
  if (
    input.providerCapacity !== undefined &&
    (!Array.isArray(input.providerCapacity) ||
      input.providerCapacity.some(
        (item) =>
          !item ||
          typeof item.provider !== "string" ||
          !["available", "limit-reached", "unknown"].includes(item.state) ||
          item.source !== "provider_reported" ||
          !Number.isFinite(Date.parse(item.observedAt)),
      ))
  )
    throw new TypeError("Invalid provider capacity");
  if (input.requireKnownCapacity !== undefined && typeof input.requireKnownCapacity !== "boolean")
    throw new TypeError("Invalid capacity policy");
}

function validateRequest(policy: AgentRoutingPolicy, input: Request): ExecutionRole {
  validateTaskMetadata(input);
  validateExecutorAlternatives(input);
  validatePlanningRecipe(input);
  const executionRole = input.executionRole ?? "coding";
  if (!["coding", "review", "inventory"].includes(executionRole))
    throw new TypeError("Invalid execution role");
  if (!Number.isInteger(policy.maxWorkers) || policy.maxWorkers < 1 || policy.maxWorkers > 2)
    throw new TypeError("Invalid worker bound");
  validateProviderCapacity(input);
  return executionRole;
}

function checkProviderQuota(provider: string, input: Request) {
  const observedAge = (item: { observedAt: string }) =>
    Date.parse(input.now) - Date.parse(item.observedAt);
  const recent = (input.providerCapacity ?? []).filter(
    (item) =>
      item.provider === provider && observedAge(item) >= 0 && observedAge(item) < quotaFreshnessMs,
  );
  const latest = recent.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  return {
    provider,
    state: latest?.state ?? "unknown",
    source: latest?.source ?? "unavailable",
    observedAt: latest?.observedAt ?? null,
  };
}

export function eligibleWorkflowModels(policy: AgentRoutingPolicy, input: Request) {
  const quotaChecks = [...new Set(policy.models.map((model) => model.provider))].map((provider) =>
    checkProviderQuota(provider, input),
  );
  const hasCapacity = (model: AgentModel) =>
    quotaChecks.some(
      (check) =>
        check.provider === model.provider &&
        check.state !== "limit-reached" &&
        (!input.requireKnownCapacity || check.state === "available"),
    );
  const eligible = policy.models.filter(
    (model) =>
      input.allowedProviders.includes(model.provider) &&
      input.verifiedModelIds.includes(model.id) &&
      hasCapacity(model),
  );
  return { eligible, quotaChecks };
}

function sortExecutors(eligible: readonly AgentModel[], executionRole: ExecutionRole) {
  return eligible
    .filter((model) => model.roles.includes(executionRole))
    .sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || a.id.localeCompare(b.id));
}

function defaultRoleModels(
  policy: AgentRoutingPolicy,
  eligible: readonly AgentModel[],
  executors: readonly AgentModel[],
) {
  const hasRole = (model: AgentModel, role: AgentModel["roles"][number]) =>
    model.roles.includes(role);
  const firstOrchestrator =
    eligible.find((model) => hasRole(model, "orchestrator")) ?? executors[0];
  return {
    current: eligible.find((model) => model.id === policy.orchestratorId) ?? firstOrchestrator,
    currentWhenExplicitIneligible: firstOrchestrator,
    planner:
      eligible.find((model) => hasRole(model, "orchestrator") && model.tier !== "light") ??
      eligible.find((model) => hasRole(model, "review") && model.tier !== "light"),
    advanced: eligible.find(
      (model) =>
        model.tier === "high" && (hasRole(model, "review") || hasRole(model, "orchestrator")),
    ),
  };
}

function pickRole(
  explicitId: string | undefined,
  pool: readonly AgentModel[],
  fallback: AgentModel | undefined,
  fallbackIneligible: boolean | undefined,
) {
  if (explicitId === undefined) return fallback?.id ?? "unavailable";
  if (!fallbackIneligible) return explicitId;
  return pool.find((model) => model.id === explicitId)?.id ?? fallback?.id ?? "unavailable";
}

function resolveRoles(
  policy: AgentRoutingPolicy,
  input: Request,
  eligible: readonly AgentModel[],
  executionRole: ExecutionRole,
): WorkflowRoles {
  const executors = sortExecutors(eligible, executionRole);
  const defaults = defaultRoleModels(policy, eligible, executors);
  const executorModelIds =
    input.executorModelIds === "eligible"
      ? executors.map((model) => model.id)
      : (input.executorModelIds ?? []);
  if (executorModelIds.length > 20) throw new TypeError("Invalid executor alternatives");
  const fallback = input.fallbackIneligibleRoles;
  const currentFallback =
    input.currentModelId === undefined ? defaults.current : defaults.currentWhenExplicitIneligible;
  return {
    currentModelId: pickRole(input.currentModelId, eligible, currentFallback, fallback),
    preferredExecutorId: pickRole(input.preferredExecutorId, executors, executors[0], fallback),
    plannerId: pickRole(input.plannerId, eligible, defaults.planner, fallback),
    advancedPlannerId: pickRole(input.advancedPlannerId, eligible, defaults.advanced, fallback),
    executorModelIds,
    ...(input.technicalPlannerId ? { technicalPlannerId: input.technicalPlannerId } : {}),
    ...(input.reviewerId ? { reviewerId: input.reviewerId } : {}),
  };
}

function isWellFormedCase(row: WorkflowCase) {
  return (
    !!row &&
    typeof row.caseId === "string" &&
    typeof row.accepted === "boolean" &&
    row.modelConfirmed === true &&
    row.completeAccounting === true &&
    typeof row.pricesExpireAt === "string" &&
    typeof row.executorId === "string" &&
    (row.plannerId === null || typeof row.plannerId === "string")
  );
}

function isComparableCase(row: WorkflowCase, input: ResolvedRequest, executionRole: ExecutionRole) {
  return (
    (row.executionRole ?? "coding") === executionRole &&
    row.taskKind === input.kind &&
    row.taskSignature === input.taskSignature &&
    row.complexity === input.complexity &&
    row.risk === input.risk &&
    row.modelConfirmed &&
    row.completeAccounting &&
    Number.isFinite(row.usdMax) &&
    row.usdMax >= 0 &&
    Date.parse(row.pricesExpireAt) >= Date.parse(input.now)
  );
}

function matchHistory(input: ResolvedRequest, executionRole: ExecutionRole) {
  const seen = new Set<string>();
  return input.history.filter((row) => {
    if (!isWellFormedCase(row)) return false;
    if (seen.has(row.caseId)) return false;
    seen.add(row.caseId);
    return isComparableCase(row, input, executionRole);
  });
}

function isProvenDirect(id: string, input: ResolvedRequest, cases: readonly WorkflowCase[]) {
  const matched = cases.filter(
    (row) =>
      row.plannerId === null &&
      row.executorId === id &&
      (row.technicalPlannerId ?? null) === null &&
      (row.reviewerId ?? null) === (input.reviewerId ?? null),
  );
  return (
    matched.length >= minimumComparableSamples &&
    matched.filter((row) => row.accepted).length / matched.length >= minimumQualityRate
  );
}

function hasPlanningRole(model: AgentModel) {
  return model.roles.includes("orchestrator") || model.roles.includes("review");
}

function createRoleRules(
  policy: AgentRoutingPolicy,
  input: ResolvedRequest,
  cases: readonly WorkflowCase[],
  executionRole: ExecutionRole,
) {
  const requiresAdvanced = input.complexity === "complex" || input.risk === "high";
  const requiredRank = requiresAdvanced ? 2 : input.complexity === "normal" ? 1 : 0;
  const proven = (id: string) => isProvenDirect(id, input, cases);
  const lightCodingAllowed = policy.allowLightCoding && input.hasAcceptanceChecks;
  return {
    requiresAdvanced,
    canPlan: (model: Model) =>
      !!model && tierRank[model.tier] >= (requiresAdvanced ? 2 : 1) && hasPlanningRole(model),
    canDirect: (model: AgentModel) =>
      model.roles.includes(executionRole) &&
      (tierRank[model.tier] >= requiredRank ||
        (input.risk !== "high" && input.hasAcceptanceChecks && proven(model.id))) &&
      (model.tier !== "light" ||
        ((executionRole !== "coding" || lightCodingAllowed) &&
          (input.risk === "low" || proven(model.id)))),
    canReview: (model: Model) =>
      !!model &&
      model.roles.includes("review") &&
      (model.tier !== "light" || (input.risk === "low" && input.hasAcceptanceChecks)),
    canRefine: (model: Model) => !!model && tierRank[model.tier] >= 1 && hasPlanningRole(model),
    canImplementBehindPlanner: (model: AgentModel) =>
      model.roles.includes(executionRole) &&
      (model.tier !== "light" || executionRole !== "coding" || lightCodingAllowed),
  };
}

function createCandidateList(
  input: ResolvedRequest,
  byId: (id: string) => Model,
  rules: ReturnType<typeof createRoleRules>,
) {
  const candidates: Candidate[] = [];
  const reviewerFor = (plannerId: string | null, technicalId: string | null) => {
    if (input.reviewerId) return byId(input.reviewerId);
    if (technicalId) return byId(technicalId);
    return plannerId ? byId(plannerId) : undefined;
  };
  const add = (plannerId: string | null, executorId: string, technicalId: string | null = null) => {
    const reviewer = reviewerFor(plannerId, technicalId);
    if ((plannerId || input.reviewerId) && !rules.canReview(reviewer)) return;
    const reviewerId = reviewer?.id ?? null;
    const exists = candidates.some(
      (row) =>
        row.plannerId === plannerId &&
        row.executorId === executorId &&
        row.technicalPlannerId === technicalId &&
        row.reviewerId === reviewerId,
    );
    if (!exists)
      candidates.push({
        plannerId,
        technicalPlannerId: technicalId,
        reviewerId,
        executorId,
        evidenceIds: [],
        evidenceTruncated: false,
        samples: 0,
        qualityRate: null,
        usdPerAccepted: null,
      });
  };
  return { candidates, add };
}

function buildCandidates(
  policy: AgentRoutingPolicy,
  input: ResolvedRequest,
  eligible: readonly AgentModel[],
  cases: readonly WorkflowCase[],
  executionRole: ExecutionRole,
) {
  const byId = (id: string) => eligible.find((model) => model.id === id);
  const rules = createRoleRules(policy, input, cases, executionRole);
  const preferred = byId(input.preferredExecutorId);
  const current = byId(input.currentModelId);
  const executors = [...new Set([input.preferredExecutorId, ...(input.executorModelIds ?? [])])]
    .map(byId)
    .filter((model): model is AgentModel => !!model);
  const selectedPlanner = byId(rules.requiresAdvanced ? input.advancedPlannerId : input.plannerId);
  const technicalPlanner = input.technicalPlannerId ? byId(input.technicalPlannerId) : undefined;
  const { candidates, add } = createCandidateList(input, byId, rules);
  if (!input.needsPlanning && input.planningMode !== "three-stage") {
    for (const executor of executors) if (rules.canDirect(executor)) add(null, executor.id);
    if (current && rules.canDirect(current)) add(null, current.id);
  }
  if (rules.canPlan(selectedPlanner))
    for (const executor of executors.filter(rules.canImplementBehindPlanner)) {
      if (input.planningMode !== "three-stage") add(selectedPlanner!.id, executor.id);
      if (
        input.planningMode !== "two-stage" &&
        (rules.requiresAdvanced || input.planningMode === "three-stage") &&
        rules.canRefine(technicalPlanner) &&
        technicalPlanner!.id !== selectedPlanner!.id
      )
        add(selectedPlanner!.id, executor.id, technicalPlanner!.id);
    }
  return { candidates, preferred, current };
}

function scoreCandidates(candidates: Candidate[], cases: readonly WorkflowCase[]) {
  for (const candidate of candidates) {
    const matched = cases.filter(
      (row) =>
        row.plannerId === candidate.plannerId &&
        row.executorId === candidate.executorId &&
        (row.technicalPlannerId ?? null) === candidate.technicalPlannerId &&
        (row.reviewerId === undefined
          ? (row.technicalPlannerId ?? row.plannerId)
          : row.reviewerId) === candidate.reviewerId,
    );
    const successes = matched.filter((row) => row.accepted).length;
    candidate.evidenceIds = matched.slice(0, 5).map((row) => row.caseId);
    candidate.evidenceTruncated = matched.length > 5;
    candidate.samples = matched.length;
    candidate.qualityRate = matched.length ? successes / matched.length : null;
    candidate.usdPerAccepted = successes
      ? matched.reduce((sum, row) => sum + row.usdMax, 0) / successes
      : null;
  }
}

function rankCandidates(
  policy: AgentRoutingPolicy,
  input: ResolvedRequest,
  candidates: Candidate[],
) {
  const usable = candidates.filter(
    (row) => row.samples < minimumComparableSamples || row.qualityRate! >= minimumQualityRate,
  );
  const isDelegated = (row: Candidate) =>
    Number(row.plannerId !== null || row.executorId !== input.currentModelId);
  const ranked = usable
    .filter((row) => row.samples >= minimumComparableSamples && row.usdPerAccepted !== null)
    .sort((a, b) => a.usdPerAccepted! - b.usdPerAccepted! || isDelegated(a) - isDelegated(b));
  const comparable =
    (policy.objective ?? "reference-cost") === "reference-cost" &&
    usable.length > 1 &&
    ranked.length === usable.length;
  return { usable, ranked, comparable };
}

function selectRuleBased(
  input: ResolvedRequest,
  context: ReturnType<typeof buildCandidates>,
  usable: readonly Candidate[],
) {
  if (input.needsPlanning || input.risk === "high")
    return usable.find((row) => row.plannerId !== null);
  const { preferred, current } = context;
  const sameConfiguredModel =
    preferred &&
    current &&
    preferred.provider === current.provider &&
    preferred.model === current.model &&
    preferred.effort === current.effort;
  return (
    (sameConfiguredModel
      ? usable.find((row) => row.plannerId === null && row.executorId === input.currentModelId)
      : undefined) ??
    usable.find((row) => row.plannerId === null && row.executorId === input.preferredExecutorId) ??
    usable.find((row) => row.plannerId === null) ??
    usable[0]
  );
}

function selectCandidate(
  input: ResolvedRequest,
  context: ReturnType<typeof buildCandidates>,
  ranking: ReturnType<typeof rankCandidates>,
) {
  return ranking.comparable ? ranking.ranked[0] : selectRuleBased(input, context, ranking.usable);
}

function describeMode(selected: Candidate | undefined, currentModelId: string) {
  if (!selected) return "blocked";
  if (selected.technicalPlannerId) return "architecture-technical-implement-review";
  if (selected.plannerId) return "plan-implement-review";
  return selected.executorId === currentModelId ? "direct-current" : "direct-worker";
}

function planPhases(selected: Candidate | undefined, executionRole: ExecutionRole) {
  if (!selected) return [];
  const implement = {
    phase: executionRole === "coding" ? "implement" : executionRole,
    modelId: selected.executorId,
    writeFiles: executionRole === "coding",
  };
  if (!selected.plannerId)
    return [
      implement,
      ...(selected.reviewerId
        ? [{ phase: "review", modelId: selected.reviewerId, writeFiles: false }]
        : []),
    ];
  return [
    { phase: "plan", modelId: selected.plannerId, writeFiles: false },
    ...(selected.technicalPlannerId
      ? [{ phase: "technical-plan", modelId: selected.technicalPlannerId, writeFiles: false }]
      : []),
    implement,
    { phase: "review", modelId: selected.reviewerId!, writeFiles: false },
  ];
}

function describeReason(selected: Candidate | undefined, comparable: boolean) {
  if (!selected)
    return "No verified, policy-allowed workflow satisfies planning, implementation and acceptance requirements";
  return comparable
    ? "Ranked full workflow cost per accepted result, including failed attempts; forecast only"
    : "Configured complexity and risk rules; insufficient matched evidence to claim optimal cost";
}

export function routeWorkflow(policy: AgentRoutingPolicy, input: Request) {
  const executionRole = validateRequest(policy, input);
  const { eligible, quotaChecks } = eligibleWorkflowModels(policy, input);
  const roles = resolveRoles(policy, input, eligible, executionRole);
  const resolved: ResolvedRequest = {
    ...input,
    ...roles,
    history: typeof input.history === "function" ? input.history(roles) : input.history,
  };
  const cases = matchHistory(resolved, executionRole);
  const context = buildCandidates(policy, resolved, eligible, cases, executionRole);
  const { candidates } = context;
  scoreCandidates(candidates, cases);
  const ranking = rankCandidates(policy, resolved, candidates);
  const { comparable } = ranking;
  const selected = selectCandidate(resolved, context, ranking);
  const delegated =
    !!selected && (!!selected.plannerId || selected.executorId !== resolved.currentModelId);
  return {
    status: !selected ? "blocked" : comparable ? "historical-forecast" : "rule-based",
    mode: describeMode(selected, resolved.currentModelId),
    plannerId: selected?.plannerId ?? null,
    executorId: selected?.executorId ?? null,
    technicalPlannerId: selected?.technicalPlannerId ?? null,
    reviewerId: selected?.reviewerId ?? null,
    workerCount: delegated ? 1 : 0,
    phases: planPhases(selected, executionRole),
    decisionInferenceTokens: 0,
    dispatchPerformed: false,
    objective: policy.objective ?? "reference-cost",
    estimatedReferenceUsdPerAccepted: comparable ? (selected?.usdPerAccepted ?? null) : null,
    actualSubscriptionCharge: null,
    candidates,
    quotaChecks,
    reason: describeReason(selected, comparable),
    requiredHandoff: [
      "goal",
      "acceptanceCriteria",
      "allowedPaths",
      "dependencies",
      "checkCommands",
      "openQuestions",
    ],
    maxImplementationRetries: 1,
  };
}
