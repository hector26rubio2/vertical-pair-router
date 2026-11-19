import test from 'node:test';
import assert from 'node:assert/strict';
import {routeWork} from '@vpr/core';
import {readFileSync} from 'node:fs';
import {fixture} from './fixtures/evidence.mjs';
import {loadRoutingPolicy} from '@vpr/config';

const original = JSON.parse(readFileSync(new URL('./fixtures/routing-characterization.json', import.meta.url), 'utf8')).find(f => f.fn === 'routeWorkflow');
const routingPolicy = {schemaVersion: 1, version: 'shadow-1', mode: 'shadow',
  evidence: {minimumSamples: 3, minimumAcceptance: .8},
  phases: {design: 'standard', implement: 'light', review: 'standard'},
  operations: {leer_archivo: 'light'}, escalationRules: ['security'],
  limits: {maxWorkers: 2, retriesPerModel: 1}};
const features = {kind: 'bugfix', role: 'coding', designComplexity: 'complex', executionComplexity: 'simple',
  risk: 'medium', files: ['src/a.ts'], modules: ['src'], publicApi: false, persistence: true,
  transactions: true, security: false, money: true, invariants: 1, existingTests: 2,
  expectedDiffLines: 30, dependencies: []};
function request() {return {policy: routingPolicy, agentPolicy: original.args[0], task: original.args[1],
  protocol: 'factorial-v1', acceptanceContractHash: 'a'.repeat(64), features, evidence: []};}
test('routeWork is deterministic, versioned, stage-explained, and never dispatches', () => {
  const input = request(), before = JSON.stringify(input);
  const result = routeWork(input);
  assert.deepEqual(result, routeWork(input)); assert.equal(JSON.stringify(input), before);
  assert.equal(result.mode, 'shadow'); assert.equal(result.dispatchPerformed, false);
  assert.equal(result.decisionInferenceTokens, 0); assert.equal(result.policyVersion, 'shadow-1');
  assert.match(result.policyHash, /^[a-f0-9]{64}$/); assert.equal(result.trace.length, 7);
  assert.equal(result.evidenceRecommendation.status, 'sin decisión');
});
test('guardrails cannot be replaced by declarative policy, even in shadow mode', () => {
  assert.throws(() => routeWork({...request(), policy: {...routingPolicy, mode: 'enforce'}}), /Invalid routing policy/);
  assert.throws(() => routeWork({...request(), policy: {...routingPolicy, protected: {haikuLimit: 200000}}}), /Invalid routing policy/);
  const result = routeWork({...request(), activeModel: 'claude-haiku-5-5', contextTokens: 90000});
  assert.equal(result.contextAction, 'compact-required'); assert.equal(result.dispatchPerformed, false);
});
test('three independent runs, verified recipe models and engineering acceptance gate the shadow recommendation', () => {
  const base = request();
  const modelId = base.agentPolicy.models.find(model => base.task.verifiedModelIds.includes(model.id))?.id;
  const recipeModels = {'sonnet-haiku': [modelId]};
  const evidence = [1, 2, 3].map(n => ({...fixture('run-' + n), granularity: 'run', runId: 'run-' + n, callId: null}));
  assert.equal(routeWork({...base, recipeModels, evidence: evidence.slice(0, 2)}).evidenceRecommendation.recipe, null);
  assert.equal(routeWork({...base, recipeModels, evidence}).evidenceRecommendation.recipe, 'sonnet-haiku');
  assert.equal(routeWork({...base, evidence}).evidenceRecommendation.recipe, null);
  const repeated = evidence.map(row => ({...row, runId: 'same-run'}));
  assert.equal(routeWork({...base, recipeModels, evidence: repeated}).evidenceRecommendation.recipe, null);
  const failed = evidence.map((row, i) => i === 0 ? {...row, engineeringQuality: false} : row);
  assert.equal(routeWork({...base, recipeModels, evidence: failed}).evidenceRecommendation.recipe, null);
  const old = evidence.map(row => ({...row, protocol: 'different'}));
  assert.equal(routeWork({...base, recipeModels, evidence: old}).evidenceRecommendation.recipe, null);
});
test('repository YAML loads through the public parser and stays in shadow mode', async () => {
  const policy = await loadRoutingPolicy(new URL('../.vpr/routing-policy.yaml', import.meta.url));
  assert.equal(policy.mode, 'shadow'); assert.equal(policy.evidence.minimumSamples, 3);
});

