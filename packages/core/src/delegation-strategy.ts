export interface StrategyForecast {
  readonly workTokens: number;
  readonly coordinationTokens: number;
  readonly repeatedContextTokens: number;
  readonly reviewTokens: number;
  readonly retryTokens: number;
  readonly comparableSamples: number;
  readonly durationMs?: number;
  readonly cost?: { readonly value: number; readonly unit: 'usd' | 'premium-requests' | 'account-quota'; readonly source: 'measured' | 'estimated' };
}
export interface DelegationStrategy {
  readonly id: string;
  readonly kind: 'single' | 'split' | 'mixed';
  readonly taskIds: readonly string[];
  readonly assignments: readonly { readonly taskId: string; readonly modelId: string }[];
  readonly checks: readonly string[];
  readonly forecast: StrategyForecast | null;
  readonly verifiedEligible: boolean;
}
export function chooseDelegationStrategy(strategies: readonly DelegationStrategy[], objective: {
  readonly optimizeFor: 'tokens' | 'cost' | 'latency';
  readonly costUnit?: 'usd' | 'premium-requests' | 'account-quota';
} = { optimizeFor: 'tokens' }): {
  readonly selectedId: string | null;
  readonly status: 'forecast' | 'experiment-required' | 'unavailable';
  readonly candidates: readonly { readonly id: string; readonly estimatedTokens: number | null; readonly objectiveValue: number | null; readonly objective: string; readonly reason: string }[];
} {
  const ids = new Set<string>();
  const candidates = strategies.map(strategy => {
    if (ids.has(strategy.id)) throw new Error('Duplicate strategy ID');
    ids.add(strategy.id);
    if (strategy.taskIds.length === 0 || new Set(strategy.taskIds).size !== strategy.taskIds.length ||
        strategy.assignments.length !== strategy.taskIds.length ||
        strategy.taskIds.some(taskId => strategy.assignments.filter(assignment => assignment.taskId === taskId).length !== 1)) throw new Error('Every subtask requires exactly one assignment');
    const valid = strategy.verifiedEligible && strategy.checks.length > 0;
    const forecast = strategy.forecast;
    if (forecast && [forecast.workTokens, forecast.coordinationTokens, forecast.repeatedContextTokens, forecast.reviewTokens, forecast.retryTokens, forecast.comparableSamples].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid strategy forecast');
    if (forecast?.durationMs !== undefined && (!Number.isFinite(forecast.durationMs) || forecast.durationMs < 0)) throw new Error('Invalid duration forecast');
    if (forecast?.cost && (!Number.isFinite(forecast.cost.value) || forecast.cost.value < 0)) throw new Error('Invalid cost forecast');
    const estimatedTokens = !valid || forecast === null || forecast.comparableSamples < 1 ? null :
      forecast.workTokens + forecast.coordinationTokens + forecast.repeatedContextTokens + forecast.reviewTokens + forecast.retryTokens;
    const objectiveValue = estimatedTokens === null ? null : objective.optimizeFor === 'tokens' ? estimatedTokens :
      objective.optimizeFor === 'latency' ? forecast?.durationMs ?? null :
      objective.costUnit !== undefined && forecast?.cost?.unit === objective.costUnit ? forecast.cost.value : null;
    return { id: strategy.id, estimatedTokens, objectiveValue, objective: objective.optimizeFor === 'cost' ? `cost:${objective.costUnit ?? 'unspecified'}` : objective.optimizeFor,
      reason: !valid ? 'Model/capability or acceptance checks unverified' : objectiveValue === null ? 'Comparable evidence or objective units unavailable: experiment required' : 'Historical forecast including coordination, repeated context, review and retries; not measured savings' };
  });
  const ranked = candidates.filter(candidate => candidate.objectiveValue !== null)
    .sort((a, b) => a.objectiveValue! - b.objectiveValue! || a.id.localeCompare(b.id));
  const selectedId = ranked[0]?.id ?? null;
  return { selectedId, status: selectedId ? 'forecast' : strategies.some(strategy => strategy.verifiedEligible && strategy.checks.length > 0) ? 'experiment-required' : 'unavailable', candidates };
}
