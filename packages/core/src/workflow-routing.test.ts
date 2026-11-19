import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAgentWorkflow, type WorkflowCase, type WorkflowRequest } from './workflow-routing.js';
import type { AgentRoutingPolicy } from './agent-routing.js';
const policy: AgentRoutingPolicy={orchestratorId:'sonnet',allowLightCoding:true,maxWorkers:2,models:[
  {id:'haiku',provider:'claude',model:'claude-haiku-5-5',tier:'light',roles:['coding']},
  {id:'sonnet',provider:'claude',model:'claude-sonnet-5-5',tier:'standard',roles:['orchestrator','coding','review']},
  {id:'opus',provider:'claude',model:'claude-opus-5-5',tier:'high',roles:['review','coding']},
  {id:'terra',provider:'codex',model:'gpt-6.1-terra',tier:'standard',roles:['coding']}
]};
const request: WorkflowRequest={kind:'feature',taskSignature:'feature-v1',complexity:'simple',risk:'low',hasAcceptanceChecks:true,needsPlanning:false,currentModelId:'sonnet',
  preferredExecutorId:'haiku',plannerId:'sonnet',advancedPlannerId:'opus',allowedProviders:['claude'],verifiedModelIds:['haiku','sonnet','opus','terra'],history:[],now:'2026-11-16T12:00:00Z'};
test('easy checked work bypasses planner without a model routing call',()=>{
  const result=decideAgentWorkflow(policy,request);
  assert.equal(result.executorId,'haiku');assert.equal(result.plannerId,null);assert.equal(result.phases.length,1);assert.equal(result.decisionInferenceTokens,0);assert.equal(result.dispatchPerformed,false);
});
test('normal planning keeps source edits with light worker and review with planner',()=>{
  const result=decideAgentWorkflow(policy,{...request,complexity:'normal',needsPlanning:true});
  assert.equal(result.plannerId,'sonnet');assert.equal(result.executorId,'haiku');assert.deepEqual(result.phases.map(phase=>phase.writeFiles),[false,true,false]);assert.equal(result.workerCount,1);
});
test('advanced analysis escalates planner without promoting the implementation worker',()=>{
  const result=decideAgentWorkflow(policy,{...request,kind:'refactor',complexity:'complex',risk:'high',needsPlanning:true});
  assert.equal(result.plannerId,'opus');assert.equal(result.executorId,'haiku');assert.equal(result.estimatedReferenceUsdPerAccepted,null);
});

test('explicit three-stage route keeps Opus architecture, Sonnet refinement and review, and Haiku writes',()=>{
  const result=decideAgentWorkflow(policy,{...request,complexity:'complex',risk:'high',needsPlanning:true,technicalPlannerId:'sonnet',reviewerId:'sonnet',planningMode:'three-stage'});
  assert.equal(result.mode,'architecture-technical-implement-review');
  assert.deepEqual(result.phases.map(p=>[p.phase,p.modelId,p.writeFiles]),[['plan','opus',false],['technical-plan','sonnet',false],['implement','haiku',true],['review','sonnet',false]]);
  assert.equal(result.decisionInferenceTokens,0);assert.equal(result.estimatedReferenceUsdPerAccepted,null);
});

test('auto mode does not add a technical model just because it is configured, and cannot widen provider access',()=>{
  const input:WorkflowRequest={...request,complexity:'complex',needsPlanning:true,technicalPlannerId:'sonnet'};
  const result=decideAgentWorkflow(policy,input);
  assert.equal(result.technicalPlannerId,null);assert.equal(result.phases.length,3);
  assert.equal(result.candidates.length,2);
  assert.equal(decideAgentWorkflow(policy,{...input,technicalPlannerId:'terra',planningMode:'three-stage'}).status,'blocked');
  assert.equal(decideAgentWorkflow(policy,{...input,technicalPlannerId:'sonnet',verifiedModelIds:['opus','haiku'],planningMode:'three-stage'}).status,'blocked');
});

