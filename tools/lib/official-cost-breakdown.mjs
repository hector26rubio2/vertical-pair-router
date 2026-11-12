/** Official prices applied to observed counters; never add native costUSD to this estimate. */
export function officialCostBreakdown(row, requests, catalog, now = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(catalog.expiresAt))) return null;
  const card = catalog.cards.find(card => card.model === row.model);
  if (!card || Date.parse(catalog.expiresAt) < Date.parse(now)) return null;
  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
  if (keys.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)) return null;
  const matched = requests.filter(request => request.model === row.model);
  const covered = matched.length > 0 && keys.every(key => matched.reduce((sum, request) => sum + request[key], 0) === row[key]);
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
    const knownTier = covered || card.tiers.length === 1 || prompt <= card.tiers[0].maxPromptTokens;
    const tiers = knownTier ? [card.tiers.find(tier => tier.maxPromptTokens === null || prompt <= tier.maxPromptTokens)] : card.tiers;
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
    perRequestCoverage: covered, unknownContextTier, unknownCacheTtl };
}
