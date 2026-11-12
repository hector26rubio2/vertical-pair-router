import { selectAgentModel, type AgentRouteInput, type AgentRoutingPolicy } from './agent-routing.js';

export interface RoutingCase {
  readonly caseId: string;
  readonly taskKind: string;
  readonly complexity: AgentRouteInput['complexity'];
  readonly risk: AgentRouteInput['risk'];
  readonly modelId: string;
  readonly modelConfirmed: boolean;
  readonly completeAccounting: boolean;
  readonly qualityPassed: boolean;
  /** Total includes context, coordination, review and retry attempts. */
  readonly totalTokens: number;
}
export interface LocalDecisionRequest {
  readonly currentModelId: string;
  readonly taskKind: string;
  readonly task: AgentRouteInput;
  readonly history: readonly RoutingCase[];
}

/** Case-based retrieval and deterministic rules. No model/embedding/API calls. */
export function decideLocalExecution(policy: AgentRoutingPolicy, request: LocalDecisionRequest) {
  const seen = new Set<string>();
  const eligible = policy.models.filter(model => {
    // An active coordinator may execute directly if it meets the required tier.
    const candidate = model.id === request.currentModelId && model.id === policy.orchestratorId
      ? { ...model, roles: [...model.roles, 'coding' as const] } : model;
    return selectAgentModel({ ...policy, models: [candidate] }, request.task).selected !== null;
  });
  const cases = request.history.filter(row => {
    if (seen.has(row.caseId)) return false;
    seen.add(row.caseId);
    return row.taskKind === request.taskKind && row.complexity === request.task.complexity && row.risk === request.task.risk &&
      row.modelConfirmed && row.completeAccounting && Number.isSafeInteger(row.totalTokens) && row.totalTokens >= 0;
  });
  const candidates = eligible.map(model => {
    const matched = cases.filter(row => row.modelId === model.id);
    const successes = matched.filter(row => row.qualityPassed).length;
    return { model, evidenceIds: matched.map(row => row.caseId), sampleSize: matched.length,
      qualityRate: matched.length ? successes / matched.length : null,
      estimatedTokensPerSuccess: successes ? matched.reduce((total, row) => total + row.totalTokens, 0) / successes : null };
  });
  // Compare only adequately sampled, quality-accepted histories, including failures.
  const ranked = candidates.filter(row => row.sampleSize >= 3 && row.qualityRate! >= 0.8 && row.estimatedTokensPerSuccess !== null)
    .sort((a, b) => a.estimatedTokensPerSuccess! - b.estimatedTokensPerSuccess! ||
      Number(b.model.id === request.currentModelId) - Number(a.model.id === request.currentModelId) || a.model.id.localeCompare(b.model.id));
  const qualityCandidates = candidates.filter(row => row.sampleSize < 3 || row.qualityRate! >= 0.8);
  const current = qualityCandidates.find(row => row.model.id === request.currentModelId);
  // Do not claim a proven saving against an active model with no comparable history.
  const historicalComparison = current !== undefined && ranked.some(row => row.model.id === current.model.id);
  const selected = historicalComparison ? ranked[0] : current ?? ranked[0] ?? qualityCandidates[0];
  return {
    status: selected ? historicalComparison ? 'historical-forecast' : 'rule-based' : 'unavailable',
    mode: !selected ? 'blocked' : selected.model.id === request.currentModelId ? 'direct' : 'delegate-one',
    workerCount: !selected || selected.model.id === request.currentModelId ? 0 : 1,
    selectedModelId: selected?.model.id ?? null,
    decisionInferenceTokens: 0,
    estimatedTokensPerSuccess: historicalComparison ? selected?.estimatedTokensPerSuccess ?? null : null,
    reason: !selected ? 'No allowed verified model meets the task requirements' : historicalComparison
      ? 'Local comparable cases rank total tokens per accepted result, including failed attempts; forecast, not guaranteed savings'
      : current ? 'Retain the capable active model: insufficient comparable history to justify an extra worker'
      : 'Select one eligible worker using configured complexity/risk rules; no evidence yet of savings',
    candidates
  };
}
