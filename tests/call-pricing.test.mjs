import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {priceEvidenceCalls} from '@vpr/experiments';
import {fixture} from './fixtures/evidence.mjs';
const catalog = JSON.parse(readFileSync(new URL('../docs/research/model-price-catalog.json', import.meta.url)));
test('identical token counts retain each model official rate and exact TTL instead of identical prices', () => {
  const h = {...fixture('haiku'), model: 'claude-haiku-5-5'};
  const s = {...fixture('sonnet'), model: 'claude-sonnet-5-5'};
  const [haiku, sonnet] = priceEvidenceCalls([h, s], catalog, '2026-11-19');
  assert.ok(Math.abs(haiku.cost.totalMaxUsd - .00001575) < 1e-12);
  assert.ok(Math.abs(sonnet.cost.totalMaxUsd - .000305) < 1e-12);
  assert.ok(sonnet.cost.totalMaxUsd > haiku.cost.totalMaxUsd);
  assert.equal(h.cost.totalMaxUsd, .005); // Pure enrichment, raw receipt unmodified.
});
test('missing counters stay unknown and unknown TTL preserves a bounded reference cost', () => {
  const row = {...fixture(), model: 'claude-haiku-5-5'};
  const [range] = priceEvidenceCalls([{...row, tokens: {...row.tokens, cacheWrite5m: null, cacheWrite1h: null}}], catalog, '2026-11-19');
  assert.equal(range.cost.cacheWriteUsd, null); assert.ok(range.cost.totalMaxUsd > range.cost.totalMinUsd);
  const unknown = {...row, tokens: {...row.tokens, cacheWrite: null}};
  assert.deepEqual(priceEvidenceCalls([unknown], catalog, '2026-11-19')[0], unknown);
});
