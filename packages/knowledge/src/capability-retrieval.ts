export interface CapabilityCard {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly tags: readonly string[];
  readonly efforts: readonly string[];
  readonly claims: string;
  readonly sources: readonly string[];
  readonly expiresAt: string;
}
export interface EmpiricalCapability {
  readonly evidenceId: string;
  readonly cardId: string;
  readonly taskTags: readonly string[];
  readonly modelConfirmed: boolean;
  readonly qualityPassed: boolean;
  readonly totalTokens: number;
  readonly requestedEffort?: string;
}

/** Local lexical retrieval with source, expiry and empirical evidence. No embeddings or LLM. */
export function retrieveCapabilities(input: {
  readonly queryTags: readonly string[];
  readonly allowedProviders: readonly string[];
  readonly verifiedCardIds: readonly string[];
  readonly cards: readonly CapabilityCard[];
  readonly observations: readonly EmpiricalCapability[];
  readonly now: string;
  readonly limit?: number;
}) {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new TypeError('Invalid retrieval timestamp');
  const query = new Set(input.queryTags.flatMap(terms));
  if (query.size === 0) return [];
  const allTerms = input.cards.map(card => new Set(card.tags.flatMap(terms)));
  const scored = input.cards.flatMap((card, index) => {
    const expiry = Date.parse(card.expiresAt);
    if (!Number.isFinite(expiry) || expiry < now || !input.allowedProviders.includes(card.provider) ||
        card.sources.length === 0 || !card.sources.every(source => /^https:\/\//u.test(source))) return [];
    const matched = [...query].filter(term => allTerms[index]!.has(term));
    if (matched.length === 0) return [];
    // IDF rewards more specific matches instead of broad marketing descriptions.
    const score = matched.reduce((total, term) => total + Math.log(1 + input.cards.length / (1 + allTerms.filter(set => set.has(term)).length)), 0);
    const seen = new Set<string>();
    const requiredComplexities = [...query].filter(term => ['simple', 'normal', 'complex'].includes(term));
    const observed = input.observations.filter(row => {
      if (seen.has(row.evidenceId)) return false;
      seen.add(row.evidenceId);
      const tags = row.taskTags.flatMap(terms);
      return row.cardId === card.id && row.modelConfirmed && Number.isSafeInteger(row.totalTokens) && row.totalTokens >= 0 &&
        (requiredComplexities.length === 0 || requiredComplexities.some(complexity => tags.includes(complexity))) && tags.some(term => query.has(term));
    });
    const effortOutcomes = [...new Set(observed.map(row => row.requestedEffort ?? 'unspecified'))].map(effort => {
      const rows = observed.filter(row => (row.requestedEffort ?? 'unspecified') === effort);
      const passed = rows.filter(row => row.qualityPassed).length;
      return { requestedEffort: effort, sampleSize: rows.length, passed, failed: rows.length - passed,
        totalTokens: rows.reduce((total, row) => total + row.totalTokens, 0),
        tokensPerAcceptedResult: passed ? rows.reduce((total, row) => total + row.totalTokens, 0) / passed : null,
        smallSample: rows.length < 5, effortVerification: 'requested-only' };
    });
    return [{ card, score, matchedTerms: matched,
      accountVerified: input.verifiedCardIds.includes(card.id),
      sampleSize: observed.length, qualityRate: observed.length ? observed.filter(row => row.qualityPassed).length / observed.length : null,
      evidenceIds: observed.map(row => row.evidenceId),
      effortOutcomes,
      documentedCapabilityOnly: observed.length === 0,
      decisionInferenceTokens: 0 }];
  });
  const limit = input.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new TypeError('Retrieval limit must be 1..20');
  return scored.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id)).slice(0, limit);
}
function terms(value: string): readonly string[] {
  const aliases: Readonly<Record<string, string>> = {
    codigo: 'coding', código: 'coding', programacion: 'coding', programación: 'coding',
    depuracion: 'debugging', depuración: 'debugging', errores: 'debugging',
    sencilla: 'simple', sencillo: 'simple', simples: 'simple',
    compleja: 'complex', complejo: 'complex', complejas: 'complex',
    inventario: 'inventory', extraccion: 'extraction', extracción: 'extraction',
    clasificacion: 'classification', clasificación: 'classification', repetitiva: 'repeatable'
  };
  return value.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(term => aliases[term] ?? term);
}
