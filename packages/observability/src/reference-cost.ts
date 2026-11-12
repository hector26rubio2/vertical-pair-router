export interface TokenPriceTier {
  readonly maxPromptTokens: number | null;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}
export interface ModelPriceCatalog {
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly cards: readonly { readonly model: string; readonly source: string; readonly tiers: readonly TokenPriceTier[] }[];
}
export function estimateApiReferenceCost(input: {
  readonly observedModel: string;
  readonly modelConfirmed: boolean;
  /** Claude counters are exclusive: cache reads/writes are separate from input. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheWriteTtl?: '5m' | '1h';
  /** Aggregate multi-request counters cannot establish a per-request context tier. */
  readonly requestCount?: number;
  readonly now: string;
}, catalog: ModelPriceCatalog) {
  const now = Date.parse(input.now), expiry = Date.parse(catalog.expiresAt);
  if (!Number.isFinite(now)) throw new TypeError('Invalid cost estimate timestamp');
  const card = catalog.cards.find(row => row.model === input.observedModel);
  if (!input.modelConfirmed || !card || !Number.isFinite(expiry) || expiry < now) return null;
  if (card.tiers.length > 1 && input.requestCount !== undefined && input.requestCount > 1) return null;
  if ([input.inputTokens, input.outputTokens, input.cacheReadTokens, input.cacheWriteTokens].some(value => !Number.isSafeInteger(value) || value < 0)) throw new TypeError('Invalid token counters');
  const promptTokens = input.inputTokens + input.cacheReadTokens + input.cacheWriteTokens;
  const tier = card.tiers.find(row => row.maxPromptTokens === null || promptTokens <= row.maxPromptTokens);
  if (!tier) return null;
  if ([tier.input, tier.output, tier.cacheRead, tier.cacheWrite5m, tier.cacheWrite1h].some(value => !Number.isFinite(value) || value < 0)) throw new TypeError('Invalid model price');
  const parts = { inputUsd: input.inputTokens * tier.input / 1_000_000,
    outputUsd: input.outputTokens * tier.output / 1_000_000,
    cacheReadUsd: input.cacheReadTokens * tier.cacheRead / 1_000_000 };
  const cache5m = input.cacheWriteTokens * tier.cacheWrite5m / 1_000_000;
  const cache1h = input.cacheWriteTokens * tier.cacheWrite1h / 1_000_000;
  const fixed = parts.inputUsd + parts.outputUsd + parts.cacheReadUsd;
  const costs = input.cacheWriteTtl === '5m' ? [cache5m] : input.cacheWriteTtl === '1h' ? [cache1h] : [cache5m, cache1h];
  return { basis: 'api-reference' as const, source: 'estimated' as const, currency: 'USD' as const,
    usdMin: fixed + Math.min(...costs), usdMax: fixed + Math.max(...costs),
    parts, cacheWriteUsdMin: Math.min(...costs), cacheWriteUsdMax: Math.max(...costs),
    ratesPerMillion: tier, priceSource: card.source, pricesCheckedAt: catalog.checkedAt,
    cacheWriteTtl: input.cacheWriteTtl ?? 'unknown-range', actualSubscriptionCharge: null, subscriptionQuotaDelta: null };
}
