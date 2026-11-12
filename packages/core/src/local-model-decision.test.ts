import assert from 'node:assert/strict';
import test from 'node:test';
import { decideLocalExecution, type RoutingCase } from './local-model-decision.js';
import type { AgentRoutingPolicy, AgentRouteInput } from './agent-routing.js';
const policy: AgentRoutingPolicy = { orchestratorId: 'coordinator', maxWorkers: 2, allowLightCoding: true, models: [
  { id: 'coordinator', provider: 'claude', model: 'sonnet', tier: 'standard', roles: ['orchestrator'] },
  { id: 'worker', provider: 'claude', model: 'haiku', tier: 'light', roles: ['coding'] }
] };
const task: AgentRouteInput = { role: 'coding', complexity: 'simple', risk: 'low', hasAcceptanceChecks: true, allowedProviders: ['claude'], verifiedModelIds: ['coordinator', 'worker'] };
function history(modelId: string, totalTokens: number, qualityPassed = true): RoutingCase[] {
  return [1, 2, 3].map(index => ({ caseId: modelId + index, taskKind: 'bugfix', complexity: 'simple', risk: 'low', modelId, modelConfirmed: true, completeAccounting: true, qualityPassed, totalTokens }));
}
test('keeps the current capable agent by default without spawning workers', () => {
  const result = decideLocalExecution(policy, { currentModelId: 'coordinator', taskKind: 'bugfix', task, history: [] });
  assert.equal(result.mode, 'direct');
  assert.equal(result.workerCount, 0);
  assert.equal(result.decisionInferenceTokens, 0);
  assert.equal(result.estimatedTokensPerSuccess, null);
});
test('local comparable evidence selects exactly one lighter worker when beneficial', () => {
  const result = decideLocalExecution(policy, { currentModelId: 'coordinator', taskKind: 'bugfix', task, history: [...history('coordinator', 1000), ...history('worker', 400)] });
  assert.equal(result.mode, 'delegate-one');
  assert.equal(result.workerCount, 1);
  assert.equal(result.selectedModelId, 'worker');
  assert.equal(result.estimatedTokensPerSuccess, 400);
});
test('ignores substituted models, unrelated complexity and failing cheap workers', () => {
  for (const rows of [history('worker', 1, false), history('worker', 1).map(row => ({ ...row, modelConfirmed: false })), history('worker', 1).map(row => ({ ...row, complexity: 'complex' as const }))]) {
    assert.equal(decideLocalExecution(policy, { currentModelId: 'coordinator', taskKind: 'bugfix', task, history: [...history('coordinator', 1000), ...rows] }).mode, 'direct');
  }
});
test('counts failed attempts and cannot delegate outside provider policy', () => {
  const rows = [...history('coordinator', 1000), ...history('worker', 400), { ...history('worker', 400)[0]!, caseId: 'failed', totalTokens: 5000, qualityPassed: false }];
  assert.equal(decideLocalExecution(policy, { currentModelId: 'coordinator', taskKind: 'bugfix', task, history: rows }).mode, 'direct');
  assert.equal(decideLocalExecution(policy, { currentModelId: 'coordinator', taskKind: 'bugfix', task: { ...task, allowedProviders: [] }, history: rows }).status, 'unavailable');
});

test('does not retain an active model with repeated quality failures', () => {
  const result = decideLocalExecution(policy, { currentModelId: 'coordinator', taskKind: 'bugfix', task, history: [...history('coordinator', 1, false), ...history('worker', 400)] });
  assert.equal(result.selectedModelId, 'worker');
  assert.equal(result.workerCount, 1);
  assert.equal(decideLocalExecution(policy, { currentModelId: 'coordinator', taskKind: 'bugfix', task, history: [...history('coordinator', 1, false), ...history('worker', 1, false)] }).status, 'unavailable');
});
