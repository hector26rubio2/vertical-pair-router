import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { CopilotClient, RuntimeConnection } from "@microsoft/copilot-sdk";
import type { AgentModel } from "@vpr/core";
import {NativeSessionMeter, type NativeSessionSnapshot} from '@vpr/observability';
import {normalizeCodexTokenUsage} from './codex-usage.js';
import { resolveExecutable } from "./resolve-executable.js";
import { subscriptionEnvironment, resolveProviderExecutable } from "./native-providers.js";
import { recordUsage } from "./usage-ledger.mjs";
import { prepareGuardedClaude } from "./claude-guard-launch.mjs";
import { codexLaunchEnvironment, probeCodexWindowsExecution } from "./codex-launch.js";
type CodexPriceTier = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite30m: number;
  cacheWrite12h: number;
};
export interface NativeAgentRequest {
  model: AgentModel;
  cwd: string;
  prompt: string;
  sessionId: string;
  parentSessionId?: string;
  accountKey?: string | null;
  phase: "plan" | "technical-plan" | "implement" | "repair" | "review" | "inventory";
  writeFiles: boolean;
  allowedPaths: readonly string[];
  allowShell: boolean;
  timeoutMs: number;
  maxTurns?: number;
  onSnapshot?: (receipt: NativeSessionSnapshot) => Promise<void>;
  signal?: AbortSignal;
  task?: string;
  codexPrices?: {
    expiresAt: string;
    cards: readonly (CodexPriceTier & { model: string; longContext?: CodexPriceTier })[];
  };
}
export interface NativeAgentResult {
  receipt?: NativeSessionSnapshot;
  success: boolean;
  answer: string;
  answerTruncated?: boolean;
  model: string;
  usage: Record<string, unknown>[];
  wallMs: number;
  failure: string | null;
  diagnostic?: string;
}
const integer = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
export async function allowedProjectPath(root: string, path: string, allowed: readonly string[]) {
  const canonical = await realpath(root);
  let candidate = resolve(root, path),
    missing: string[] = [];
  for (;;)
    try {
      candidate = resolve(await realpath(candidate), ...missing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const parent = dirname(candidate);
      if (parent === candidate) return false;
      missing.unshift(relative(parent, candidate));
      candidate = parent;
    }
  const local = relative(canonical, candidate).replaceAll("\\", "/");
  if (isAbsolute(local) || local === ".." || local.startsWith("../")) return false;
  return allowed.some(
    (prefix) =>
      prefix === "." || local === prefix || local.startsWith(prefix.replace(/\/$/u, "") + "/"),
  );
}
export async function runNativeAgent(input: NativeAgentRequest): Promise<NativeAgentResult> {
  const entered = performance.now();
  if (input.signal?.aborted)
    return {
      success: false,
      answer: "",
      model: input.model.model,
      usage: [],
      wallMs: 0,
      failure: "cancelled",
    };
  if (input.model.provider !== "claude" && /haiku/iu.test(input.model.model))
    return {
      success: false,
      answer: "",
      model: input.model.model,
      usage: [],
      wallMs: 0,
      failure: "context-guard-unverified",
    };
  if (
    !Number.isInteger(input.timeoutMs) ||
    (input.maxTurns !== undefined && (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 100)) ||
    input.timeoutMs < 1000 ||
    input.timeoutMs > 300000 ||
    input.prompt.length > 60000 ||
    !input.allowedPaths.length ||
    input.allowedPaths.some(
      (path) => isAbsolute(path) || path.split(/[\\/]/u).includes("..") || path.includes("\0"),
    )
  )
    throw Error("Invalid bounded native execution");
  const executable = await resolveProviderExecutable(input.model.provider);
  if (!executable) throw Error("Native CLI unavailable");
  if (input.model.provider === "codex" && input.writeFiles && !input.allowShell)
    throw Error(
      "Codex implementation requires project shell authorization; no permission override",
    );
  const codexEnv =
    input.model.provider === "codex"
      ? await codexLaunchEnvironment(executable, subscriptionEnvironment())
      : null;
  if (codexEnv && process.platform === "win32") {
    const probe = await probeCodexWindowsExecution(executable, input.cwd, codexEnv, input.signal);
    if (!probe.ready)
      return {
        success: false,
        answer: "",
        model: input.model.model,
        usage: [],
        wallMs: Math.round(performance.now() - entered),
        failure: input.signal?.aborted ? "cancelled" : "native-execution-unavailable",
        ...(probe.diagnostic ? { diagnostic: probe.diagnostic } : {}),
      };
  }
  if (input.signal?.aborted)
    return {
      success: false,
      answer: "",
      model: input.model.model,
      usage: [],
      wallMs: Math.round(performance.now() - entered),
      failure: "cancelled",
    };
  const started = entered,
    usage: Record<string, unknown>[] = [],
    writes: Promise<unknown>[] = [],
    common = {
      provider: input.model.provider,
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      accountKey: input.accountKey,
      role: input.phase,
      task: input.task,
    };
  const meter = input.model.provider === 'claude' ? new NativeSessionMeter() : null;
  let storageFailed = false;
  const record = (
    id: string,
    model: string,
    counters: Record<string, unknown>,
    cost: Record<string, unknown> | null = null,
  ) => {
    const row = {
      ...common,
      id: input.phase + ":" + id,
      model,
      ...counters,
      cost,
      wallMs: Math.round(performance.now() - started),
      complete: true,
    };
    usage.push(row);
    writes.push(
      recordUsage(row).catch(() => {
        storageFailed = true;
      }),
    );
  };
  let answer = "",
    answerTruncated = false,
    success = false,
    failure: string | null = null,
    diagnostic: string | undefined;
  const prompt =
    "Task phase: " +
    input.phase +
    ". " +
    (input.writeFiles
      ? "Modify only authorized paths: " + input.allowedPaths.join(", ")
      : "READ ONLY. Do not modify files.") +
    " Work only inside the project. Do not access credentials, network, install tools, commit, publish or start more agents. Do not claim unexecuted tests passed.\n" +
    input.prompt +
    "";
  if (input.model.provider === "copilot") {
    const client = new CopilotClient({
      mode: "coding-agent",
      runtime: RuntimeConnection.forSpawnedStdio({
        path: executable,
        workingDirectory: input.cwd,
        env: subscriptionEnvironment(),
      }),
      github: { useLoggedInUser: true },
      observability: { logLevel: "none" },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const cancel = () => {
      failure = "cancelled";
      void client.forceStop();
    };
    input.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const work = (async () => {
        await client.start();
        const session = await client.createSession({
          model: input.model.model,
          policy: { allowedModels: [input.model.model] },
          workingDirectory: input.cwd,
          inference: { reasoningEffort: input.model.effort ?? "medium" },
          tools: {
            excludedTools: [
              "task",
              "bash",
              "powershell",
              "shell",
              "mcp:*",
              "web_fetch",
              "web_search",
            ],
          },
          permissions: {
            onRequest: async (request) => {
              if (
                ("managedApprovalRequired" in request && request.managedApprovalRequired) ||
                ("requestSandboxBypass" in request && request.requestSandboxBypass)
              )
                return {
                  kind: "reject",
                  feedback: "Corporate or host approval cannot be automated by VPR",
                };
              if (
                request.kind === "read" &&
                (await allowedProjectPath(input.cwd, request.path, ["."]))
              )
                return { kind: "approve-once" };
              if (request.kind === "write" && input.writeFiles) {
                const paths = [
                  request.fileName,
                  ...(request.fileEdits ?? []).flatMap((edit) =>
                    [edit.before?.path, edit.after?.path].filter(
                      (path): path is string => typeof path === "string",
                    ),
                  ),
                ];
                if (
                  (
                    await Promise.all(
                      paths.map((path) => allowedProjectPath(input.cwd, path, input.allowedPaths)),
                    )
                  ).every(Boolean)
                )
                  return { kind: "approve-once" };
              }
              return { kind: "reject", feedback: "Operation outside VPR phase permissions" };
            },
          },
        });
        session.on((event) => {
          if (event.type !== "assistant.usage" || event.checkpoint) return;
          const u = event.data,
            id = u.accounting?.usageId ?? u.apiCallId ?? event.id;
          if (seen.has(id)) return;
          seen.add(id);
          const nano = integer(u.copilotUsage?.totalNanoAiu),
            credits = nano === null ? null : nano / 1e9;
          record(
            id,
            u.responseModel ?? u.model,
            {
              agent: event.agentId ?? "main",
              inputTokens: integer(u.inputTokens),
              outputTokens: integer(u.outputTokens),
              cacheReadTokens: integer(u.cacheReadTokens),
              cacheWriteTokens: integer(u.cacheWriteTokens),
              inputSemantics: "provider-unspecified",
              reportedAiCredits: credits,
            },
            credits === null
              ? null
              : { min: credits * 0.01, max: credits * 0.01, basis: "provider-reported" },
          );
        });
        const response = await session.sendAndWait({ prompt }, input.timeoutMs);
        const text = response?.data.content ?? "";
        answer = text.slice(0, 12000);
        answerTruncated = text.length > 12000;
        success = !!response;
      })();
      await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            failure = "deadline";
            void client.forceStop();
            reject(Error("deadline"));
          }, input.timeoutMs);
        }),
      ]);
    } catch {
      failure ??= "Native Copilot refused or did not complete";
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
      await client.forceStop().catch(() => {});
    }
  } else {
    const claude = input.model.provider === "claude";
    const writePatterns = input.allowedPaths
      .flatMap((path) =>
        path === "."
          ? ["./**"]
          : ["./" + path.replace(/\/$/u, ""), "./" + path.replace(/\/$/u, "") + "/**"],
      )
      .flatMap((path) => ["Write(" + path + ")", "Edit(" + path + ")"]);
    const args = claude
      ? [
          "--print",
          "--disable-slash-commands",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--model",
          input.model.model,
          "--effort",
          input.model.effort ?? "medium",
          "--max-turns",
          String(input.maxTurns ?? 20),
          "--output-format",
          "stream-json",
          "--verbose",
          "--no-session-persistence",
          "--permission-mode",
          "default",
          "--permission-prompts",
          "none",
          "--tools",
          input.writeFiles ? "Read,Write,Edit" : "Read",
          "--allowedTools",
          input.writeFiles ? "Read(./**)," + writePatterns.join(",") : "Read(./**)",
        ]
      : [
          "--no-daemon",
          "-a",
          "never",
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          input.writeFiles ? "workspace-write" : "read-only",
          "--json",
          "-C",
          input.cwd,
          "-m",
          input.model.model,
          "-c",
          'model_reasoning_effort="' + (input.model.effort ?? "medium") + '"',
          "-c",
          "features.multi_agent=false",
          "-c",
          'web_search="disabled"',
          "-c",
          "sandbox_workspace_write.network_access=false",
          "-",
        ];
    let launch = { args, env: codexEnv ?? subscriptionEnvironment() };
    if (claude)
      try {
        const guarded = await prepareGuardedClaude(executable!, args);
        launch = { args: guarded.args, env: { ...guarded.env, VPR_CAPTURE_DISABLED: "1" } };
      } catch {
        return {
          success: false,
          answer: "",
          model: input.model.model,
          usage: [],
          wallMs: Math.round(performance.now() - started),
          failure: "context-guard-unverified",
        };
      }
    await new Promise<void>((done) => {
      if (input.signal?.aborted) {
        failure = "cancelled";
        done();
        return;
      }
      const child = spawn(executable!, launch.args, {
        cwd: input.cwd,
        env: launch.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "ignore"],
      });
      let pending = "",
        bytes = 0;
      const decoder = new StringDecoder("utf8");
      const stop = () => {
        if (!child.pid) return;
        if (process.platform === "win32")
          spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          }).once("error", () => child.kill());
        else
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill();
          }
      };
      const cancel = () => {
        failure = "cancelled";
        stop();
      };
      input.signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => {
        failure = "deadline";
        stop();
      }, input.timeoutMs);
      const observe = (line: string) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (meter) {
          meter.observe(event, Math.round(performance.now() - started));
          if (input.onSnapshot) writes.push(input.onSnapshot(meter.snapshot(Math.round(performance.now() - started)))
            .catch(() => {storageFailed = true;}));
        }
        if (claude && event.type === "result") {
          const text = String(event.result ?? "");
          answer = text.slice(0, 12000);
          answerTruncated = text.length > 12000;
          success = event.is_error !== true && event.subtype === "success";
          if (event.is_error)
            failure = /hit your.*limit/iu.test(text)
              ? "provider-limit"
              : /VPR:.*(?:context|count)/iu.test(text)
                ? "context-guard-stopped"
                : "native-provider-error";
          if (failure === "context-guard-stopped")
            diagnostic = text.match(
              /VPR: (?:provider could not count next Haiku request|complete thread context unavailable or ambiguous|next Haiku request reaches|context guard failed)[^\r\n]{0,300}/u,
            )?.[0];
          for (const [model, value] of Object.entries(event.modelUsage ?? {}) as [
            string,
            Record<string, unknown>,
          ][])
            record(
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
        if (!claude && event.type === "item.completed" && event.item?.type === "agent_message") {
          const text = String(event.item.text ?? "");
          answer = text.slice(0, 12000);
          answerTruncated = text.length > 12000;
        }
        if (!claude && event.type === "turn.completed") {
          const normalized = normalizeCodexTokenUsage(event.usage),
            read = normalized.cacheRead, total = normalized.inputIncludingCache, write = normalized.cacheWrite;
          const uncached = normalized.input,
            output = normalized.output,
            prices = input.codexPrices,
            card = prices?.cards.find((card) => card.model === input.model.model);
          let cost = null;
          if (
            card &&
            prices &&
            Date.parse(prices.expiresAt) > Date.now() &&
            total !== null &&
            (total <= 100000 || card.longContext) &&
            uncached !== null &&
            output !== null &&
            write !== null &&
            read !== null
          ) {
            const tiers = total > 100000 ? [card, card.longContext!] : [card];
            const values = tiers.map((tier) => ({
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
            }));
            if (
              values.every(
                (value) =>
                  Number.isFinite(value.min) &&
                  Number.isFinite(value.max) &&
                  value.min >= 0 &&
                  value.max >= value.min,
              )
            )
              cost = {
                min: Math.min(...values.map((v) => v.min)),
                max: Math.max(...values.map((v) => v.max)),
                basis: "official-reference",
              };
          }
          success = true;
          record(
            "final",
            input.model.model,
            {
              inputTokens: uncached,
              inputIncludingCacheTokens: total,
              outputTokens: output,
              cacheReadTokens: read,
              cacheWriteTokens: write,
              inputSemantics: "uncached",
              modelIdentity: "requested-only",
            },
            cost,
          );
        }
      };
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 8_000_000) {
          failure = "output-limit";
          stop();
          return;
        }
        pending += decoder.write(chunk);
        const lines = pending.split(/\r?\n/u);
        pending = lines.pop() ?? "";
        for (const line of lines) observe(line);
      });
      child.stdin.on("error", () => {});
      child.once("error", () => {
        failure = "Native process unavailable";
        clearTimeout(timer);
        done();
      });
      child.once("close", (code) => {
        pending += decoder.end();
        if (pending) observe(pending);
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", cancel);
        if (code !== 0) success = false;
        done();
      });
      child.stdin.end(prompt);
    });
  }
  await Promise.all(writes);
  if (success && !usage.length) {
    success = false;
    failure ??= answer.startsWith("VPR: Haiku pausado")
      ? "context-guard-stopped"
      : "native-usage-unavailable";
  }
  if (storageFailed) failure ??= "usage-store-unavailable";
  return {
    success: success && !failure,
    ...(meter ? {receipt: meter.snapshot(Math.round(performance.now() - started))} : {}),
    answer,
    answerTruncated,
    model: input.model.model,
    usage,
    wallMs: Math.round(performance.now() - started),
    failure: failure ?? (success ? null : "Native execution did not complete"),
    ...(diagnostic ? { diagnostic } : {}),
  };
}
