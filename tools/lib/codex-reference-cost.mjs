/** Codex input includes cached read AND cached write; reasoning is part of output. */
export function codexReferenceCost(usage, model, catalog, now = new Date().toISOString()) {
  const keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens'];
  if (!usage || !keys.every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0) ||
      usage.cached_input_tokens+usage.cache_write_input_tokens>usage.input_tokens ||
      (usage.reasoning_output_tokens!=null&&(!Number.isSafeInteger(usage.reasoning_output_tokens)||usage.reasoning_output_tokens<0||usage.reasoning_output_tokens>usage.output_tokens))) return null;
  const card=catalog.cards.find(card=>card.model===model);
  // A cumulative input below this bound also bounds every individual request.
  if(!card||!Number.isFinite(Date.parse(now))||!Number.isFinite(Date.parse(catalog.expiresAt))||Date.parse(catalog.expiresAt)<Date.parse(now)||
    !['input','output','cacheRead','cacheWrite30m','cacheWrite12h'].every(key=>Number.isFinite(card[key])&&card[key]>=0))return null;
  const unknownContextTier=usage.input_tokens>100000;
  if(unknownContextTier&&!['input','output','cacheRead','cacheWrite30m','cacheWrite12h'].every(key=>Number.isFinite(card.longContext?.[key])&&card.longContext[key]>=0))return null;
  const tiers=unknownContextTier?[card,card.longContext]:[card];
  const range=(tokens,key)=>({min:tokens*Math.min(...tiers.map(t=>t[key]))/1e6,max:tokens*Math.max(...tiers.map(t=>t[key]))/1e6});
  const inputTokens=usage.input_tokens-usage.cached_input_tokens-usage.cache_write_input_tokens;
  const parts={inputUsd:range(inputTokens,'input'),outputUsd:range(usage.output_tokens,'output'),cacheReadUsd:range(usage.cached_input_tokens,'cacheRead'),
    cacheWriteUsd:{min:usage.cache_write_input_tokens*Math.min(...tiers.map(t=>Math.min(t.cacheWrite30m,t.cacheWrite12h)))/1e6,max:usage.cache_write_input_tokens*Math.max(...tiers.map(t=>Math.max(t.cacheWrite30m,t.cacheWrite12h)))/1e6}};
  return {model,provider:'codex',role:'ejecutor',inputTokens,outputTokens:usage.output_tokens,
    cacheReadTokens:usage.cached_input_tokens,cacheWriteTokens:usage.cache_write_input_tokens,totalTokens:usage.input_tokens+usage.output_tokens,
    reasoningTokensIncludedInOutput:usage.reasoning_output_tokens??null,
    cost:{...parts,totalUsd:{min:Object.values(parts).reduce((s,p)=>s+p.min,0),max:Object.values(parts).reduce((s,p)=>s+p.max,0)},
      source:catalog.source,checkedAt:catalog.checkedAt,basis:'official-api-reference-for-explicit-requested-model',modelIdentityCaveat:true,unknownContextTier,contextPromptUpperBound:usage.input_tokens} };
}
