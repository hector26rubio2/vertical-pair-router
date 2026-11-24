import { NativeSessionMeter } from "@vpr/observability";
import { prepareGuardedClaude } from "./claude-guard-launch.mjs";
import {
  runStreamingProcess,
  type ProcessLaunch,
  type StreamEvent,
} from "./native-agent-process.js";
import {
  integer,
  maxAnswerLength,
  newSessionState,
  type NativeProviderSession,
  type SessionContext,
  type SessionState,
} from "./native-agent-session.js";

function claudeArguments(context: SessionContext): string[] {
  const writePatterns = context.allowedPaths
    .flatMap((path) =>
      path === "."
        ? ["./**"]
        : [
            "./" + path.replace(/\/$/u, ""),
            "./" + path.replace(/\/$/u, "") + "/**",
          ],
    )
    .flatMap((path) => ["Write(" + path + ")", "Edit(" + path + ")"]);
  return [
    "--print",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--model",
    context.model.model,
    "--effort",
    context.model.effort ?? "medium",
    "--max-turns",
    String(context.maxTurns ?? 20),
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode",
    "default",
    "--permission-prompts",
    "none",
    "--tools",
    context.writeFiles ? "Read,Write,Edit" : "Read",
    "--allowedTools",
    context.writeFiles ? "Read(./**)," + writePatterns.join(",") : "Read(./**)",
  ];
}

function classifyProviderError(text: string): string {
  return /hit your.*limit/iu.test(text)
    ? "provider-limit"
    : /VPR:.*(?:context|count)/iu.test(text)
      ? "context-guard-stopped"
      : "native-provider-error";
}

function recordFinalUsage(context: SessionContext, event: StreamEvent) {
  for (const [model, value] of Object.entries(event.modelUsage ?? {}) as [
    string,
    Record<string, unknown>,
  ][])
    context.record(
      "final:" + model,
      model,
      {
        inputTokens: integer(value.inputTokens),
        outputTokens: integer(value.outputTokens),
        cacheReadTokens: integer(value.cacheReadInputTokens),
        cacheWriteTokens: integer(value.cacheCreationInputTokens),
        inputSemantics: "uncached",
      },
      typeof value.costUSD === "number"
        ? { min: value.costUSD, max: value.costUSD, basis: "provider-reported" }
        : null,
    );
}

function observeResult(
  context: SessionContext,
  state: SessionState,
  event: StreamEvent,
) {
  const text = String(event.result ?? "");
  state.answer = text.slice(0, maxAnswerLength);
  state.answerTruncated = text.length > maxAnswerLength;
  state.success = event.is_error !== true && event.subtype === "success";
  if (event.is_error) state.failure = classifyProviderError(text);
  if (state.failure === "context-guard-stopped")
    state.diagnostic = text.match(
      /VPR: (?:provider could not count next Haiku request|complete thread context unavailable or ambiguous|next Haiku request reaches|context guard failed)[^\r\n]{0,300}/u,
    )?.[0];
  recordFinalUsage(context, event);
}

async function guardedLaunch(
  context: SessionContext,
): Promise<ProcessLaunch | null> {
  try {
    const guarded = await prepareGuardedClaude(
      context.executable,
      claudeArguments(context),
    );
    return {
      args: guarded.args,
      env: { ...guarded.env, VPR_CAPTURE_DISABLED: "1" },
    };
  } catch {
    return null;
  }
}

export const runClaudeSession: NativeProviderSession = async (context) => {
  const meter = new NativeSessionMeter();
  const launch = await guardedLaunch(context);
  if (!launch) return { kind: "refused", failure: "context-guard-unverified" };
  const state = newSessionState();
  await runStreamingProcess(context, launch, state, (event) => {
    meter.observe(event, context.elapsedMs());
    if (context.onSnapshot)
      context.trackWrite(
        context
          .onSnapshot(meter.snapshot(context.elapsedMs()))
          .catch(() => context.markStorageFailed()),
      );
    if (event.type === "result") observeResult(context, state, event);
  });
  return {
    kind: "completed",
    ...state,
    snapshot: (wallMs) => meter.snapshot(wallMs),
  };
};
