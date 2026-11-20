const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null;
export function normalizeCodexTokenUsage(value: unknown) {
  const u = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const inputIncludingCache = count(u.input_tokens), cacheRead = count(u.cached_input_tokens),
    cacheWrite = count(u.cache_write_input_tokens), output = count(u.output_tokens);
  const input = inputIncludingCache !== null && cacheRead !== null && cacheWrite !== null
    && inputIncludingCache >= cacheRead + cacheWrite ? inputIncludingCache - cacheRead - cacheWrite : null;
  return {input, inputIncludingCache, output, cacheRead, cacheWrite,
    total: inputIncludingCache !== null && output !== null ? inputIncludingCache + output : null};
}
