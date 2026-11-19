import { spawn } from "node:child_process";
import { delimiter, join, dirname, resolve, isAbsolute } from "node:path";
import { CopilotClient, RuntimeConnection } from "@microsoft/copilot-sdk";
import type { AgentModel } from "@vpr/core";
import { resolveExecutable } from "./resolve-executable.js";
import { inspectCodexAccount } from "./codex-account-status.js";
import { resolveCodexExecutable } from "./codex-launch.js";
import { accountKey, recordAccountObservation, readAccountObservation } from "./usage-ledger.mjs";
export interface NativeProviderStatus {
  provider: "claude" | "codex" | "copilot";
  status: "ready" | "unavailable" | "unauthenticated";
  accountKey: string | null;
  models: readonly {
    model: string;
    supportedEfforts: readonly string[];
    access: "listed" | "requires-execution";
  }[];
  quota: "available" | "limit-reached" | "unknown";
  reason: string;
  observedAt: string;
  inferenceTokens: 0;
  quotaDetails?: ReturnType<typeof normalizeCopilotQuota>;
}
export function normalizeCopilotQuota(value: unknown) {
  const snapshots =
    value && typeof value === "object"
      ? (value as { quotaSnapshots?: Record<string, unknown> }).quotaSnapshots
      : undefined;
  return Object.entries(snapshots ?? {})
    .slice(0, 20)
    .flatMap(([kind, raw]) => {
      if (!raw || typeof raw !== "object" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(kind)) return [];
      const row = raw as Record<string, unknown>,
        remaining =
          typeof row.remainingPercentage === "number" &&
          Number.isFinite(row.remainingPercentage) &&
          row.remainingPercentage >= 0 &&
          row.remainingPercentage <= 100
            ? row.remainingPercentage
            : null;
      const reset =
        typeof row.resetDate === "string" && Number.isFinite(Date.parse(row.resetDate))
          ? row.resetDate
          : null;
      const stale = reset !== null && Date.parse(reset) <= Date.now();
      return [
        {
          kind,
          unit: "requests-as-reported-by-native-SDK",
          remainingPercentage: stale || row.isUnlimitedEntitlement === true ? null : remaining,
          unlimited: row.isUnlimitedEntitlement === true,
          resetAt: reset,
          state: stale
            ? ("unknown" as const)
            : row.isUnlimitedEntitlement === true
              ? ("available" as const)
              : remaining === null
                ? ("unknown" as const)
                : remaining <= 0
                  ? ("limit-reached" as const)
                  : ("available" as const),
        },
      ];
    });
}
export function filterNativeModels(
  models: readonly AgentModel[],
  allowed: readonly string[],
  statuses: readonly NativeProviderStatus[],
) {
  return models.map((model) => {
    const status = statuses.find((status) => status.provider === model.provider),
      listed = status?.models.find((item) => item.model === model.model);
    const reasons = [];
    if (model.provider !== "claude" && /haiku/iu.test(model.model))
      reasons.push("haiku-context-preflight-unavailable-for-provider");
    if (!allowed.includes(model.provider)) reasons.push("provider-not-authorized");
    else if (!status || status.status !== "ready")
      reasons.push(
        status?.status === "unauthenticated"
          ? "native-login-required"
          : "native-cli-or-service-unavailable",
      );
    else {
      if (!listed) reasons.push("model-not-listed-or-disabled-by-policy");
      else if (
        listed.access === "listed" &&
        listed.supportedEfforts.length &&
        !listed.supportedEfforts.includes(model.effort ?? "medium")
      )
        reasons.push("effort-not-supported");
      if (status.quota === "limit-reached") reasons.push("quota-exhausted");
    }
    return {
      modelId: model.id,
      provider: model.provider,
      model: model.model,
      roles: model.roles,
      tier: model.tier,
      eligible: reasons.length === 0,
      reasons,
    };
  });
}
export function subscriptionEnvironment() {
  const env = { ...process.env };
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "COPILOT_GITHUB_TOKEN",
    "CODEX_APP_TOOLS_PIPE_PATH",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CODEX_TOOL_CALL_ID",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  ])
    delete env[name];
  env.VPR_CAPTURE_DISABLED = "1";
  env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = "1";
  return env;
}
/** Resolve npm-installed Windows Copilot without launching a cmd/PowerShell shim. */
export async function resolveProviderExecutable(provider: "claude" | "codex" | "copilot") {
  if (provider === "codex") return resolveCodexExecutable();
  if (provider === "copilot" && process.env.VPR_COPILOT_CLI)
    return isAbsolute(process.env.VPR_COPILOT_CLI)
      ? resolveExecutable(process.env.VPR_COPILOT_CLI)
      : null;
  const direct = await resolveExecutable(provider);
  if (direct || provider !== "copilot" || process.platform !== "win32") return direct;
  const path = process.env.PATH ?? process.env.Path ?? "";
  const nodeDirectory = dirname(process.execPath),
    platformPackage = "copilot-" + process.platform + "-" + process.arch;
  for (const directory of [
    ...path.split(delimiter).filter(Boolean),
    nodeDirectory,
    resolve(nodeDirectory, "../../packages/@github/copilot"),
  ])
    for (const candidate of [
      join(directory, "node_modules", "@github", platformPackage, "copilot.exe"),
      join(
        directory,
        "node_modules",
        "@github",
        "copilot",
        "node_modules",
        "@github",
        platformPackage,
        "copilot.exe",
      ),
      join(directory, "..", "@github", platformPackage, "copilot.exe"),
    ]) {
      const executable = await resolveExecutable(candidate);
      if (executable) return executable;
    }
  return null;
}
export async function publicJsonCommand(
  executable: string,
  args: string[],
  cwd?: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      env: subscriptionEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let content = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 5000);
    child.stdout.on("data", (chunk) => {
      content += chunk.toString();
      if (content.length > 65536) {
        child.kill();
        resolve(null);
      }
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      try {
        resolve(code === 0 ? JSON.parse(content) : null);
      } catch {
        resolve(null);
      }
    });
  });
}
export async function inspectProvider(
  provider: NativeProviderStatus["provider"],
  models: readonly AgentModel[],
  cwd?: string,
): Promise<NativeProviderStatus> {
  const base = {
    provider,
    accountKey: null,
    models: [],
    quota: "unknown",
    observedAt: new Date().toISOString(),
    inferenceTokens: 0,
  } as const;
  const executable = await resolveProviderExecutable(provider);
  if (!executable) return { ...base, status: "unavailable", reason: "Native CLI not installed" };
  if (provider === "claude") {
    const status = (await publicJsonCommand(executable!, ["auth", "status"], cwd)) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
      orgId?: string;
    } | null;
    if (!status?.loggedIn || status.authMethod !== "claude.ai")
      return {
        ...base,
        status: "unauthenticated",
        reason: "Native Claude subscription login not confirmed",
      };
    const key = await accountKey(
        provider,
        status.email ? status.email + "|" + (status.orgId ?? "") : null,
      ),
      observation = await readAccountObservation(key);
    const windows = observation?.windows as { remainingPercent: number }[] | undefined;
    return {
      ...base,
      status: "ready",
      accountKey: key,
      quota: windows?.some((w) => w.remainingPercent <= 0)
        ? "limit-reached"
        : windows?.length
          ? "available"
          : "unknown",
      models: models
        .filter((model) => model.provider === provider)
        .map((model) => ({
          model: model.model,
          supportedEfforts: [],
          access: "requires-execution" as const,
        })),
      reason: "Native subscription login; individual model entitlement is checked during execution",
    };
  }
  if (provider === "codex") {
    const status = await inspectCodexAccount();
    const states = status.buckets
      .filter((bucket) => bucket.limitId === "codex")
      .map((bucket) => bucket.delegationCapacity);
    return {
      ...base,
      status: status.status === "observed" ? "ready" : "unavailable",
      accountKey: "accountKey" in status ? status.accountKey : null,
      models: status.models
        .filter((model) => model.model)
        .map((model) => ({
          model: model.model!,
          supportedEfforts: model.supportedEfforts as string[],
          access: "listed" as const,
        })),
      quota: states.includes("limit-reached")
        ? "limit-reached"
        : states.length && states.every((state) => state === "available-at-observation")
          ? "available"
          : "unknown",
      reason: status.reason,
    };
  }
  const client = new CopilotClient({
    mode: "coding-agent",
    runtime: RuntimeConnection.forSpawnedStdio({
      path: executable,
      ...(cwd ? { workingDirectory: cwd } : {}),
      env: subscriptionEnvironment(),
    }),
    github: { useLoggedInUser: true },
    observability: { logLevel: "none" },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await client.start();
        const auth = await client.getAuthStatus();
        if (!auth.isAuthenticated)
          return {
            ...base,
            status: "unauthenticated" as const,
            reason: "Native Copilot login required",
          };
        const listed = await client.listModels();
        let quotaDetails: ReturnType<typeof normalizeCopilotQuota> = [];
        try {
          quotaDetails = normalizeCopilotQuota(await client.rpc.account.getQuota({}));
        } catch {}
        const key = await accountKey(
          provider,
          auth.login ? auth.login + "|" + (auth.host ?? "") : null,
        );
        if (key)
          await recordAccountObservation({
            provider,
            accountKey: key,
            windows: quotaDetails
              .filter((detail) => detail.remainingPercentage !== null && detail.resetAt)
              .map((detail) => ({
                kind: detail.kind,
                percentUsed: 100 - detail.remainingPercentage!,
                resetsAt: detail.resetAt,
              })),
          }).catch(() => {});
        return {
          ...base,
          status: "ready" as const,
          accountKey: key,
          quota:
            quotaDetails.find((detail) => detail.kind === "premium_interactions")?.state ??
            "unknown",
          quotaDetails,
          models: listed
            .filter(
              (model) =>
                model.policy?.state !== "disabled" &&
                model.policy?.state !== "unconfigured" &&
                model.provider?.kind === "copilot",
            )
            .map((model) => ({
              model: model.id,
              supportedEfforts: model.supportedReasoningEfforts ?? [],
              access: "listed" as const,
            })),
          reason:
            "Native Copilot model catalog, excluding disabled/unconfigured and unattributed/BYOK models",
        };
      })(),
      new Promise<NativeProviderStatus>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              ...base,
              status: "unavailable",
              reason: "Native account metadata timed out",
            }),
          15000,
        );
      }),
    ]);
  } catch {
    return {
      ...base,
      status: "unavailable",
      reason: "Native Copilot metadata refused; check login, proxy and corporate policy",
    };
  } finally {
    clearTimeout(timer);
    await client.forceStop().catch(() => {});
  }
}
