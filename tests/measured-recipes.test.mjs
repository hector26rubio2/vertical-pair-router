import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measuredRecipes,codexMeasuredRecipes,mergeRecipeReceipts} from '../tools/lib/measured-recipes.mjs';
test('three-model recipe assigns architecture, technical plan and file edits separately',()=>{
  assert.deepEqual(measuredRecipes.find(r=>r.id==='opus-sonnet-haiku').steps,[['architecture','opus'],['technical-plan','sonnet'],['implement','haiku']]);
});

test('Codex combinations are opt-in and preserve conditional individual phase costs',()=>{
  assert.equal(codexMeasuredRecipes.length,4);assert.equal(measuredRecipes.length,6);
  const counters={inputTokens:10,outputTokens:20,cacheReadTokens:30,cacheWriteTokens:0,totalTokens:60};
  const cost={modelIdentityCaveat:true,...Object.fromEntries(['inputUsd','outputUsd','cacheReadUsd','cacheWriteUsd','totalUsd'].map(key=>[key,{min:1,max:2}]))};
  const phase={phase:'implement',receipt:{models:[{model:'gpt-test',provider:'codex',...counters,cost}],completeAccounting:true,requests:[],timings:{wallMs:1000},terminalReceipt:{success:true},tools:[]}};
  const result=mergeRecipeReceipts([phase,phase],{cards:[]});
  assert.equal(result.models[0].provider,'codex');assert.equal(result.models[0].cost.modelIdentityCaveat,true);assert.deepEqual(result.totalCost,{min:2,max:4});
  phase.receipt.models[0].cost=null;assert.equal(mergeRecipeReceipts([phase],{cards:[]}).totalCost,null);
});
test('phase accounting sums independent sessions once and separates context requests with reused IDs',async()=>{
  const prices=JSON.parse(await readFile(new URL('../docs/research/model-price-catalog.json',import.meta.url),'utf8'));
  const model='claude-sonnet-5-5';
  const counters={inputTokens:10,outputTokens:20,cacheReadTokens:30,cacheWriteTokens:40,totalTokens:100};
  const phase=name=>({phase:name,receipt:{models:[{model,...counters}],completeAccounting:true,requests:[{id:'same-native-id',model,...counters,cacheWrite5mTokens:40,cacheWrite1hTokens:0}],timings:{wallMs:1000},terminalReceipt:{success:true},tools:[]}});
  const merged=mergeRecipeReceipts([phase('plan'),phase('review')],prices);
  assert.equal(merged.models.length,1);assert.equal(merged.models[0].totalTokens,200);
  assert.equal(merged.receipt.totals.totalTokens,200);assert.equal(merged.receipt.timings.wallMs,2000);
  assert.equal(new Set(merged.receipt.requests.map(r=>r.id)).size,2);
  assert.ok(merged.totalCost);assert.equal(merged.models[0].cost.perRequestCoverage,true);
  assert.equal(mergeRecipeReceipts([{...phase('implement'),receipt:{...phase('implement').receipt,completeAccounting:false}}],prices).totalCost,null);
});
