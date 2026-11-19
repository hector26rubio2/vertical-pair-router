import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateLegacyReport, inferOperation} from '@vpr/experiments';
import {validateEvidence} from '@vpr/contracts';

test('legacy migration preserves unknown context, cache TTL and manual complexity as null', () => {
  const input = {tasks: [{id: 'F02', kind: 'bugfix', level: 'medio-alto'}], rows: [{taskId: 'F02',
    arm: 'sonnet-codex', protocol: 'staged-v1', acceptanceHash: 'a'.repeat(64),
    models: [{provider: 'codex', model: 'terra', cacheWriteTokens: 0}],
    receipt: {totals: {inputTokens: 10, outputTokens: 2, cacheReadTokens: 30, cacheWriteTokens: 0}},
    totalCost: {min: .1, max: .2}, completeModelAccounting: true, status: 'accepted'}]};
  const before = JSON.stringify(input);
  const rows = migrateLegacyReport(input, {path: 'frozen.json', sha256: 'b'.repeat(64)});
  assert.equal(JSON.stringify(input), before);
  assert.equal(rows.length, 1); assert.equal(validateEvidence(rows[0]).valid, true);
  assert.equal(rows[0].tokens.cacheWrite, null);
  assert.equal(rows[0].tokens.contextMax, null);
  assert.equal(rows[0].features.designComplexity, null);
  assert.equal(rows[0].engineeringQuality, null);
  assert.equal(rows[0].cost.totalMinUsd, .1);
  assert.match(rows[0].unavailable['tokens.cacheWrite'], /Codex/);
});
test('actual calls remain distinct and operations are unknown when multiple tool operations compete', () => {
  assert.equal(inferOperation({tools: ['Read']}), 'leer_archivo');
  assert.equal(inferOperation({tools: ['Read', 'Grep']}), 'desconocida');
  assert.equal(inferOperation({phase: 'review'}), 'revisar');
  const rows = migrateLegacyReport({tasks: [], rows: [{taskId: 'A', arm: 'solo', receipt: {requests: [
    {id: 'm1', model: 'sonnet', phase: 'plan', inputTokens: 1, outputTokens: 2,
      cacheReadTokens: 3, cacheWriteTokens: 4, cacheWrite5mTokens: 4, cacheWrite1hTokens: 0}]} }]},
    {path: 'frozen.json', sha256: 'b'.repeat(64)});
  assert.equal(rows.length, 2); const call = rows[1];
  assert.equal(call.operation, 'disenar'); assert.equal(call.tokens.contextMax, 8);
  assert.equal(call.cost.totalMaxUsd, null);
  assert.equal(call.accepted, null); // Do not invent acceptance for an individual call.
  assert.equal(validateEvidence(call).valid, true);
});
