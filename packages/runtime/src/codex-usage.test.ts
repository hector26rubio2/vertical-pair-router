import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCodexTokenUsage} from './codex-usage.js';
test('Codex missing writes remain unknown while preserving provider-inclusive input and total tokens', () => {
  const r = normalizeCodexTokenUsage({input_tokens: 1000, cached_input_tokens: 400, output_tokens: 20});
  assert.equal(r.cacheWrite, null); assert.equal(r.input, null); assert.equal(r.inputIncludingCache, 1000);
  assert.equal(r.output, 20); assert.equal(r.total, 1020);
  const explicit = normalizeCodexTokenUsage({input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 100, output_tokens: 20});
  assert.equal(explicit.input, 500); assert.equal(explicit.cacheWrite, 100); assert.equal(explicit.total, 1020);
});
