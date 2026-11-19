import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTask,contextEvidence} from '../tools/lib/benchmark-analysis.mjs';
import {officialCostBreakdown} from '../tools/lib/official-cost-breakdown.mjs';
import {readFile} from 'node:fs/promises';

const task={id:'W01',level:'medio'};
const sample=(arm,status,cost)=>({taskId:'W01',arm,status,acceptanceHash:'same',models:[{model:'haiku'}],totalCost:{min:cost,max:cost},receipt:{completeAccounting:true,timings:{wallMs:1000}}});
test('lowest cost cannot establish quality: failed, conditional and incompatible cases do not win',()=>{
  const failed=sample('cheap','incomplete',.001), passed=sample('passed','accepted',.1);
  const conditional={...sample('conditional','accepted',.01),models:[{cost:{modelIdentityCaveat:true}}]};
  const result=analyzeTask(task,[failed,passed,conditional]);
  assert.equal(result.cheapestObserved,'passed');
  assert.equal(result.comparativeConfidence,'exploratory');
  assert.equal(result.strategies[1].independentCodeReview,'not-measured');
  assert.equal(analyzeTask(task,[passed,{...passed,acceptanceHash:'different'}]).cheapestObserved,null);
  assert.equal(analyzeTask(task,[{...passed,semanticReview:'pending'}]).cheapestObserved,null);
  const reviewed=analyzeTask(task,[{...sample('cheap','accepted',.001),semanticReview:'changes-requested'},{...passed,semanticReview:'reviewed-draft'}]);
  assert.equal(reviewed.nextTrialCandidate.arm,'passed');
  assert.equal(reviewed.cheapestObserved,null);
  assert.equal(analyzeTask(task,[{...passed,semanticReview:'passed',qualityReview:{approved:true,findings:[{severity:'medium'}]}}]).cheapestObserved,null);
});
test('cost per acceptance includes failed attempts and missing baselines stay explicit',()=>{
  const result=analyzeTask(task,[sample('sonnet-haiku','incomplete',.03),sample('sonnet-haiku-attempt-2','accepted',.04)]);
  assert.equal(result.strategies[0].costPerAccepted.max,.07);
  assert.equal(result.strategies[0].acceptanceRate,.5);
  assert.equal(result.cheapestObserved,null);
  assert.ok(result.missing.includes('sonnet-solo'));
  assert.ok(result.missing.includes('opus-haiku'));
});

test('an accepted conditional engineering candidate is visible without becoming a confirmed routing winner',()=>{
  const row={...sample('sonnet-codex-terra','accepted',.03),semanticReview:'passed',models:[{cost:{modelIdentityCaveat:true}}],qualityReview:{approved:true,findings:[]}};
  const result=analyzeTask(task,[row]);assert.equal(result.cheapestObserved,null);assert.equal(result.conditionalEngineeringCandidate.arm,'sonnet-codex-terra');
  assert.equal(analyzeTask(task,[{...row,qualityReview:{approved:true,findings:[{severity:'medium'}]}}]).conditionalEngineeringCandidate,null);
});
test('context is max prompt including cache, never cumulative session tokens',()=>{
  const row={receipt:{requests:[{model:'h',inputTokens:10,cacheReadTokens:100,cacheWriteTokens:5},{model:'h',inputTokens:20,cacheReadTokens:200,cacheWriteTokens:10}]}};
  assert.equal(contextEvidence(row,{model:'h',totalTokens:10000}).observedMax,230);
  assert.equal(contextEvidence({}, {model:'h',totalTokens:10000}).observedMax,null);
});

test('provider blocks and first-pass trials do not contaminate a one-correction comparison',()=>{
  const blocked={...sample('blocked','incomplete',.001),phases:[{answer:'VPR: context guard unavailable'}]};
  const previous={...sample('sonnet-solo','accepted',.1),validationPolicy:'common-review-first-pass'};
  const current={...sample('haiku-solo','accepted',.2),validationPolicy:'common-review-up-to-one-correction'};
  const result=analyzeTask(task,[blocked,previous,current]);assert.equal(result.strategies.length,1);assert.equal(result.cheapestObserved,'haiku-solo');assert.equal(result.excludedTrials,2);assert.equal(result.technicalBlocked,1);
});
test('identical input and output counters use different official Haiku and Sonnet rates',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../docs/research/model-price-catalog.json',import.meta.url),'utf8'));
  const counts={inputTokens:10000,outputTokens:1000,cacheReadTokens:0,cacheWriteTokens:0};
  const cost=model=>officialCostBreakdown({...counts,model},[{...counts,model}],catalog,'2026-11-17').totalUsd.max;
  assert.ok(Math.abs(cost('claude-sonnet-5-5')/cost('claude-haiku-5-5')-20)<1e-9);
  assert.ok(Math.abs(cost('claude-haiku-5-5')-.0015)<1e-10);
});
