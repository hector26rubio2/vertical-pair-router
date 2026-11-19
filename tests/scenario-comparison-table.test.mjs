import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionSum, scenarioComparisonTable,comparisonBreakdown} from '../tools/lib/scenario-comparison-table.mjs';

const model = (name, input, output, read, write, price) => ({model: name, role: name === 'sonnet' ? 'orquestador' : 'ejecutor', inputTokens: input, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: write, totalTokens: input + output + read + write, cost: {totalUsd: {min: price, max: price}}});
const row = {taskId: 'B01', arm: 'sonnet-haiku', coordinatorModel: 'sonnet', status: 'accepted', models: [model('sonnet', 10, 20, 30, 40, .1), model('haiku', 1, 2, 3, 4, .02)], receipt: {totals: {inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheWriteTokens: 44, totalTokens: 110}, timings: {wallMs: 5000}}, checks: {external: {passed: 2}}};

test('comparison sums all models once, including cache, and rejects inconsistent receipt totals', () => {
  assert.deepEqual(executionSum(row), {inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheWriteTokens: 44, totalTokens: 110, cost: {min: .12000000000000001, max: .12000000000000001}});
  assert.throws(() => executionSum({...row, receipt: {totals: {...row.receipt.totals, totalTokens: 220}}}), /Accounting mismatch/);
  assert.equal(executionSum({...row, models: []}).totalTokens, null);
  assert.equal(executionSum({...row, models: [{...row.models[0], cost: null}], receipt: {}}).cost, null);
  assert.equal(executionSum({...row,totalCost:null}).cost,null);
  assert.equal(executionSum({...row,executorModel:'codex-unreported'}).cost,null);
});

test('one shared scenario contains model subrows and explicit token and dollar addition', () => {
  const html = scenarioComparisonTable({tasks: [{id: 'B01', name: 'Corregir carrito', level: 'simple', testCount: 2}], rows: [row], descriptions: {B01: 'Sumar precios <sin concatenar>'}, armLabel: () => 'Sonnet → Haiku'});
  assert.equal((html.match(/<table /g) ?? []).length, 1);
  assert.match(html, /rowspan="3"[^>]*>B01 · Corregir carrito/);
  assert.match(html, /Sumar precios &lt;sin concatenar&gt;/);
  assert.match(html, /100 \+ 10 = <strong>110<\/strong>/);
  assert.match(html, /0\.10000000 \+ 0\.02000000 = <strong>0\.12000000<\/strong>/);
  assert.match(html, /externas 2\/2/);
});

test('planner and reviewer costs remain separate and reconcile before rendering phase rows',()=>{
  const phases=[{phase:'plan',models:[model('sonnet',4,8,12,16,.04)],receipt:{timings:{wallMs:100}}},{phase:'review',models:[model('sonnet',6,12,18,24,.06)],receipt:{timings:{wallMs:200}}},{phase:'implement',models:[row.models[1]],receipt:{timings:{wallMs:300}}}];
  const breakdown=comparisonBreakdown({...row,phaseCosts:phases});assert.equal(breakdown.length,3);assert.equal(breakdown[0].role,'Planificación');assert.equal(breakdown[1].role,'Revisión');assert.equal(breakdown[2].phaseWallMs,300);
  assert.equal(comparisonBreakdown({...row,phaseCosts:phases.slice(0,2)}).length,2);
  assert.equal(comparisonBreakdown({...row,phaseCosts:phases.slice(0,2)})[0].inputTokens,10);
});
