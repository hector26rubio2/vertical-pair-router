import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeEvidence, renderEvidenceReport} from '@vpr/experiments';
import {fixture} from './fixtures/evidence.mjs';
const run = n => ({...fixture('r' + n), granularity: 'run', runId: 'run-' + n, callId: null});
test('decision table requires repetitions and quality, separates protocols and includes failed-attempt costs', () => {
  let result = analyzeEvidence([run(1), run(2)]);
  assert.equal(result.decisions[0].status, 'sin decisión');
  result = analyzeEvidence([run(1), run(2), run(3)]);
  assert.equal(result.decisions[0].recommendation, 'sonnet-haiku');
  assert.equal(result.cells[0].costPerAccepted, .005);
  const failed = {...run(4), accepted: false, engineeringQuality: false, failureReason: 'test_externo_fallido'};
  result = analyzeEvidence([run(1), run(2), run(3), failed]);
  assert.equal(result.decisions[0].status, 'sin decisión');
  assert.equal(result.cells[0].costPerAccepted, .02 / 3);
  result = analyzeEvidence([run(1), {...run(2), protocol: 'old'}, run(3)]);
  assert.equal(result.decisions.every(d => d.status === 'sin decisión'), true);
});
test('calls never count as independent trials or double aggregate run cost', () => {
  const result = analyzeEvidence([run(1), fixture('call-1'), fixture('call-2')]);
  assert.equal(result.runs, 1); assert.equal(result.calls, 2);
  assert.equal(result.observedCostMax, .005);
  assert.equal(result.cells[0].n, 1);
  assert.equal(result.operations[0].operation, 'implementar');
});
test('report escapes task text, exposes unknowns and produces offline charts and evidence references', () => {
  const analysis = analyzeEvidence([{...run(1), taskId: '<script>alert(1)</script>', engineeringQuality: null}]);
  assert.equal(analysis.cells[0].acceptance, null);
  const html = renderEvidenceReport(analysis);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('<svg')); assert.ok(html.includes('sin decisión')); assert.ok(html.includes('N/D'));
  assert.ok(html.includes('Protocolo')); assert.ok(html.includes('Traspaso')); assert.ok(html.includes('Caché'));
});
test('different snapshots cannot satisfy repetitions and conflicting immutable IDs are rejected', () => {
  const a = run(1), b = {...run(2), snapshotHash: 'e'.repeat(64)};
  assert.equal(analyzeEvidence([a, b, run(3)]).decisions.every(d => d.status === 'sin decisión'), true);
  assert.throws(() => analyzeEvidence([a, {...a, wallMs: 2000}]), /immutable/);
});
