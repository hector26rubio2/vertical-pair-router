import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeModelUsage } from './agent-usage.js';
test('exposes whole-tree counters including workers, independently of root-loop usage', () => {
  const result = parseClaudeModelUsage({ type: 'result', usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {
    'claude-sonnet-5-5': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 },
    'claude-haiku-5-5': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40 }
  } });
  assert.equal(result?.length, 2);
  assert.equal(result?.[1]?.outputTokens, 20);
  assert.equal(result?.[1]?.scope, 'model-tree');
  assert.equal(result?.[1]?.agentId, 'model:claude-haiku-5-5');
});
test('refuses incomplete tree counters so missing child usage cannot be mistaken for free work', () => {
  assert.equal(parseClaudeModelUsage({ type: 'result' }), null);
  assert.equal(parseClaudeModelUsage({ type: 'result', modelUsage: { 'claude-haiku-5-5': { inputTokens: 1, outputTokens: 2 } } }), null);
});
