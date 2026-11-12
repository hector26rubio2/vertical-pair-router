export interface AgentModel {
  readonly id: string;
  readonly provider: 'claude' | 'codex' | 'copilot';
  readonly model: string;
  readonly effort?: 'low' | 'medium' | 'high';
  readonly tier: 'light' | 'standard' | 'high';
  readonly roles: readonly ('orchestrator' | 'inventory' | 'coding' | 'review')[];
}
export interface AgentRoutingPolicy {
  readonly objective?: 'tokens' | 'reference-cost';
  readonly orchestratorId: string;
  readonly maxWorkers: number;
  readonly allowLightCoding: boolean;
  readonly models: readonly AgentModel[];
}
export interface AgentRouteInput {
  readonly role: 'orchestrator' | 'inventory' | 'coding' | 'review';
  readonly complexity: 'simple' | 'normal' | 'complex';
  readonly risk: 'low' | 'medium' | 'high';
  readonly hasAcceptanceChecks: boolean;
  readonly allowedProviders: readonly string[];
  readonly verifiedModelIds: readonly string[];
}
export function selectAgentModel(policy: AgentRoutingPolicy, input: AgentRouteInput): {
  readonly selected: AgentModel | null;
  readonly reason: string;
  readonly requiredTier: AgentModel['tier'];
} {
  if (!Number.isInteger(policy.maxWorkers) || policy.maxWorkers < 1 || policy.maxWorkers > 2) throw new TypeError('Worker parallelism must be between one and two');
  const lightEligible = input.role === 'inventory' || (input.role === 'coding' && policy.allowLightCoding && input.complexity === 'simple' && input.risk === 'low' && input.hasAcceptanceChecks);
  const requiredTier = input.risk === 'high' || input.complexity === 'complex' ? 'high' : lightEligible ? 'light' : 'standard';
  const rank = { light: 0, standard: 1, high: 2 };
  const candidates = policy.models.filter(model =>
    input.allowedProviders.includes(model.provider) && input.verifiedModelIds.includes(model.id) &&
    model.roles.includes(input.role) && rank[model.tier] >= rank[requiredTier] &&
    (input.role !== 'orchestrator' || model.id === policy.orchestratorId)
  ).sort((a, b) => rank[a.tier] - rank[b.tier] || a.id.localeCompare(b.id));
  const selected = candidates[0] ?? null;
  return { selected, requiredTier, reason: selected
    ? `Selected configured ${selected.tier} tier for ${input.role}; complexity=${input.complexity}; risk=${input.risk}; acceptanceChecks=${input.hasAcceptanceChecks}`
    : 'No policy-allowed, verified model meets the role and required tier; approval/configuration required' };
}
