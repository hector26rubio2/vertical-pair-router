import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAgentModel, type AgentRoutingPolicy, type AgentRouteInput } from './agent-routing.js';
const policy: AgentRoutingPolicy = { orchestratorId: 'coordinator', maxWorkers: 2, allowLightCoding: true, models: [
  { id: 'small', provider: 'claude', model: 'haiku', tier: 'light', roles: ['inventory', 'coding'] },
  { id: 'coordinator', provider: 'claude', model: 'sonnet', tier: 'standard', roles: ['orchestrator', 'coding', 'review'] },
  { id: 'strong', provider: 'codex', model: 'configured-by-user', tier: 'high', roles: ['coding', 'review'] }
] };
const request: AgentRouteInput = { role: 'coding', complexity: 'simple', risk: 'low', hasAcceptanceChecks: true, allowedProviders: ['claude', 'codex'], verifiedModelIds: ['small', 'coordinator', 'strong'] };
test('routes simple checked code to light model only with opt-in', () => {
  assert.equal(selectAgentModel(policy, request).selected?.id, 'small');
  assert.equal(selectAgentModel({ ...policy, allowLightCoding: false }, request).selected?.id, 'coordinator');
  assert.equal(selectAgentModel(policy, { ...request, hasAcceptanceChecks: false }).selected?.id, 'coordinator');
});
test('high risk escalates and never silently crosses disallowed providers', () => {
  assert.equal(selectAgentModel(policy, { ...request, risk: 'high' }).selected?.id, 'strong');
  assert.equal(selectAgentModel(policy, { ...request, risk: 'high', allowedProviders: ['claude'] }).selected, null);
});
test('unverified model is ineligible and configured coordinator is authoritative', () => {
  assert.equal(selectAgentModel(policy, { ...request, verifiedModelIds: [] }).selected, null);
  assert.equal(selectAgentModel(policy, { ...request, role: 'orchestrator' }).selected?.id, 'coordinator');
  assert.throws(() => selectAgentModel({ ...policy, maxWorkers: 3 }, request), /parallelism/);
});
