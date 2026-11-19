import test from 'node:test';
import assert from 'node:assert/strict';
import {filterNativeModels,normalizeCopilotQuota,subscriptionEnvironment,type NativeProviderStatus} from './native-providers.js';
import type {AgentModel} from '@vpr/core';
const models:AgentModel[]=[{id:'haiku',model:'haiku',provider:'claude',roles:['coding'],tier:'light'},{id:'terra',model:'terra',provider:'codex',roles:['coding'],tier:'standard'},{id:'copilot',model:'luna',provider:'copilot',roles:['coding'],tier:'light'}];
const ready=(provider:NativeProviderStatus['provider'],model:string):NativeProviderStatus=>({provider,status:'ready',accountKey:null,models:[{model,supportedEfforts:['medium'],access:'listed'}],quota:'available',observedAt:'2026-11-17T00:00:00Z',inferenceTokens:0,reason:'test metadata'});

test('subscription children do not inherit API or GitHub PAT authentication from the parent',()=>{
  const keys=['OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','GH_TOKEN','GITHUB_TOKEN','COPILOT_GITHUB_TOKEN'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{for(const key of keys)process.env[key]='synthetic-test-value';const env=subscriptionEnvironment();for(const key of keys){assert.equal(env[key],undefined);assert.equal(process.env[key],'synthetic-test-value');}}
  finally{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
test('machine filtering supports Claude only, Codex only, Copilot only and policy exclusions',()=>{
  const statuses=[ready('claude','haiku'),ready('codex','terra'),ready('copilot','luna')];
  for(const provider of ['claude','codex','copilot'])assert.deepEqual(filterNativeModels(models,[provider],statuses).filter(row=>row.eligible).map(row=>row.provider),[provider]);
  const exhausted=filterNativeModels(models,['codex'],[{...statuses[1]!,quota:'limit-reached'}]);assert.equal(exhausted[1]?.eligible,false);assert.ok(exhausted[1]?.reasons.includes('quota-exhausted'));
  assert.ok(filterNativeModels(models,['copilot'],[]).every(row=>!row.eligible));
});
test('Copilot native quotas preserve units, unknown data and unlimited entitlement',()=>{
  const rows=normalizeCopilotQuota({quotaSnapshots:{premium_interactions:{remainingPercentage:0,isUnlimitedEntitlement:false},chat:{remainingPercentage:0,isUnlimitedEntitlement:true},unknown:{}}});
  assert.equal(rows[0]?.state,'limit-reached');assert.equal(rows[1]?.state,'available');assert.equal(rows[2]?.remainingPercentage,null);assert.equal(rows[2]?.state,'unknown');assert.deepEqual(normalizeCopilotQuota(null),[]);
});

test('listing Haiku through another provider cannot bypass the required context preflight',()=>{
  const model:AgentModel={id:'copilot-haiku',provider:'copilot',model:'claude-haiku-5.5',tier:'light',roles:['coding']};
  const result=filterNativeModels([model],['copilot'],[ready('copilot',model.model)])[0]!;
  assert.equal(result.eligible,false);assert.ok(result.reasons.includes('haiku-context-preflight-unavailable-for-provider'));
});
