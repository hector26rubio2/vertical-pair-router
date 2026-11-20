import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeCampaign} from '@vpr/experiments';
import {readFileSync} from 'node:fs';
const catalog = name => JSON.parse(readFileSync(new URL('../docs/research/' + name, import.meta.url)));
test('campaign is reproducible, estimates all reviews and repairs, and never represents estimates as measurements', () => {
  const options = {seed: 20261119, repetitions: 3, asOf: '2026-11-19', legacyTaskIds: ['T01', 'W01', 'P01'],
    claude: catalog('model-price-catalog.json'), openai: catalog('openai-model-price-catalog.json')};
  const a = proposeCampaign(options), b = proposeCampaign(options);
  assert.deepEqual(a, b); assert.equal(a.status, 'proposal-awaiting-approval');
  assert.equal(a.blocks.length, 4); assert.equal(a.blocks[0].cells.length, 36);
  assert.equal(a.blocks[0].sharedDesigns.length, 2);
  assert.ok(a.totalMaxUsd > a.totalBaseMaxUsd);
  assert.equal(a.measuredTokens, null); assert.equal(a.subscriptionQuotaSavings, null);
  assert.ok(a.blocks.every(block => block.cells.every(cell => cell.repetition >= 1 && cell.repetition <= 3)));
  assert.throws(() => proposeCampaign({...options, repetitions: 1}), /three/);
  assert.throws(() => proposeCampaign({...options, asOf: '2027-01-01'}), /expired/);
});
