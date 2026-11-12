import assert from 'node:assert/strict';
import test from 'node:test';
import { measureSubscriptionQuota, type SubscriptionSnapshot } from './subscription-usage.js';
const before: SubscriptionSnapshot = { bucketId: 'claude-session-local', planId: 'claude-pro', resetAt: '2026-11-12T18:00:00Z', observedAt: '2026-11-12T14:00:00Z', usedPercent: 20, source: 'provider_reported' };
const after: SubscriptionSnapshot = { ...before, observedAt: '2026-11-12T14:05:00Z', usedPercent: 23 };
test('measures subscription quota independently of API prices and tokens', () => {
  const result = measureSubscriptionQuota({ before, after, isolated: true });
  assert.equal(result.usedPercentagePoints, 3);
  assert.equal(result.inferenceTokens, 0);
  assert.equal(result.marginalChargeUsd, null);
});
test('rejects resets, concurrent usage, incompatible buckets and invisible rounded deltas', () => {
  for (const input of [
    { before, after, isolated: false },
    { before, after: { ...after, resetAt: '2026-11-13T18:00:00Z' }, isolated: true },
    { before, after: { ...after, bucketId: 'other' }, isolated: true },
    { before, after: { ...after, usedPercent: 20 }, isolated: true },
    { before, after: { ...after, usedPercent: 19 }, isolated: true },
    { before, after: { ...after, observedAt: '2026-11-12T18:00:00Z' }, isolated: true }
  ]) assert.equal(measureSubscriptionQuota(input).status, 'unavailable');
});
