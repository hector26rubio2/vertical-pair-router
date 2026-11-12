import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgentUsage, compareAgentTokens } from './agent-usage.js';

test('normalizes Codex observed counters without retaining content', () => {
  const parsed = parseAgentUsage('codex', { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 7 }, text: 'private' });
  assert.equal(parsed?.inputTokens, 100);
  assert.equal(parsed?.cachedInputTokens, 80);
  assert.equal(parsed?.outputTokens, 7);
  assert.equal(parsed?.scope, 'turn');
  assert.ok(!JSON.stringify(parsed).includes('private'));
  assert.equal(parseAgentUsage('codex', { type: 'turn.completed', usage: {} }), null);
});

test('correlates Claude subagent messages and separates aggregate result scope', () => {
  const parsed = parseAgentUsage('claude', { type: 'assistant', parent_tool_use_id: 'child-call', message: { model: 'observed-model', usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 6 }, content: ['private'] } });
  assert.equal(parsed?.agentId, 'tool:child-call');
  assert.equal(parsed?.parentAgentId, 'main');
  assert.equal(parsed?.model, 'observed-model');
  assert.equal(parsed?.scope, 'message');
  assert.equal(parseAgentUsage('claude', { type: 'result', usage: { input_tokens: 120, output_tokens: 40 } })?.scope, 'session');
  assert.ok(!JSON.stringify(parsed).includes('private'));
});

test('compares equivalent successful work without double-counting Codex cache', () => {
  const usage = { ...parseAgentUsage('codex', { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } })!, model: 'observed-model' };
  const baseline = { storyId: 'story_test', commit: 'same-base', checksPassed: true, usage };
  const optimized = { ...baseline, usage: { ...usage, inputTokens: 50, cachedInputTokens: 40 } };
  assert.deepEqual(compareAgentTokens(baseline, optimized), { baselineTokens: 110, optimizedTokens: 60, savedTokens: 50, savedPercent: 50 / 110 * 100 });
  assert.throws(() => compareAgentTokens(baseline, { ...optimized, checksPassed: false }), /checks/);
  assert.throws(() => compareAgentTokens(baseline, { ...optimized, commit: 'different' }), /commit/);
  assert.throws(() => compareAgentTokens(baseline, { ...optimized, usage: { ...usage, model: null } }), /model/);
});
