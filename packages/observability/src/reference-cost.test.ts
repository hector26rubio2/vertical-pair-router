import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateApiReferenceCost, type ModelPriceCatalog } from './reference-cost.js';
const catalog: ModelPriceCatalog = { checkedAt: '2026-11-12', expiresAt: '2026-12-12', cards: [
  { model: 'haiku', source: 'https://platform.claude.com/docs/en/models/haiku-5-5/overview', tiers: [{ maxPromptTokens: 100000, input: .1, output: .5, cacheRead: .01, cacheWrite5m: .125, cacheWrite1h: .2 }, { maxPromptTokens: null, input: .5, output: 2.5, cacheRead: .05, cacheWrite5m: .625, cacheWrite1h: 1 }] },
  { model: 'sonnet', source: 'https://platform.claude.com/docs/en/models/sonnet-5-5/overview', tiers: [{ maxPromptTokens: null, input: 2, output: 10, cacheRead: .1, cacheWrite5m: 2.5, cacheWrite1h: 4 }] }
] };
const input = { observedModel: 'haiku', modelConfirmed: true, inputTokens: 2, outputTokens: 6248, cacheReadTokens: 0, cacheWriteTokens: 908, now: '2026-11-12' };
test('more Haiku tokens can cost less than fewer Sonnet tokens for accepted work', () => {
  const haiku = estimateApiReferenceCost(input, catalog)!;
  const sonnet = estimateApiReferenceCost({ ...input, observedModel: 'sonnet', outputTokens: 1285, cacheWriteTokens: 887 }, catalog)!;
  assert.ok(haiku.usdMax < sonnet.usdMin);
  assert.ok(Math.abs(haiku.usdMin - .0032377) < 1e-10);
  assert.ok(Math.abs(sonnet.usdMin - .0150715) < 1e-10);
  assert.equal(haiku.actualSubscriptionCharge, null);
});
test('prices cache separately, preserves unknown TTL and applies context tiers', () => {
  const unknown = estimateApiReferenceCost(input, catalog)!;
  assert.ok(unknown.usdMax > unknown.usdMin);
  assert.equal(estimateApiReferenceCost({ ...input, cacheWriteTtl: '5m' }, catalog)?.usdMin, unknown.usdMin);
  assert.equal(estimateApiReferenceCost({ ...input, inputTokens: 100001 }, catalog)?.ratesPerMillion.input, .5);
});
test('unknown, substituted and stale model prices remain unavailable', () => {
  assert.equal(estimateApiReferenceCost({ ...input, observedModel: 'unknown' }, catalog), null);
  assert.equal(estimateApiReferenceCost({ ...input, modelConfirmed: false }, catalog), null);
  assert.equal(estimateApiReferenceCost({ ...input, now: '2027-01-01' }, catalog), null);
});
