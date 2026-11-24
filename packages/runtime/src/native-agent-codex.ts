import { normalizeCodexTokenUsage } from "./codex-usage.js";
import {
  runStreamingProcess,
  type StreamEvent,
} from "./native-agent-process.js";
import {
  maxAnswerLength,
  newSessionState,
  type CodexPriceTier,
  type NativeProviderSession,
  type SessionContext,
  type SessionState,
} from "./native-agent-session.js";

const longContextThreshold = 100000;

function codexArguments(context: SessionContext): string[] {
  return [
    "--no-daemon",
    "-a",
    "never",
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    context.writeFiles ? "workspace-write" : "read-only",
    "--json",
    "-C",
    context.cwd,
    "-m",
    context.model.model,
    "-c",
    'model_reasoning_effort="' + (context.model.effort ?? "medium") + '"',
    "-c",
    "features.multi_agent=false",
    "-c",
    'web_search="disabled"',
    "-c",
    "sandbox_workspace_write.network_access=false",
    "-",
  ];
}

interface CodexCounters {
  uncached: number | null;
  total: number | null;
  output: number | null;
  read: number | null;
  write: number | null;
}

function tierCostRange(tier: CodexPriceTier, counters: CodexCounters) {
  const { uncached, output, read, write } = counters as {
    [key in keyof CodexCounters]: number;
  };
  return {
    min:
      (uncached * tier.input +
        output * tier.output +
        read * tier.cacheRead +
        write * Math.min(tier.cacheWrite30m, tier.cacheWrite12h)) /
      1e6,
    max:
      (uncached * tier.input +
        output * tier.output +
        read * tier.cacheRead +
        write * Math.max(tier.cacheWrite30m, tier.cacheWrite12h)) /
      1e6,
  };
}

function referenceCost(context: SessionContext, counters: CodexCounters) {
  const prices = context.codexPrices;
  const card = prices?.cards.find((card) => card.model === context.model.model);
  const { uncached, total, output, read, write } = counters;
  if (
    !card ||
    !prices ||
    Date.parse(prices.expiresAt) <= Date.now() ||
    total === null ||
    (total > longContextThreshold && !card.longContext) ||
    uncached === null ||
    output === null ||
    write === null ||
    read === null
  )
    return null;
  const tiers =
    total > longContextThreshold ? [card, card.longContext!] : [card];
  const values = tiers.map((tier) => tierCostRange(tier, counters));
  if (
    !values.every(
      (value) =>
        Number.isFinite(value.min) &&
        Number.isFinite(value.max) &&
        value.min >= 0 &&
        value.max >= value.min,
    )
  )
    return null;
  return {
    min: Math.min(...values.map((v) => v.min)),
    max: Math.max(...values.map((v) => v.max)),
    basis: "official-reference",
  };
}

function observeTurnCompleted(
  context: SessionContext,
  state: SessionState,
  event: StreamEvent,
) {
  const normalized = normalizeCodexTokenUsage(event.usage);
  const counters: CodexCounters = {
    uncached: normalized.input,
    total: normalized.inputIncludingCache,
    output: normalized.output,
    read: normalized.cacheRead,
    write: normalized.cacheWrite,
  };
  const cost = referenceCost(context, counters);
  state.success = true;
  context.record(
    "final",
    context.model.model,
    {
      inputTokens: counters.uncached,
      inputIncludingCacheTokens: counters.total,
      outputTokens: counters.output,
      cacheReadTokens: counters.read,
      cacheWriteTokens: counters.write,
      inputSemantics: "uncached",
      modelIdentity: "requested-only",
    },
    cost,
  );
}

export const runCodexSession: NativeProviderSession = async (context) => {
  const state = newSessionState();
  await runStreamingProcess(
    context,
    { args: codexArguments(context), env: context.environment },
    state,
    (event) => {
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message"
      ) {
        const text = String(event.item.text ?? "");
        state.answer = text.slice(0, maxAnswerLength);
        state.answerTruncated = text.length > maxAnswerLength;
      }
      if (event.type === "turn.completed")
        observeTurnCompleted(context, state, event);
    },
  );
  return { kind: "completed", ...state };
};