test('two-stage evidence cannot establish a three-stage price; reviewed direct evidence cannot authorize unreviewed light work',()=>{
  const history:WorkflowCase[]=Array.from({length:3},(_,i)=>({caseId:'two'+i,taskKind:'feature',taskSignature:'feature-v1',complexity:'complex',risk:'low',plannerId:'opus',executorId:'haiku',accepted:true,modelConfirmed:true,completeAccounting:true,usdMax:.001,pricesExpireAt:'2026-12-01'}));
  const result=decideAgentWorkflow(policy,{...request,complexity:'complex',needsPlanning:true,technicalPlannerId:'sonnet',planningMode:'three-stage',history});
  assert.equal(result.candidates[0]?.samples,0);assert.equal(result.estimatedReferenceUsdPerAccepted,null);
  const reviewed=history.map((c,i)=>({...c,caseId:'reviewed'+i,complexity:'normal' as const,plannerId:null,reviewerId:'sonnet'}));
  assert.ok(decideAgentWorkflow(policy,{...request,complexity:'normal',history:reviewed}).candidates.every(c=>c.plannerId!==null||c.executorId!=='haiku'));
});
test('light implementation needs acceptance and opt-in; cross-provider needs policy and verified model',()=>{
  assert.equal(decideAgentWorkflow(policy,{...request,needsPlanning:true,hasAcceptanceChecks:false}).status,'blocked');
  assert.equal(decideAgentWorkflow({...policy,allowLightCoding:false},{...request,needsPlanning:true}).status,'blocked');
  assert.equal(decideAgentWorkflow(policy,{...request,preferredExecutorId:'terra',needsPlanning:true}).status,'blocked');
  assert.equal(decideAgentWorkflow(policy,{...request,preferredExecutorId:'terra',needsPlanning:true,allowedProviders:['claude','codex']}).executorId,'terra');
  assert.equal(decideAgentWorkflow(policy,{...request,verifiedModelIds:['sonnet','opus'],needsPlanning:true}).status,'blocked');
});
test('whole workflow evidence may retain current model when delegation costs more',()=>{
  const history: WorkflowCase[]=Array.from({length:3},(_,index)=>[
    {caseId:`direct-${index}`,taskKind:'feature' as const,taskSignature:'feature-v1',complexity:'normal' as const,risk:'low' as const,plannerId:null,executorId:'sonnet',accepted:true,modelConfirmed:true,completeAccounting:true,usdMax:.01,pricesExpireAt:'2026-12-01'},
    {caseId:`planned-${index}`,taskKind:'feature' as const,taskSignature:'feature-v1',complexity:'normal' as const,risk:'low' as const,plannerId:'sonnet',executorId:'haiku',accepted:true,modelConfirmed:true,completeAccounting:true,usdMax:.05,pricesExpireAt:'2026-12-01'}
  ]).flat();
  const result=decideAgentWorkflow(policy,{...request,complexity:'normal',history});
  assert.equal(result.status,'historical-forecast');assert.equal(result.mode,'direct-current');assert.equal(result.workerCount,0);assert.equal(result.estimatedReferenceUsdPerAccepted,.01);
  assert.equal(decideAgentWorkflow(policy,{...request,complexity:'normal',history:[...history,...history]}).candidates[0]?.samples,3);
});
test('unrelated or incomplete cases do not establish savings',()=>{
  const row: WorkflowCase={caseId:'partial',taskKind:'bugfix',taskSignature:'unrelated',complexity:'simple',risk:'low',plannerId:null,executorId:'haiku',accepted:true,modelConfirmed:true,completeAccounting:false,usdMax:0,pricesExpireAt:'2026-12-01'};
  const result=decideAgentWorkflow(policy,{...request,history:[row]});assert.equal(result.status,'rule-based');assert.equal(result.estimatedReferenceUsdPerAccepted,null);
});

test('a proven light direct executor may beat a planning workflow on matched normal work',()=>{
  const history:WorkflowCase[]=['haiku','sonnet','planned'].flatMap(route=>Array.from({length:3},(_,index)=>({
    caseId:route+index,taskKind:'feature',taskSignature:'feature-v1',complexity:'normal',risk:'low',plannerId:route==='planned'?'sonnet':null,
    executorId:route==='sonnet'?'sonnet':'haiku',accepted:true,modelConfirmed:true,completeAccounting:true,usdMax:route==='haiku'?.001:route==='sonnet'?.01:.02,pricesExpireAt:'2026-12-01'
  })));
  const result=decideAgentWorkflow(policy,{...request,complexity:'normal',history});
  assert.equal(result.status,'historical-forecast');assert.equal(result.executorId,'haiku');assert.equal(result.plannerId,null);
  assert.equal(decideAgentWorkflow(policy,{...request,complexity:'normal',needsPlanning:true,history}).plannerId,'sonnet');
});

test('does not spawn a duplicate of the same configured active model',()=>{
  const result=decideAgentWorkflow({...policy,models:[...policy.models,{...policy.models[1]!,id:'same-worker'}]}, {...request,preferredExecutorId:'same-worker',verifiedModelIds:[...request.verifiedModelIds,'same-worker']});
  assert.equal(result.mode,'direct-current');assert.equal(result.workerCount,0);assert.equal(result.executorId,'sonnet');
});

