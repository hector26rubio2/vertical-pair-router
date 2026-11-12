const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const validModel = value => typeof value === 'string' && /^[\w./:\[\]-]{1,100}$/u.test(value);
function counters(value, camel = false) {
  if (!value || typeof value !== 'object') return null;
  const result = camel ? {
    inputTokens: count(value.inputTokens), outputTokens: count(value.outputTokens),
    cacheReadTokens: count(value.cacheReadInputTokens), cacheWriteTokens: count(value.cacheCreationInputTokens)
  } : {
    inputTokens: count(value.input_tokens), outputTokens: count(value.output_tokens),
    cacheReadTokens: count(value.cache_read_input_tokens ?? 0), cacheWriteTokens: count(value.cache_creation_input_tokens ?? 0)
  };
  return Object.values(result).some(value => value === null) ? null : result;
}
const sum = rows => rows.reduce((total, row) => {
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) total[key] += row[key];
  return total;
}, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/** Stream metadata only. Never retain prompts, code, tool output or thinking. */
export class NativeSessionMeter {
  requests = new Map();
  tools = new Map();
  final = null;
  initializedAtMs = null;
  firstAssistantAtMs = null;
  resultAtMs = null;
  observe(event, atMs) {
    if (event.type === 'system' && event.subtype === 'init') this.initializedAtMs ??= atMs;
    const message = event.type === 'assistant' ? event.message : null;
    if (message) {
      this.firstAssistantAtMs ??= atMs;
      const usage = counters(message.usage);
      if (typeof message.id === 'string' && validModel(message.model) && usage) {
        const key = `${event.parent_tool_use_id ?? 'main'}:${message.id}`;
        const previous = this.requests.get(key);
        const merged = Object.fromEntries(Object.entries(usage).map(([name, value]) => [name, Math.max(value, previous?.[name] ?? 0)]));
        this.requests.set(key, { id: message.id, model: message.model, parentToolUseId: event.parent_tool_use_id ?? null, atMs, ...merged,
          cacheWrite5mTokens: count(message.usage?.cache_creation?.ephemeral_5m_input_tokens) ?? previous?.cacheWrite5mTokens ?? null,
          cacheWrite1hTokens: count(message.usage?.cache_creation?.ephemeral_1h_input_tokens) ?? previous?.cacheWrite1hTokens ?? null });
      }
      for (const part of message.content ?? []) if (part.type === 'tool_use' && typeof part.id === 'string' && !this.tools.has(part.id)) {
        this.tools.set(part.id, { id: part.id, name: part.name, parentToolUseId: event.parent_tool_use_id ?? null,
          startMs: atMs, endMs: null, failed: null,
          targetAgent: part.name === 'Agent' ? part.input?.subagent_type ?? null : null,
          requestedModel: part.name === 'Agent' ? part.input?.model ?? null : null });
      }
    }
    if (event.type === 'user') for (const part of event.message?.content ?? []) if (part.type === 'tool_result') {
      const tool = this.tools.get(part.tool_use_id);
      if (tool) { tool.endMs = atMs; tool.failed = part.is_error === true; }
    }
    if (event.type === 'result') {
      this.resultAtMs = atMs;
      // modelUsage includes the whole tree; result.usage is main-loop only.
      const models = Object.entries(event.modelUsage ?? {}).flatMap(([model, value]) => {
        const usage = counters(value, true);
        return usage && validModel(model) ? [{ model, ...usage, nativeEstimatedUsd: duration(value.costUSD) }] : [];
      });
      this.final = { models, topLevelOnly: counters(event.usage), success: event.is_error !== true && event.subtype === 'success',
        subtype: event.subtype, providerWallMs: duration(event.duration_ms), providerApiMs: duration(event.duration_api_ms),
        permissionDenials: Array.isArray(event.permission_denials) ? event.permission_denials.map(value => value.tool_name) : [] };
    }
  }
  snapshot(wallMs) {
    const requests = [...this.requests.values()];
    const tools = [...this.tools.values()];
    const delegates = tools.filter(tool => tool.name === 'Agent' && tool.parentToolUseId === null);
    let models = this.final?.models ?? [];
    let accounting = models.length ? 'whole-tree-provider-reported' : 'observed-lower-bound';
    if (!models.length) {
      models = [...new Set(requests.map(row => row.model))].map(model => ({ model, ...sum(requests.filter(row => row.model === model)) }));
      const topModels = [...new Set(requests.filter(row => !row.parentToolUseId).map(row => row.model))];
      if (this.final?.topLevelOnly && delegates.length === 0 && topModels.length === 1) {
        models = [{ model: topModels[0], ...this.final.topLevelOnly }];
        accounting = 'main-only-provider-reported-no-delegation';
      }
    }
    const totals = sum(models);
    const childIntervals = delegates.filter(row => row.endMs !== null).map(row => [row.startMs, row.endMs]).sort((a, b) => a[0] - b[0]);
    let childSpanMs = 0, lastEnd = 0;
    for (const [start, end] of childIntervals) { childSpanMs += Math.max(0, end - Math.max(start, lastEnd)); lastEnd = Math.max(lastEnd, end); }
    return { accounting, completeAccounting: accounting !== 'observed-lower-bound', terminalReceipt: this.final,
      models: models.map(row => ({ ...row, totalTokens: row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens })),
      totals: { ...totals, totalTokens: Object.values(totals).reduce((a, b) => a + b, 0) }, requests, tools,
      timings: { wallMs, initializedAtMs: this.initializedAtMs, firstAssistantAtMs: this.firstAssistantAtMs,
        resultAtMs: this.resultAtMs, shutdownMs: this.resultAtMs === null ? null : Math.max(0, wallMs - this.resultAtMs),
        childForegroundSpanMs: childIntervals.length ? childSpanMs : null,
        mainOutsideChildSpanMs: childIntervals.length ? Math.max(0, (this.resultAtMs ?? wallMs) - childSpanMs) : null,
        permissionWaitMs: 0, permissionMode: 'unattended-auto-deny',
        note: 'Wall spans are observed. API time can include service/network waits and is not pure inference time. No sum of overlapping API/wall times.' } };
  }
}
