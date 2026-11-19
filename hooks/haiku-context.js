// No inference and no approximate token counter: historical usage is not a
// measurement of the next request (new tool results can change it abruptly).
export const HAIKU_COMPACT_AT = 90000;
export const HAIKU_PROMPT_CEILING = 100000;
export const HAIKU_GUARD_REASON = 'VPR: Haiku pausado para proteger la tarifa base. No se pudo habilitar la verificación protegida de la próxima petición; no se usará el contador anterior. Umbral preventivo: 90.000; techo de tarifa: 100.000 tokens.';

export function isHaiku(model) {
  return typeof model === 'string' && /(?:^|[^a-z])haiku(?:[^a-z]|$)/iu.test(model);
}

export function haikuContextDecision(model, measurement) {
  if (!isHaiku(model)) return { action: 'continue', reason: 'other-model' };
  if (measurement?.source !== 'exact-next-request' || !Number.isSafeInteger(measurement.tokens) || measurement.tokens < 0)
    return { action: 'block', reason: 'next-request-size-unverified' };
  if (measurement.tokens > HAIKU_PROMPT_CEILING) return { action: 'block', reason: 'base-tier-ceiling-exceeded' };
  if (measurement.tokens >= HAIKU_COMPACT_AT) return { action: 'compact', reason: 'compaction-required-before-request' };
  return { action: 'continue', reason: 'base-tier-measured' };
}
