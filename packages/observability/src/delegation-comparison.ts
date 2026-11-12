import type { AgentUsage } from './agent-usage.js';
export interface MeasuredExecution {
  readonly executionId: string;
  readonly role: 'coordinator' | 'worker' | 'reviewer' | 'retry';
  readonly usage: AgentUsage;
}
export interface ExperimentArm {
  readonly storyId: string;
  readonly baseCommit: string;
  readonly acceptanceHash: string;
  readonly checksHash: string;
  readonly checksPassed: boolean;
  readonly qualityAccepted: boolean;
  readonly completeCoverage: boolean;
  readonly executions: readonly MeasuredExecution[];
}
export function compareDelegationArms(baseline: ExperimentArm, optimized: ExperimentArm) {
  if (baseline.storyId !== optimized.storyId || baseline.baseCommit !== optimized.baseCommit ||
      baseline.acceptanceHash !== optimized.acceptanceHash || baseline.checksHash !== optimized.checksHash) throw new Error('Experiment requires identical Story, base commit, acceptance and checks');
  for (const arm of [baseline, optimized]) {
    if (!arm.checksPassed || !arm.qualityAccepted || !arm.completeCoverage || arm.executions.length === 0) throw new Error('Successful quality checks and complete execution coverage are required');
    const ids = arm.executions.map(execution => execution.executionId);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate execution would double-count usage');
    // One canonical aggregate per execution; no session/message/turn rollups mixed.
    if (arm.executions.some(execution => !['turn', 'session'].includes(execution.usage.scope))) throw new Error('Canonical execution aggregates required');
  }
  const summarize = (arm: ExperimentArm) => arm.executions.reduce((total, execution) => {
    const usage = execution.usage;
    const tokens = usage.inputTokens + usage.outputTokens + (usage.provider === 'claude' ? usage.cachedInputTokens + usage.cacheWriteInputTokens : 0);
    total.tokens += tokens;
    total.byRole[execution.role] += tokens;
    return total;
  }, { tokens: 0, byRole: { coordinator: 0, worker: 0, reviewer: 0, retry: 0 } });
  const before = summarize(baseline), after = summarize(optimized);
  const savedTokens = before.tokens - after.tokens;
  return { baseline: before, optimized: after, savedTokens, savedPercent: before.tokens === 0 ? null : savedTokens / before.tokens * 100,
    modelMixChanged: JSON.stringify(baseline.executions.map(row => [row.usage.provider, row.usage.model])) !== JSON.stringify(optimized.executions.map(row => [row.usage.provider, row.usage.model])),
    exploratory: true, source: 'provider_reported' as const, monetarySavings: null };
}
