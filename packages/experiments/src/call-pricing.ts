import type {EvidenceRecord} from '@vpr/contracts';
import type {ModelPriceCatalog} from '@vpr/observability';

/** Arithmetic from observed call counters and a dated catalog; never a subscription charge. */
export function priceEvidenceCalls(records: readonly EvidenceRecord[], catalog: ModelPriceCatalog, asOf: string): EvidenceRecord[] {
  const at = Date.parse(asOf), expires = Date.parse(catalog.expiresAt);
  if (!Number.isFinite(at) || !Number.isFinite(expires)) throw new Error('Invalid pricing date');
  return records.map(row => {
    if (row.granularity !== 'call' || !row.model || !/^claude-/u.test(row.model) || at > expires) return row;
    const card = catalog.cards.find(card => card.model === row.model), t = row.tokens;
    if (!card || [t.input, t.output, t.cacheRead, t.cacheWrite, t.contextMax].some(n => n === null)) return row;
    const rate = card.tiers.find(tier => tier.maxPromptTokens === null || t.contextMax! <= tier.maxPromptTokens);
    if (!rate) return row;
    const five = t.cacheWrite5m ?? 0, hour = t.cacheWrite1h ?? 0, remaining = t.cacheWrite! - five - hour;
    if (remaining < 0) return {...row, unavailable: {...row.unavailable, 'cost': 'TTL counters exceed total cache writes'}};
    const input = t.input! * rate.input / 1e6, output = t.output! * rate.output / 1e6, read = t.cacheRead! * rate.cacheRead / 1e6;
    const known = (five * rate.cacheWrite5m + hour * rate.cacheWrite1h) / 1e6;
    const writeMin = known + remaining * Math.min(rate.cacheWrite5m, rate.cacheWrite1h) / 1e6;
    const writeMax = known + remaining * Math.max(rate.cacheWrite5m, rate.cacheWrite1h) / 1e6;
    const unavailable = {...row.unavailable};
    for (const key of ['cost.inputUsd', 'cost.outputUsd', 'cost.cacheReadUsd', 'cost.totalMinUsd', 'cost.totalMaxUsd', 'cost.complete']) delete unavailable[key];
    if (writeMin === writeMax) delete unavailable['cost.cacheWriteUsd'];
    else unavailable['cost.cacheWriteUsd'] = 'Unknown cache TTL; total retains official lower/upper reference prices';
    return {...row, cost: {inputUsd: input, outputUsd: output, cacheReadUsd: read,
      cacheWriteUsd: writeMin === writeMax ? writeMin : null,
      totalMinUsd: input + output + read + writeMin, totalMaxUsd: input + output + read + writeMax, complete: true}, unavailable};
  });
}
