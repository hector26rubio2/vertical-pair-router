import {createHash} from 'node:crypto';
import {
  validateRoutingPolicy, validateEvidence, isComparableEvidence,
  type EvidenceRecord, type EvidenceCohort, type RoutingPolicy, type EvidenceOperation,
} from '@vpr/contracts';
import {routeWorkflow, eligibleWorkflowModels, type AgentRoutingPolicy, type WorkflowRoutingRequest} from './workflow-routing.js';

export interface RouteWorkRequest extends EvidenceCohort {
  readonly policy: RoutingPolicy;
  readonly agentPolicy: AgentRoutingPolicy;
  readonly task: WorkflowRoutingRequest;
  readonly evidence: readonly EvidenceRecord[];
  readonly recipeModels?: Readonly<Record<string, readonly string[]>>;
  readonly operation?: EvidenceOperation;
  readonly activeModel?: string;
  readonly contextTokens?: number;
  readonly localOnly?: boolean;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function routingPolicyHash(policy: RoutingPolicy): string {
  return createHash('sha256').update(canonicalJson(policy)).digest('hex');
}
function validate(input: RouteWorkRequest): void {
  const policy = validateRoutingPolicy(input.policy);
  if (!policy.valid) throw new TypeError('Invalid routing policy: ' + policy.errors.join('; '));
  for (const row of input.evidence) {
    if (!validateEvidence(row).valid) throw new TypeError('Invalid routing evidence');
  }
  if (input.contextTokens !== undefined && (!Number.isSafeInteger(input.contextTokens) || input.contextTokens < 0)) {
    throw new TypeError('Invalid context measurement');
  }
}
function rankEvidence(input: RouteWorkRequest, eligibleIds: readonly string[]) {
  const groups = new Map<string, EvidenceRecord[]>();
  for (const row of input.evidence) {
    if (row.granularity !== 'run' || !isComparableEvidence(input, row)) continue;
    const rows = groups.get(row.recipe) ?? [];
    if (!rows.some(existing => existing.runId === row.runId)) rows.push(row);
    groups.set(row.recipe, rows);
  }
  return [...groups].map(([recipe, rows]) => {
    const successes = rows.filter(row => row.accepted === true && row.engineeringQuality === true);
    const complete = rows.every(row => row.cost.complete === true && row.cost.totalMaxUsd !== null);
    const modelIds = input.recipeModels?.[recipe] ?? [];
    const authorized = modelIds.length > 0 && modelIds.every(id => eligibleIds.includes(id));
    const qualified = rows.length >= Math.max(3, input.policy.evidence.minimumSamples)
      && successes.length / rows.length >= Math.max(.8, input.policy.evidence.minimumAcceptance)
      && complete && authorized && rows.every(row => row.modelIdentity === 'confirmed');
    return {recipe, n: rows.length, accepted: successes.length, acceptance: successes.length / rows.length,
      costPerAccepted: complete && successes.length
        ? rows.reduce((sum, row) => sum + row.cost.totalMaxUsd!, 0) / successes.length : null,
      qualified, modelsAuthorized: authorized, evidenceIds: rows.map(row => row.id)};
  }).sort((a, b) => Number(b.qualified) - Number(a.qualified)
    || (a.costPerAccepted ?? Infinity) - (b.costPerAccepted ?? Infinity) || a.recipe.localeCompare(b.recipe));
}
/** Experimental pure facade. It describes decisions; it cannot dispatch or enable enforce. */
export function routeWork(input: RouteWorkRequest) {
  validate(input);
  const trace = [{stage: 'validar', rule: 'schema-v1'}];
  const contextAction = input.activeModel?.toLowerCase().includes('haiku') && (input.contextTokens ?? 0) >= 90_000
    ? 'compact-required' : 'none';
  trace.push({stage: 'politica-protegida', rule: 'provider-authorization;haiku-90000;no-enforce'});
  trace.push({stage: 'capacidades-verificadas', rule: 'verified-model-id-and-provider'});
  const active = input.agentPolicy.models.find(model => model.id === (input.task.currentModelId ?? input.agentPolicy.orchestratorId));
  const providers = input.task.allowedProviders.filter(provider => !input.localOnly || provider === active?.provider);
  trace.push({stage: 'privacidad', rule: input.localOnly ? 'same-provider-only' : 'explicit-provider-allowlist'});
  const available = eligibleWorkflowModels(input.agentPolicy, {...input.task, allowedProviders: providers}).eligible;
  const inventory = input.operation !== undefined && ['explorar_grafo', 'buscar_codigo', 'leer_archivo'].includes(input.operation);
  const role = inventory ? 'inventory' : input.task.executionRole ?? 'coding';
  const pick = (tier: string | undefined, requiredRole: 'orchestrator' | 'inventory' | 'coding' | 'review') =>
    available.filter(model => model.tier === tier && model.roles.includes(requiredRole)).sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
  const planner = input.task.plannerId ?? pick(input.policy.phases.design, 'orchestrator');
  const advanced = input.task.advancedPlannerId ?? pick(input.policy.phases['advanced-design'] ?? 'high', 'orchestrator');
  const executor = inventory ? pick(input.policy.operations[input.operation!] ?? 'light', 'inventory')
    : input.task.preferredExecutorId ?? pick(input.policy.phases.implement, role);
  const reviewer = input.task.reviewerId ?? pick(input.policy.phases.review, 'review');
  const workflow = routeWorkflow({...input.agentPolicy, maxWorkers: Math.min(input.agentPolicy.maxWorkers, input.policy.limits.maxWorkers)},
    {...input.task, allowedProviders: providers, executionRole: role, ...inventory ? {needsPlanning: false} : {},
      ...planner ? {plannerId: planner} : {}, ...advanced ? {advancedPlannerId: advanced} : {},
      ...executor ? {preferredExecutorId: executor} : {}, ...reviewer ? {reviewerId: reviewer} : {}});
  trace.push({stage: 'calidad-riesgo', rule: 'workflow-guards-and-engineering-quality-before-cost'});
  const candidates = rankEvidence(input, available.map(model => model.id));
  trace.push({stage: 'evidencia', rule: 'same-protocol-acceptance-features;n>=3;acceptance>=80%'});
  const selected = workflow.status === 'blocked' || contextAction !== 'none' ? undefined
    : candidates.find(candidate => candidate.qualified);
  trace.push({stage: 'costo-latencia', rule: 'complete-cost-per-engineering-accepted;latency-ND-if-unmeasured'});
  return {
    mode: 'shadow' as const, dispatchPerformed: false as const, decisionInferenceTokens: 0 as const,
    policyVersion: input.policy.version, policyHash: routingPolicyHash(input.policy), trace,
    contextAction, workflow,
    operationTier: input.operation ? input.policy.operations[input.operation] ?? null : null,
    evidenceRecommendation: {status: selected ? 'candidate-for-repetition' : 'sin decisión',
      recipe: selected?.recipe ?? null, candidates, evidenceIds: selected?.evidenceIds ?? []},
  };
}