test('proven bounded complex work does not force planning when the task needs none',()=>{
  const history:WorkflowCase[]=Array.from({length:3},(_,index)=>({caseId:'refactor-'+index,taskKind:'refactor',taskSignature:'refactor-v1',complexity:'complex',risk:'medium',plannerId:null,executorId:'haiku',accepted:true,modelConfirmed:true,completeAccounting:true,usdMax:.02,pricesExpireAt:'2026-12-01'}));
  const result=decideAgentWorkflow(policy,{...request,kind:'refactor',taskSignature:'refactor-v1',complexity:'complex',risk:'medium',needsPlanning:false,history});
  assert.equal(result.executorId,'haiku');assert.equal(result.plannerId,null);assert.equal(result.phases.length,1);assert.equal(result.estimatedReferenceUsdPerAccepted,null);
  assert.equal(decideAgentWorkflow(policy,{...request,kind:'refactor',taskSignature:'refactor-v1',complexity:'complex',risk:'medium',needsPlanning:true,history}).plannerId,'opus');
});

test('compares explicit Codex executors without widening provider or availability policy',()=>{
  const extended:AgentRoutingPolicy={...policy,models:[...policy.models,
    {id:'sol',provider:'codex',model:'gpt-6.1-sol',tier:'standard',roles:['coding']},
    {id:'luna',provider:'codex',model:'gpt-6-luna',tier:'light',roles:['coding']} ]};
  const input:WorkflowRequest={...request,needsPlanning:true,executorModelIds:['terra','sol','luna'],allowedProviders:['claude','codex'],verifiedModelIds:[...request.verifiedModelIds,'sol']};
  const result=decideAgentWorkflow(extended,input);
  assert.deepEqual(result.candidates.map(candidate=>candidate.executorId),['haiku','terra','sol']);
  assert.deepEqual(decideAgentWorkflow(extended,{...input,allowedProviders:['claude']}).candidates.map(candidate=>candidate.executorId),['haiku']);
  assert.throws(()=>decideAgentWorkflow(extended,{...input,executorModelIds:'terra' as unknown as string[]}),/Invalid executor/);
});

test('ranks the full cost of multiple confirmed delegated model alternatives',()=>{
  const history:WorkflowCase[]=['haiku','terra'].flatMap(executorId=>Array.from({length:3},(_,i)=>({caseId:executorId+i,taskKind:'feature',taskSignature:'feature-v1',complexity:'simple',risk:'low',plannerId:'sonnet',executorId,accepted:true,modelConfirmed:true,completeAccounting:true,usdMax:executorId==='terra'?.02:.05,pricesExpireAt:'2026-12-01'})));
  const result=decideAgentWorkflow(policy,{...request,needsPlanning:true,executorModelIds:['terra'],allowedProviders:['claude','codex'],history});
  assert.equal(result.status,'historical-forecast');assert.equal(result.executorId,'terra');assert.equal(result.estimatedReferenceUsdPerAccepted,.02);assert.equal(result.decisionInferenceTokens,0);
});

test('review requires its own configured role and never grants source writes or reuses coding evidence',()=>{
  const history:WorkflowCase[]=Array.from({length:3},(_,i)=>({caseId:'coding'+i,taskKind:'feature',taskSignature:'feature-v1',complexity:'simple',risk:'low',plannerId:null,executorId:'haiku',accepted:true,modelConfirmed:true,completeAccounting:true,usdMax:.001,pricesExpireAt:'2026-12-01'}));
  const result=decideAgentWorkflow(policy,{...request,executionRole:'review',history});
  assert.equal(result.executorId,'sonnet');assert.equal(result.phases[0]?.phase,'review');assert.equal(result.phases[0]?.writeFiles,false);assert.ok(result.candidates.every(candidate=>candidate.samples===0));
});

test('excludes freshly exhausted providers without treating stale or absent quota as available',()=>{
  const capacity={provider:'codex',state:'limit-reached' as const,source:'provider_reported' as const,observedAt:request.now};
  const input={...request,needsPlanning:true,executorModelIds:['terra'],allowedProviders:['claude','codex'],providerCapacity:[capacity]};
  assert.ok(decideAgentWorkflow(policy,input).candidates.every(candidate=>candidate.executorId!=='terra'));
  const stale=decideAgentWorkflow(policy,{...input,providerCapacity:[{...capacity,observedAt:'2026-11-15T00:00:00Z'}]});
  assert.equal(stale.quotaChecks.find(check=>check.provider==='codex')?.state,'unknown');
  assert.equal(decideAgentWorkflow(policy,{...input,requireKnownCapacity:true}).status,'blocked');
});
