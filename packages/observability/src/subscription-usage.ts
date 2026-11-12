export interface SubscriptionSnapshot {
  readonly bucketId: string;
  readonly planId: string;
  readonly resetAt: string;
  readonly observedAt: string;
  readonly usedPercent: number;
  readonly source: 'provider_reported' | 'user_reported';
}

/** No conversion from API dollars or tokens into subscription allowance. */
export function measureSubscriptionQuota(input: {
  readonly before: SubscriptionSnapshot;
  readonly after: SubscriptionSnapshot;
  readonly isolated: boolean;
}) {
  const { before, after } = input;
  const unknown = (reason: string) => ({ status: 'unavailable' as const, usedPercentagePoints: null, reason, inferenceTokens: 0, marginalChargeUsd: null });
  if (!input.isolated) return unknown('Concurrent account activity prevents attribution to this execution');
  if (![before.bucketId, after.bucketId, before.planId, after.planId].every(value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,100}$/u.test(value)) ||
    ![before.source, after.source].every(value => ['provider_reported', 'user_reported'].includes(value))) return unknown('Invalid anonymous bucket, plan or source');
  if (!before.bucketId || !before.planId || before.bucketId !== after.bucketId || before.planId !== after.planId || before.resetAt !== after.resetAt) return unknown('Different account bucket, plan or reset window');
  const start = Date.parse(before.observedAt), end = Date.parse(after.observedAt), reset = Date.parse(before.resetAt);
  if (![start, end, reset].every(Number.isFinite) || start >= end || end >= reset) return unknown('Invalid timestamps or a quota reset during execution');
  if (![before.usedPercent, after.usedPercent].every(value => Number.isFinite(value) && value >= 0 && value <= 100) || after.usedPercent < before.usedPercent) return unknown('Invalid or decreasing quota counters');
  const delta = after.usedPercent - before.usedPercent;
  if (delta === 0) return unknown('No visible change; display rounding does not prove zero usage');
  return { status: 'observed' as const, usedPercentagePoints: delta, bucketId: before.bucketId,
    planId: before.planId, resetAt: before.resetAt,
    source: before.source === 'provider_reported' && after.source === 'provider_reported' ? 'provider_reported' : 'user_reported',
    inferenceTokens: 0, marginalChargeUsd: null, reason: 'Observed display delta for an isolated run; not a token conversion or a subscription invoice' };
}
