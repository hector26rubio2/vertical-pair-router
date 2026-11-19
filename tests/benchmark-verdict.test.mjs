import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityEvidence,taskVerdict,canonicalRecipe} from '../tools/lib/benchmark-verdict.mjs';
const task={id:'F',name:'Real change',level:'medio-alto',testCount:9,protocol:'staged-recipe-v1',expectedArms:['haiku-solo-reviewed','sonnet-solo-reviewed','sonnet-codex-terra-reviewed','sonnet-codex-sol-reviewed']};
function sample(recipe,cost,findings=[],conditional=false){return {taskId:'F',arm:recipe+'-reviewed',strategyArm:recipe+'-reviewed',status:'accepted',acceptanceHash:'same',protocol:'staged-recipe-v1',validationPolicy:'common-review-up-to-one-correction',
  checks:{external:{exitCode:0,passed:9}},qualityReview:{approved:true,findings},minimumStandard:{passed:true,reviewEvidenceValid:true},semanticReview:'passed',
  phases:[{phase:'implement',model:recipe,receipt:{terminalReceipt:{success:true}}},{phase:'review',model:'sonnet',receipt:{terminalReceipt:{success:true}}}],
  models:[{model:recipe,cost:{modelIdentityCaveat:conditional}}],totalCost:{min:cost,max:cost},receipt:{completeAccounting:true,timings:{wallMs:1000}}};}
test('quality is checked before economy: cheap medium-finding result cannot win or claim equivalent quality',()=>{
  const sonnet=sample('sonnet-solo',.6),haiku=sample('haiku-solo',.01,[{severity:'medium'}]);
  const result=taskVerdict(task,[sonnet,haiku]);assert.equal(result.pilotChoice,'sonnet-solo');assert.equal(result.cells.find(c=>c.recipe==='haiku-solo').qualityPassed,0);
  assert.equal(qualityEvidence(haiku,task).freshReview,true);assert.ok(result.attemptedNotQualified.includes('haiku-solo'));assert.equal(result.autoRoutingReady,false);
});
test('conditional Codex can be the best pilot while confirmed Sonnet remains fallback; comparison is same quality threshold only',()=>{
  const result=taskVerdict(task,[sample('sonnet-solo',.6),sample('sonnet-codex-terra',.35,[],true),sample('sonnet-codex-sol',.5,[{severity:'medium'}],true)]);
  assert.equal(result.pilotChoice,'sonnet-codex-terra');assert.equal(result.fallbackChoice,'sonnet-solo');assert.equal(result.pilotPriceConditional,true);
  assert.ok(Math.abs(result.savingAgainstSonnetPercent.min-41.6666667)<.001);assert.equal(result.autoRoutingReady,false);
});
test('legacy checks alone never become an engineering recommendation, even after repeated cheap success',()=>{
  const row=sample('haiku-solo',.01);delete row.minimumStandard;delete row.phases;delete row.qualityReview;delete row.semanticReview;
  const result=taskVerdict(task,[row,row,row]);assert.equal(result.pilotChoice,null);assert.equal(result.labCandidate,'haiku-solo');assert.equal(result.autoRoutingReady,false);
});
test('failed attempts are charged per quality result and missing costs cannot establish a cheaper route',()=>{
  const success=sample('haiku-solo',.1),failed={...sample('haiku-solo',.9),status:'incomplete'};
  const result=taskVerdict(task,[success,failed]);assert.equal(result.cells[0].costPerQualityResult.max,1);assert.equal(result.pilotChoice,null);
  assert.equal(taskVerdict(task,[{...success,totalCost:null}]).pilotChoice,null);
});
test('untried routes and attempted failures remain distinct; overlapping prices do not imply a winner',()=>{
  const a=sample('haiku-solo',.1),b={...sample('sonnet-solo',.2),totalCost:{min:.05,max:.3}};
  const r=taskVerdict(task,[a,b]);assert.equal(r.pilotChoice,null);assert.deepEqual(r.costContenders,['haiku-solo','sonnet-solo']);
  assert.ok(r.notTested.includes('sonnet-codex-terra'));assert.equal(canonicalRecipe('sonnet-codex-6.1-terra-reviewed-attempt-2-attempt-2'),'sonnet-codex-terra');
  assert.equal(taskVerdict(task,[a,{...b,acceptanceHash:'different'}]).comparable,false);
});
