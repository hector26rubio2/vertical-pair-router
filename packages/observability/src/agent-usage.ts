export interface AgentUsage {
  readonly provider: 'codex' | 'claude';
  readonly agentId: string;
  readonly parentAgentId: string | null;
  readonly model: string | null;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly outputTokens: number;
  readonly source: 'provider_reported';
  readonly scope: 'turn' | 'message' | 'session';
}

export function compareAgentTokens(
  baseline: { storyId: string; commit: string; checksPassed: boolean; usage: AgentUsage },
  optimized: { storyId: string; commit: string; checksPassed: boolean; usage: AgentUsage }
): { baselineTokens: number; optimizedTokens: number; savedTokens: number; savedPercent: number | null } {
  if (baseline.storyId !== optimized.storyId || baseline.commit !== optimized.commit) throw new Error('Comparison requires the same Story and base commit');
  if (!baseline.checksPassed || !optimized.checksPassed) throw new Error('Both arms must pass equivalent acceptance checks');
  if (baseline.usage.provider !== optimized.usage.provider || baseline.usage.model !== optimized.usage.model || baseline.usage.model === null) throw new Error('Comparison requires the same observed model and provider');
  if (baseline.usage.scope !== optimized.usage.scope) throw new Error('Comparison requires equivalent usage scope');
  // Codex includes cache reads in input; Claude reports them separately.
  const total = (usage: AgentUsage): number => usage.inputTokens + usage.outputTokens +
    (usage.provider === 'claude' ? usage.cachedInputTokens + usage.cacheWriteInputTokens : 0);
  const baselineTokens = total(baseline.usage), optimizedTokens = total(optimized.usage);
  const savedTokens = baselineTokens - optimizedTokens;
  return { baselineTokens, optimizedTokens, savedTokens, savedPercent: baselineTokens === 0 ? null : savedTokens / baselineTokens * 100 };
}

// Parse only observed counters; never retain text, prompts, thinking or tool output.
export function parseAgentUsage(provider: 'codex' | 'claude', value: unknown): AgentUsage | null {
  if (!record(value)) return null;
  const codex = provider === 'codex' && value.type === 'turn.completed';
  const message = provider === 'claude' && value.type === 'assistant' && record(value.message) ? value.message : null;
  const session = provider === 'claude' && value.type === 'result';
  const usage = codex || session ? value.usage : message?.usage;
  if (!record(usage)) return null;
  const input = count(usage.input_tokens), output = count(usage.output_tokens);
  if (input === null || output === null) return null;
  const parent = typeof value.parent_tool_use_id === 'string' ? value.parent_tool_use_id : null;
  return {
    provider,
    // A parent tool call is correlation evidence, not a claimed child agent name.
    agentId: typeof value.agent_id === 'string' ? value.agent_id : parent ? `tool:${parent}` : 'main',
    parentAgentId: parent ? 'main' : null,
    model: typeof message?.model === 'string' ? message.model : null,
    inputTokens: input,
    cachedInputTokens: count(codex ? usage.cached_input_tokens : usage.cache_read_input_tokens) ?? 0,
    cacheWriteInputTokens: count(codex ? usage.cache_write_input_tokens : usage.cache_creation_input_tokens) ?? 0,
    outputTokens: output,
    source: 'provider_reported',
    scope: codex ? 'turn' : session ? 'session' : 'message'
  };
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
