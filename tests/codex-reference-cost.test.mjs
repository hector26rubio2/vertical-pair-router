import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexReferenceCost} from '../tools/lib/codex-reference-cost.mjs';
const catalog={expiresAt:'2026-12-16',checkedAt:'2026-11-16',source:'official',cards:[{model:'gpt-test',input:1,output:5,cacheRead:.05,cacheWrite30m:1.25,cacheWrite12h:2.5}]};
test('Codex subtracts cached reads and writes from total input and does not add reasoning again',()=>{
  const row=codexReferenceCost({input_tokens:1000,cached_input_tokens:400,cache_write_input_tokens:200,output_tokens:100,reasoning_output_tokens:60},'gpt-test',catalog,'2026-11-16');
  assert.equal(row.inputTokens,400);assert.equal(row.totalTokens,1100);assert.ok(Math.abs(row.cost.totalUsd.min-.00117)<1e-10);assert.ok(Math.abs(row.cost.totalUsd.max-.00142)<1e-10);
});
test('Codex refuses missing counters, expired prices and unestablished context tier',()=>{
  const usage={input_tokens:1000,cached_input_tokens:400,cache_write_input_tokens:200,output_tokens:100,reasoning_output_tokens:60};
  assert.equal(codexReferenceCost({...usage,cache_write_input_tokens:undefined},'gpt-test',catalog,'2026-11-16'),null);
  assert.equal(codexReferenceCost(usage,'gpt-test',catalog,'2027-01-01'),null);
  assert.equal(codexReferenceCost({...usage,input_tokens:100001},'gpt-test',catalog,'2026-11-16'),null);
});

test('unreported reasoning breakdown does not prevent pricing an observed inclusive output total',()=>{
  const row=codexReferenceCost({input_tokens:1000,cached_input_tokens:400,cache_write_input_tokens:0,output_tokens:100},'gpt-test',catalog,'2026-11-16');
  assert.ok(row.cost);assert.equal(row.reasoningTokensIncludedInOutput,null);assert.equal(row.totalTokens,1100);
});

test('unknown per-request context uses official short/long price bounds rather than inferring a long prompt from cumulative input',()=>{
  const extended={...catalog,cards:[{...catalog.cards[0],longContext:{input:2,output:7.5,cacheRead:.1,cacheWrite30m:2.5,cacheWrite12h:5}}]};
  const result=codexReferenceCost({input_tokens:200000,cached_input_tokens:190000,cache_write_input_tokens:0,output_tokens:100},'gpt-test',extended,'2026-11-18');
  assert.equal(result.cost.unknownContextTier,true);assert.equal(result.cost.modelIdentityCaveat,true);
  assert.ok(Math.abs(result.cost.totalUsd.min-.02)<1e-10);assert.ok(Math.abs(result.cost.totalUsd.max-.03975)<1e-10);
});
