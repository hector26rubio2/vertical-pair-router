/** Official prices applied to observed counters; never add native costUSD to this estimate. */
export function officialCostBreakdown(row, requests, catalog, now = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(catalog.expiresAt))) return null;
  const card = catalog.cards.find(card => card.model === row.model);
  if (!card || Date.parse(catalog.expiresAt) < Date.parse(now)) return null;
  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
  if (keys.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)) return null;
  const matched = requests.filter(request => request.model === row.model);
  const ids=matched.map(request=>request.id).filter(id=>typeof id==='string');
  if(ids.length&&(ids.length!==matched.length||new Set(ids).size!==ids.length))return null;
  const covered = matched.length > 0 && keys.every(key => matched.reduce((sum, request) => sum + request[key], 0) === row[key]);
  const promptKeys=['inputTokens','cacheReadTokens','cacheWriteTokens'];
  const observed=Object.fromEntries(promptKeys.map(key=>[key,matched.reduce((sum,request)=>sum+request[key],0)]));
  const promptCovered = matched.length > 0 && promptKeys.every(key=>observed[key]===row[key]);
  // A streamed message may omit final output usage while still reporting every
  // prompt counter. If all covered prompts are in the base tier, the whole
  // observed output is base-tier too; cumulative input is not context length.
  const aggregatePrompt=promptKeys.reduce((sum,key)=>sum+row[key],0);
  const remaining=promptKeys.reduce((sum,key)=>sum+row[key]-observed[key],0);
  const canBound=matched.length>0&&promptKeys.every(key=>observed[key]<=row[key]);
  // Even if a request is missing, its input is bounded by the remaining
  // aggregate. Add that remainder to the largest observed prompt to cover
  // partial observations too; never assume the missing requests are small.
  const contextPromptUpperBound=canBound?Math.max(...matched.map(request=>promptKeys.reduce((sum,key)=>sum+request[key],0)))+remaining:aggregatePrompt;
  const basePromptCoverage=card.tiers[0].maxPromptTokens===null||contextPromptUpperBound<=card.tiers[0].maxPromptTokens;
  const observed5m = matched.reduce((sum, request) => sum + (request.cacheWrite5mTokens ?? 0), 0);
  const observed1h = matched.reduce((sum, request) => sum + (request.cacheWrite1hTokens ?? 0), 0);
  const validPartialCache = observed5m + observed1h <= row.cacheWriteTokens;
  const samples = covered ? matched : [{ ...row,
    cacheWrite5mTokens: validPartialCache ? observed5m : null,
    cacheWrite1hTokens: validPartialCache ? observed1h : null }];
  const parts = { input: 0, output: 0, cacheRead: 0, cacheWriteMin: 0, cacheWriteMax: 0 };
  let unknownContextTier = false, unknownCacheTtl = false;
  for (const sample of samples) {
    const prompt = sample.inputTokens + sample.cacheReadTokens + sample.cacheWriteTokens;
    const knownTier = covered || basePromptCoverage || card.tiers.length === 1 || prompt <= card.tiers[0].maxPromptTokens;
    const tiers = basePromptCoverage ? [card.tiers[0]] : knownTier ? [card.tiers.find(tier => tier.maxPromptTokens === null || prompt <= tier.maxPromptTokens)] : card.tiers;
    if (!tiers.every(Boolean)) return null;
    unknownContextTier ||= !knownTier;
    const known5m = sample.cacheWrite5mTokens ?? 0, known1h = sample.cacheWrite1hTokens ?? 0;
    const unknownCache = sample.cacheWriteTokens - known5m - known1h;
    if (unknownCache < 0) return null;
    const values = tiers.map(tier => ({ input: sample.inputTokens * tier.input / 1e6,
      output: sample.outputTokens * tier.output / 1e6, cacheRead: sample.cacheReadTokens * tier.cacheRead / 1e6,
      cache5m: (known5m * tier.cacheWrite5m + known1h * tier.cacheWrite1h + unknownCache * Math.min(tier.cacheWrite5m, tier.cacheWrite1h)) / 1e6,
      cache1h: (known5m * tier.cacheWrite5m + known1h * tier.cacheWrite1h + unknownCache * Math.max(tier.cacheWrite5m, tier.cacheWrite1h)) / 1e6 }));
    // Preserve category ranges when an aggregate cannot establish each request's tier.
    for (const key of ['input', 'output', 'cacheRead']) {
      parts[key] += Math.min(...values.map(value => value[key]));
      parts[key + 'Max'] = (parts[key + 'Max'] ?? 0) + Math.max(...values.map(value => value[key]));
    }
    const cacheCosts = values.flatMap(value => [value.cache5m, value.cache1h]);
    unknownCacheTtl ||= unknownCache > 0;
    parts.cacheWriteMin += Math.min(...cacheCosts);
    parts.cacheWriteMax += Math.max(...cacheCosts);
  }
  return { basis: 'official-api-reference', currency: 'USD', source: card.source, checkedAt: catalog.checkedAt,
    inputUsd: { min: parts.input, max: parts.inputMax }, outputUsd: { min: parts.output, max: parts.outputMax },
    cacheReadUsd: { min: parts.cacheRead, max: parts.cacheReadMax }, cacheWriteUsd: { min: parts.cacheWriteMin, max: parts.cacheWriteMax },
    totalUsd: { min: parts.input + parts.output + parts.cacheRead + parts.cacheWriteMin,
      max: parts.inputMax + parts.outputMax + parts.cacheReadMax + parts.cacheWriteMax },
    perRequestCoverage: covered, perRequestPromptCoverage: promptCovered, contextPromptUpperBound, unknownContextTier, unknownCacheTtl };
}
