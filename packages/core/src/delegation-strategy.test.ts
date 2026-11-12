import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDelegationStrategy, type DelegationStrategy } from './delegation-strategy.js';
const single: DelegationStrategy = { id: 'single', kind: 'single', taskIds: ['task'], assignments: [{ taskId: 'task', modelId: 'standard' }], checks: ['acceptance'], verifiedEligible: true, forecast: { workTokens: 1000, coordinationTokens: 0, repeatedContextTokens: 0, reviewTokens: 100, retryTokens: 0, comparableSamples: 3 } };
const split: DelegationStrategy = { id: 'split', kind: 'split', taskIds: ['a', 'b', 'c'], assignments: ['a', 'b', 'c'].map(taskId => ({ taskId, modelId: 'light' })), checks: ['acceptance'], verifiedEligible: true, forecast: { workTokens: 500, coordinationTokens: 200, repeatedContextTokens: 600, reviewTokens: 100, retryTokens: 100, comparableSamples: 3 } };
test('does not prefer multiple light agents when total overhead exceeds a single worker', () => {
  const result = chooseDelegationStrategy([split, single]);
  assert.equal(result.selectedId, 'single');
  assert.equal(result.candidates[0]?.estimatedTokens, 1500);
  assert.equal(result.status, 'forecast');
});
test('selects split when its complete historical forecast improves total tokens', () => {
  assert.equal(chooseDelegationStrategy([single, { ...split, forecast: { ...split.forecast!, repeatedContextTokens: 0, retryTokens: 0 } }]).selectedId, 'split');
});
test('requests an experiment rather than inventing savings from unknown usage', () => {
  assert.equal(chooseDelegationStrategy([{ ...split, forecast: null }]).status, 'experiment-required');
  assert.equal(chooseDelegationStrategy([{ ...split, verifiedEligible: false }]).selectedId, null);
  assert.throws(() => chooseDelegationStrategy([{ ...split, assignments: [] }]), /assignment/);
});

test('cost and latency are independent of tokens and never mix quota units', () => {
  const one = { ...single, forecast: { ...single.forecast!, durationMs: 500, cost: { value: 2, unit: 'premium-requests' as const, source: 'estimated' as const } } };
  const many = { ...split, forecast: { ...split.forecast!, durationMs: 900, cost: { value: 1, unit: 'premium-requests' as const, source: 'estimated' as const } } };
  assert.equal(chooseDelegationStrategy([one, many], { optimizeFor: 'cost', costUnit: 'premium-requests' }).selectedId, 'split');
  assert.equal(chooseDelegationStrategy([one, many], { optimizeFor: 'latency' }).selectedId, 'single');
  assert.equal(chooseDelegationStrategy([one, many], { optimizeFor: 'cost', costUnit: 'usd' }).status, 'experiment-required');
  assert.equal(chooseDelegationStrategy([one, split], { optimizeFor: 'cost', costUnit: 'premium-requests' }).selectedId, 'single');
});
