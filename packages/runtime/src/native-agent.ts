import { realpath } from "node:fs/promises";
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { CopilotClient, RuntimeConnection } from "@microsoft/copilot-sdk";
import type { AgentModel } from "@vpr/core";
import type { NativeSessionSnapshot } from "@vpr/observability";
import {
  subscriptionEnvironment,
  resolveProviderExecutable,
} from "./native-providers.js";
import { recordUsage } from "./usage-ledger.mjs";
import {
  codexLaunchEnvironment,
  probeCodexWindowsExecution,
} from "./codex-launch.js";
import { runClaudeSession } from "./native-agent-claude.js";
import { runCodexSession } from "./native-agent-codex.js";
import { integer, type CodexPrices } from "./native-agent-session.js";
export interface NativeAgentRequest {
  model: AgentModel;
  cwd: string;
  prompt: string;
  sessionId: string;
  parentSessionId?: string;
  accountKey?: string | null;
  phase:
    "plan" | "technical-plan" | "implement" | "repair" | "review" | "inventory";
  writeFiles: boolean;
  allowedPaths: readonly string[];
  allowShell: boolean;
  timeoutMs: number;
  maxTurns?: number;
  onSnapshot?: (receipt: NativeSessionSnapshot) => Promise<void>;
  signal?: AbortSignal;
  task?: string;
  codexPrices?: CodexPrices;
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
export async function allowedProjectPath(
  root: string,
  path: string,
  allowed: readonly string[],
) {
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
  if (isAbsolute(local) || local === ".." || local.startsWith("../"))
    return false;
  return allowed.some(
    (prefix) =>
      prefix === "." ||
      local === prefix ||
      local.startsWith(prefix.replace(/\/$/u, "") + "/"),
  );
}
export async function runNativeAgent(
  input: NativeAgentRequest,
): Promise<NativeAgentResult> {
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
    (input.maxTurns !== undefined &&
      (!Number.isSafeInteger(input.maxTurns) ||
        input.maxTurns < 1 ||
        input.maxTurns > 100)) ||
    input.timeoutMs < 1000 ||
    input.timeoutMs > 300000 ||
    input.prompt.length > 60000 ||
    !input.allowedPaths.length ||
    input.allowedPaths.some(
      (path) =>
        isAbsolute(path) ||
        path.split(/[\\/]/u).includes("..") ||
        path.includes("\0"),
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
    const probe = await probeCodexWindowsExecution(
      executable,
      input.cwd,
      codexEnv,
      input.signal,
    );
    if (!probe.ready)
      return {
        success: false,
        answer: "",
        model: input.model.model,
        usage: [],
        wallMs: Math.round(performance.now() - entered),
        failure: input.signal?.aborted
          ? "cancelled"
          : "native-execution-unavailable",
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
    diagnostic: string | undefined,
    snapshot: ((wallMs: number) => NativeSessionSnapshot) | undefined;
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
                ("managedApprovalRequired" in request &&
                  request.managedApprovalRequired) ||
                ("requestSandboxBypass" in request &&
                  request.requestSandboxBypass)
              )
                return {
                  kind: "reject",
                  feedback:
                    "Corporate or host approval cannot be automated by VPR",
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
                      paths.map((path) =>
                        allowedProjectPath(input.cwd, path, input.allowedPaths),
                      ),
                    )
                  ).every(Boolean)
                )
                  return { kind: "approve-once" };
              }
              return {
                kind: "reject",
                feedback: "Operation outside VPR phase permissions",
              };
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
              : {
                  min: credits * 0.01,
                  max: credits * 0.01,
                  basis: "provider-reported",
                },
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
    const session =
      input.model.provider === "claude" ? runClaudeSession : runCodexSession;
    const outcome = await session({
      executable: executable!,
      model: input.model,
      cwd: input.cwd,
      prompt,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      writeFiles: input.writeFiles,
      allowedPaths: input.allowedPaths,
      maxTurns: input.maxTurns,
      codexPrices: input.codexPrices,
      environment: codexEnv ?? subscriptionEnvironment(),
      onSnapshot: input.onSnapshot,
      elapsedMs: () => Math.round(performance.now() - started),
      record,
      trackWrite: (write) => {
        writes.push(write);
      },
      markStorageFailed: () => {
        storageFailed = true;
      },
    });
    if (outcome.kind === "refused")
      return {
        success: false,
        answer: "",
        model: input.model.model,
        usage: [],
        wallMs: Math.round(performance.now() - started),
        failure: outcome.failure,
      };
    ({ answer, answerTruncated, success, failure, diagnostic } = outcome);
    snapshot = outcome.snapshot;
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
    ...(snapshot
      ? { receipt: snapshot(Math.round(performance.now() - started)) }
      : {}),
    answer,
    answerTruncated,
    model: input.model.model,
    usage,
    wallMs: Math.round(performance.now() - started),
    failure: failure ?? (success ? null : "Native execution did not complete"),
    ...(diagnostic ? { diagnostic } : {}),
  };
}
