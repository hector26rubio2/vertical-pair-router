import { spawn } from "node:child_process";
import { resolveCodexExecutable, codexLaunchEnvironment } from "./codex-launch.js";
import { accountKey, recordAccountObservation } from "./usage-ledger.mjs";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};

/** Allowlist metadata only. No identities, tokens, reset-credit IDs or raw responses. */
export function normalizeCodexLimits(value: unknown, observedAt = new Date().toISOString()) {
  const response = object(value),
    indexed = object(response.rateLimitsByLimitId);
  const buckets = Object.keys(indexed).length ? Object.values(indexed) : [response.rateLimits];
  return buckets
    .filter((bucket) => bucket && typeof bucket === "object")
    .slice(0, 30)
    .map((raw) => {
      const bucket = object(raw),
        credits = object(bucket.credits);
      const window = (raw: unknown) => {
        const item = object(raw);
        if (
          typeof item.usedPercent !== "number" ||
          !Number.isFinite(item.usedPercent) ||
          item.usedPercent < 0 ||
          item.usedPercent > 100 ||
          typeof item.resetsAt !== "number" ||
          !Number.isFinite(item.resetsAt) ||
          !Number.isFinite(new Date(item.resetsAt * 1000).getTime())
        )
          return null;
        return {
          usedPercent: item.usedPercent,
          remainingPercent: 100 - item.usedPercent,
          resetAt: new Date(item.resetsAt * 1000).toISOString(),
          windowDurationMins:
            typeof item.windowDurationMins === "number" &&
            Number.isFinite(item.windowDurationMins) &&
            item.windowDurationMins > 0
              ? item.windowDurationMins
              : null,
        };
      };
      const balance =
        typeof credits.balance === "string" &&
        /^\d+(\.\d+)?$/u.test(credits.balance) &&
        credits.balance.length < 50
          ? credits.balance
          : typeof credits.balance === "number" &&
              Number.isFinite(credits.balance) &&
              credits.balance >= 0
            ? credits.balance
            : null;
      const primary = window(bucket.primary),
        secondary = window(bucket.secondary);
      const fresh = [primary, secondary]
        .filter((item) => item !== null)
        .every((item) => Date.parse(item.resetAt) > Date.parse(observedAt));
      // A positive credit balance does not prove this workspace permits spending it.
      const reached =
        typeof bucket.rateLimitReachedType === "string" ||
        [primary, secondary].some((item) => item && item.remainingPercent <= 0);
      return {
        limitId:
          typeof bucket.limitId === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(bucket.limitId)
            ? bucket.limitId
            : null,
        primary,
        secondary,
        credits: {
          balance,
          hasCredits: typeof credits.hasCredits === "boolean" ? credits.hasCredits : null,
          unlimited: typeof credits.unlimited === "boolean" ? credits.unlimited : null,
        },
        delegationCapacity:
          !fresh || (!primary && !secondary && !reached)
            ? "unknown"
            : reached
              ? "limit-reached"
              : "available-at-observation",
        observedAt,
      };
    });
}

/** Only initialize + model/list + account/rateLimits/read. Never starts a thread/turn. */
export async function inspectCodexAccount() {
  const executable = await resolveCodexExecutable();
  if (!executable)
    return {
      provider: "codex",
      status: "unavailable",
      reason: "CLI not found",
      inferenceTokens: 0,
      models: [],
      buckets: [],
    };
  const env = await codexLaunchEnvironment(executable, process.env);
  for (const key of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CODEX_APP_TOOLS_PIPE_PATH",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "CODEX_TOOL_CALL_ID",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  ])
    delete env[key];
  return new Promise<{
    provider: string;
    status: string;
    reason: string;
    inferenceTokens: number;
    observedAt: string;
    accountKey: string | null;
    models: { model: string | null; supportedEfforts: unknown[] }[];
    buckets: ReturnType<typeof normalizeCodexLimits>;
  }>((resolve) => {
    const child = spawn(executable, ["--no-daemon", "app-server", "--stdio"], {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let pending = "",
      bytes = 0,
      finished = false,
      models: { model: string | null; supportedEfforts: unknown[] }[] = [],
      buckets: ReturnType<typeof normalizeCodexLimits> = [],
      responses = 0,
      failures = 0;
    let identity: string | null = null;
    const done = (reason: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      const finish = async (key: string | null) => {
        if (key)
          await recordAccountObservation({
            provider: "codex",
            accountKey: key,
            windows: buckets.flatMap((bucket) =>
              [
                bucket.primary
                  ? {
                      kind: (bucket.limitId ?? "codex") + "_primary",
                      percentUsed: bucket.primary.usedPercent,
                      resetsAt: bucket.primary.resetAt,
                    }
                  : null,
                bucket.secondary
                  ? {
                      kind: (bucket.limitId ?? "codex") + "_secondary",
                      percentUsed: bucket.secondary.usedPercent,
                      resetsAt: bucket.secondary.resetAt,
                    }
                  : null,
              ].filter(Boolean),
            ),
          }).catch(() => {});
        resolve({
          provider: "codex",
          status: failures === 0 && responses === 3 ? "observed" : "unavailable",
          reason,
          inferenceTokens: 0,
          observedAt: new Date().toISOString(),
          accountKey: key,
          models,
          buckets,
        });
      };
      void accountKey("codex", identity).then(finish, () => finish(null));
    };
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
    const timer = setTimeout(() => done("Native metadata request timed out"), 15000);
    child.stdin.on("error", () => done("Native connection closed"));
    child.once("error", () => done("Unable to start native CLI"));
    child.once("close", () => done("Native server closed"));
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) return done("Metadata output limit exceeded");
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        let event: ObjectValue;
        try {
          event = object(JSON.parse(line));
        } catch {
          continue;
        }
        if (event.id === 1) {
          if (event.error) return done("Native initialization refused");
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "model/list", params: { limit: 100, includeHidden: false } });
          send({ id: 3, method: "account/rateLimits/read" });
          send({ id: 4, method: "account/read", params: { refreshToken: false } });
        }
        if (event.id === 2 || event.id === 3 || event.id === 4) {
          responses++;
          if (event.error && event.id !== 4) failures++;
          if (event.id === 2)
            models = (
              Array.isArray(object(event.result).data)
                ? (object(event.result).data as unknown[])
                : []
            )
              .slice(0, 100)
              .map((raw) => {
                const item = object(raw);
                return {
                  model: typeof item.model === "string" ? item.model.slice(0, 100) : null,
                  supportedEfforts: (Array.isArray(item.supportedReasoningEfforts)
                    ? item.supportedReasoningEfforts
                    : []
                  )
                    .map((raw) => object(raw).reasoningEffort)
                    .filter((value) => typeof value === "string"),
                };
              });
          else if (event.id === 3) buckets = normalizeCodexLimits(event.result);
          else {
            const account = object(object(event.result).account);
            if (account.type === "chatgpt" && typeof account.email === "string")
              identity = account.email;
          }
          if (responses === 3)
            done(
              failures
                ? "Some native metadata endpoints are unavailable"
                : "Native account metadata; no model inference",
            );
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "vpr_metadata", version: "0.0.0" },
        capabilities: { experimentalApi: false },
      },
    });
  });
}
