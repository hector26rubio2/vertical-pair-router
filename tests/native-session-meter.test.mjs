import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSessionMeter } from '../tools/lib/native-session-meter.mjs';
import { officialCostBreakdown } from '../tools/lib/official-cost-breakdown.mjs';
const usage = { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 };
test('counts whole-tree result by model rather than omitting children or adding cumulative totals twice', () => {
  const meter = new NativeSessionMeter();
  const event = { type: 'assistant', message: { id: 'same', model: 'sonnet', usage, content: [{ type: 'tool_use', id: 'delegate', name: 'Agent', input: { subagent_type: 'worker', prompt: 'PRIVATE MUST NOT PERSIST' } }] } };
  meter.observe(event, 10); meter.observe(event, 11);
  meter.observe({ type: 'assistant', parent_tool_use_id: 'delegate', message: { id: 'child', model: 'haiku', usage, content: [] } }, 20);
  meter.observe({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'delegate', content: 'PRIVATE CODE' }] } }, 40);
  const final = { type: 'result', subtype: 'success', usage, modelUsage: Object.fromEntries(['sonnet', 'haiku'].map(model => [model, { inputTokens: 2, outputTokens: 3, cacheReadInputTokens: 10, cacheCreationInputTokens: 20 }])) };
  meter.observe(final, 50); meter.observe(final, 51);
  const result = meter.snapshot(60);
  assert.equal(result.totals.totalTokens, 70);
  assert.equal(result.requests.length, 2);
  assert.equal(result.tools.length, 1);
  assert.equal(result.timings.childForegroundSpanMs, 30);
  assert.equal(result.completeAccounting, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('missing final receipt keeps observed counters as a lower bound, not a complete or zero-cost run', () => {
  const meter = new NativeSessionMeter();
  meter.observe({ type: 'assistant', message: { id: 'a', model: 'sonnet', usage, content: [] } }, 10);
  assert.equal(meter.snapshot(30).accounting, 'observed-lower-bound');
  assert.equal(meter.snapshot(30).totals.totalTokens, 35);
});
test('synthetic startup messages do not become verified zero-token model executions', () => {
  const meter = new NativeSessionMeter();
  meter.observe({ type: 'assistant', message: { id: 'error', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [] } }, 1);
  meter.observe({ type: 'result', subtype: 'success', is_error: true, usage: { input_tokens: 0, output_tokens: 0 } }, 2);
  assert.equal(meter.snapshot(3).completeAccounting, false);
  assert.equal(meter.snapshot(3).models.length, 0);
});
test('cost breakdown uses per-request tiers and exact cache TTL when receipts cover all counters', () => {
  const catalog = { checkedAt: '2026-11-12', expiresAt: '2026-12-12', cards: [{ model: 'haiku', source: 'official', tiers: [
    { maxPromptTokens: 100000, input: .1, output: .5, cacheRead: .01, cacheWrite5m: .125, cacheWrite1h: .2 },
    { maxPromptTokens: null, input: .5, output: 2.5, cacheRead: .05, cacheWrite5m: .625, cacheWrite1h: 1 }
  ] }] };
  const request = { model: 'haiku', inputTokens: 60000, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
  const row = { ...request, inputTokens: 120000, outputTokens: 2 };
  const precise = officialCostBreakdown(row, [request, request], catalog, '2026-11-12');
  assert.equal(precise.totalUsd.min, .012001);
  assert.equal(precise.totalUsd.min, precise.totalUsd.max);
  const unknown = officialCostBreakdown(row, [], catalog, '2026-11-12');
  assert.equal(unknown.unknownContextTier, true);
  assert.ok(unknown.totalUsd.max > unknown.totalUsd.min);
});
test('partial cache TTL receipts narrow cost bounds without treating missing writes as free', () => {
  const catalog = { checkedAt: '2026-11-12', expiresAt: '2026-12-12', cards: [{ model: 'sonnet', source: 'official', tiers: [
    { maxPromptTokens: null, input: 2, output: 10, cacheRead: .1, cacheWrite5m: 2.5, cacheWrite1h: 4 }
  ] }] };
  const row = { model: 'sonnet', inputTokens: 2, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 1000 };
  const partial = { ...row, outputTokens: 1, cacheWriteTokens: 800, cacheWrite5mTokens: 800, cacheWrite1hTokens: 0 };
  const result = officialCostBreakdown(row, [partial], catalog, '2026-11-12');
  assert.equal(result.cacheWriteUsd.min, .0025);
  assert.equal(result.cacheWriteUsd.max, .0028);
  assert.equal(result.unknownCacheTtl, true);
  assert.equal(officialCostBreakdown(row, [], catalog, 'not-a-date'), null);
});
