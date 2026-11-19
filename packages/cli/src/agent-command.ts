import { readFile, writeFile, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import {
  routeWorkflow,
  inspectProvider,
  filterNativeModels,
  runNativeAgent,
  executeNativeRun,
  nativeWorkspace,
  type NativeCheckOutcome,
  type NativeRunOutcome,
  resolveProgramCommand,
  type WorkflowRoutingRequest,
  type NativeAgentRequest,
} from "@vpr/runtime";
import type { CliIo } from "./cli.js";
import { readEffectiveProfile } from "./project-workspace.js";
import { loadWorkflowCases } from "./workflow-cases.js";
import { createSafeProcessRunner } from "@vpr/quality";
import { secretFindings } from "../../quality/src/staged-security.mjs";
import { graphContext } from "./graph-context.js";

/** Actual bounded native execution. Inspection never persists account credentials. */
export async function runAgentCommand(
  args: readonly string[],
  io: CliIo,
  services: { inspectProvider: typeof inspectProvider; runNativeAgent: typeof runNativeAgent } = {
    inspectProvider,
    runNativeAgent,
  },
) {
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const root = resolve(flag("--project") ?? process.cwd()),
    file = flag("--input");
  if (!file || !["run", "detect"].includes(args[0] ?? "")) {
    io.stderr("Usage: vpr agent <detect|run> --input <task.json> [--project <path>] [--preview]\n");
    return 2;
  }
  const profile = await readEffectiveProfile(root);
  const policy = profile.orchestration;
  if (!policy) throw Error("Configure orchestration in init before native execution");
  const content = await readFile(resolve(file), "utf8");
  if (Buffer.byteLength(content) > 65536) throw Error("Task input exceeds 64 KiB");
  const task = JSON.parse(content) as Partial<WorkflowRoutingRequest> & {
    prompt?: string;
    title?: string;
    allowedPaths?: string[];
    requiredChecks?: string[];
    parentSessionId?: string;
    phaseTimeoutMs?: number;
    totalTimeoutMs?: number;
    allowExistingTestChanges?: boolean;
    allowPackageChanges?: boolean;
  };
  if (
    [task.allowExistingTestChanges, task.allowPackageChanges].some(
      (value) => value !== undefined && typeof value !== "boolean",
    )
  )
    throw Error("Invalid protected-file change policy");
  const phaseTimeoutMs = task.phaseTimeoutMs ?? 180000,
    totalTimeoutMs = task.totalTimeoutMs ?? 1500000;
  if (
    !Number.isInteger(phaseTimeoutMs) ||
    phaseTimeoutMs < 1000 ||
    phaseTimeoutMs > 300000 ||
    !Number.isInteger(totalTimeoutMs) ||
    totalTimeoutMs < phaseTimeoutMs ||
    totalTimeoutMs > 1500000
  )
    throw Error("Invalid bounded phase or total timeout");
  if (typeof task.prompt === "string" && task.prompt.length > 24000)
    throw Error("Task prompt exceeds 24000 characters; use bounded file references");
  if (
    typeof task.prompt !== "string" ||
    !task.prompt.trim() ||
    !Array.isArray(task.allowedPaths) ||
    !task.allowedPaths.length ||
    !task.allowedPaths.every(
      (path) =>
        typeof path === "string" &&
        !path.includes("\0") &&
        !path.startsWith("/") &&
        !/^[a-z]:/iu.test(path) &&
        !path.split(/[\\/]/u).includes(".."),
    ) ||
    !Array.isArray(task.requiredChecks) ||
    !task.requiredChecks.every((name) => typeof name === "string" && profile.checks[name])
  )
    throw Error("Task requires prompt, relative allowedPaths and configured requiredChecks");
  const permitted = (task.allowedProviders ?? profile.policy.allowedProviders ?? []).filter(
    (provider) =>
      profile.policy.allowedProviders?.includes(provider) &&
      ["claude", "codex", "copilot"].includes(provider),
  );
  const statuses = await Promise.all(
    [...new Set(permitted)].map((provider) =>
      services.inspectProvider(provider as "claude" | "codex" | "copilot", policy.models, root),
    ),
  );
  const selectionFilters = filterNativeModels(policy.models, permitted, statuses);
  const verified = policy.models.filter((model) =>
    selectionFilters.some((item) => item.modelId === model.id && item.eligible),
  );
  const role = task.executionRole ?? "coding";
  const request: WorkflowRoutingRequest = {
    kind: task.kind ?? "feature",
    complexity: task.complexity ?? "normal",
    risk: task.risk ?? "medium",
    executionRole: role,
    needsPlanning: task.needsPlanning ?? true,
    ...(task.technicalPlannerId ? { technicalPlannerId: task.technicalPlannerId } : {}),
    ...(task.reviewerId ? { reviewerId: task.reviewerId } : {}),
    ...(task.planningMode ? { planningMode: task.planningMode } : {}),
    taskSignature:
      task.taskSignature ??
      createHash("sha256")
        .update(task.prompt + "|" + task.requiredChecks.join(","))
        .digest("hex"),
    hasAcceptanceChecks: task.requiredChecks.length > 0,
    ...(task.currentModelId !== undefined ? { currentModelId: task.currentModelId } : {}),
    ...(task.preferredExecutorId !== undefined
      ? { preferredExecutorId: task.preferredExecutorId }
      : {}),
    ...(task.plannerId !== undefined ? { plannerId: task.plannerId } : {}),
    ...(task.advancedPlannerId !== undefined ? { advancedPlannerId: task.advancedPlannerId } : {}),
    executorModelIds: "eligible",
    fallbackIneligibleRoles: true,
    allowedProviders: permitted,
    verifiedModelIds: verified.map((model) => model.id),
    history: [],
    now: new Date().toISOString(),
    providerCapacity: statuses.map((status) => ({
      provider: status.provider,
      state: status.quota,
      observedAt: status.observedAt,
      source: "provider_reported",
    })),
  };
  const history = await loadWorkflowCases(root, policy);
  const decision = routeWorkflow(policy, { ...request, history });
  if (args[0] === "detect" || args.includes("--preview") || decision.status === "blocked") {
    io.stdout(JSON.stringify({ dispatched: false, decision, statuses, selectionFilters }) + "\n");
    return decision.status === "blocked" ? 3 : 0;
  }
  if (role === "coding" && (!task.requiredChecks.length || profile.policy.allowShell !== true))
    throw Error(
      "Implementation needs configured acceptance checks and project shell authorization before spending model tokens",
    );
  const checkPrograms = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof resolveProgramCommand>>>
  >();
  for (const name of task.requiredChecks) {
    const executable = await resolveProgramCommand(profile.checks[name]!.program);
    if (!executable) throw Error("Required check executable unavailable before dispatch: " + name);
    checkPrograms.set(name, executable);
  }
  const runId = randomUUID(),
    directory = join(root, ".vpr/runs", runId);
  await mkdir(directory, { recursive: true });
  const lockPath = join(root, ".vpr/native-run.lock");
  const lock = await open(lockPath, "wx").catch(() => {
    throw Error(
      "Another native run is active or requires recovery; inspect .vpr/native-run.lock before dispatch",
    );
  });
  await lock.writeFile(
    JSON.stringify({ runId, pid: process.pid, startedAt: new Date().toISOString() }),
  );
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let deadlineReached = false;
  const deadline = setTimeout(() => {
    deadlineReached = true;
    controller.abort();
  }, totalTimeoutMs);
  const parentSessionId = task.parentSessionId ?? process.env.VPR_PARENT_SESSION;
  let codexPrices: NativeAgentRequest["codexPrices"];
  const local = dirname(fileURLToPath(import.meta.url));
  for (const path of [
    resolve(local, "../data/openai-model-prices.json"),
    resolve(local, "../../../docs/research/openai-model-price-catalog.json"),
  ])
    try {
      codexPrices = JSON.parse(await readFile(path, "utf8"));
      break;
    } catch {}
  const allowedPaths = task.allowedPaths;
  const requiredChecks = task.requiredChecks;
  const resolveProtectedPaths = async () => {
    const existingManifest = await readFile(join(root, "package.json")).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    return [
      ".vpr/profile.json",
      ...(!task.allowPackageChanges && existingManifest ? ["package.json"] : []),
      relative(root, resolve(file)).replaceAll("\\", "/"),
      ...requiredChecks
        .flatMap((name) => profile.checks[name]!.args)
        .filter((arg) => !arg.startsWith("-") && arg.includes(".")),
    ];
  };
  const runCheck = async (name: string, signal: AbortSignal): Promise<NativeCheckOutcome> => {
    const command = profile.checks[name]!,
      executable = checkPrograms.get(name)!;
    return createSafeProcessRunner([executable.program])({
      program: executable.program,
      args: [...executable.prefix, ...command.args],
      cwd: root,
      timeoutMs: command.timeoutMs ?? 60000,
      maxOutputBytes: profile.policy.maxOutputBytes ?? 1048576,
      signal,
    });
  };
  const taskPrompt = task.prompt;
  let outcome: NativeRunOutcome;
  try {
    outcome = await executeNativeRun(
      {
        runId,
        cwd: root,
        decision,
        statuses,
        models: policy.models,
        role,
        prompt: taskPrompt,
        title: task.title,
        requiredChecks,
        allowedPaths,
        allowShell: profile.policy.allowShell === true,
        allowExistingTestChanges: task.allowExistingTestChanges,
        phaseTimeoutMs,
        parentSessionId,
        codexPrices,
      },
      {
        signal: controller.signal,
        deadlineReached: () => deadlineReached,
        runAgent: services.runNativeAgent,
        runCheck,
        resolveProtectedPaths,
        snapshotWorkspace: (protectedPaths) => nativeWorkspace(root, protectedPaths),
        graphContext: async (signal) =>
          profile.setup?.integrations.graphify
            ? graphContext(root, taskPrompt, signal)
            : { state: "disabled", text: "", inferenceTokens: 0 },
        hasSecret: (output) => secretFindings("check-output", output).length > 0,
        saveReceipt: (receipt) =>
          writeFile(join(directory, "receipt.json"), JSON.stringify(receipt, null, 2)),
      },
    );
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await lock.close();
    const owner = JSON.parse(await readFile(lockPath, "utf8"));
    if (owner.runId === runId) await unlink(lockPath);
  }
  const { receipt, reviewSummary } = outcome;
  io.stdout(
    JSON.stringify({
      ...receipt,
      ...(reviewSummary ? { reviewSummary } : {}),
      receipt: join(directory, "receipt.json"),
      dispatchPerformed: true,
    }) + "\n",
  );
  return ["CHECKED_AWAITING_REVIEW", "FINISHED"].includes(receipt.state) ? 0 : 1;
}
