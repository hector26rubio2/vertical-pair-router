import { readFile, writeFile, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { parseProjectProfile, parseGlobalProfile, profilePolicyLayers } from "@vpr/config";
import {
  evaluatePolicy,
  routeWorkflow,
  inspectProvider,
  filterNativeModels,
  runNativeAgent,
  resolveProgramCommand,
  type WorkflowRoutingRequest,
  type NativeAgentRequest,
} from "@vpr/runtime";
import type { CliIo } from "./cli.js";
import { loadWorkflowCases } from "./workflow-cases.js";
import { createSafeProcessRunner } from "@vpr/quality";
import { secretFindings } from "../../quality/src/staged-security.mjs";
import { graphContext } from "./graph-context.js";
import { nativeWorkspace, verifyNativeWorkspace } from "./native-workspace.js";

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
  let profile = parseProjectProfile(
    JSON.parse(await readFile(join(root, ".vpr/profile.json"), "utf8")),
  );
  const globalPath = process.env.VPR_GLOBAL_PROFILE ?? join(homedir(), ".vpr/global.json");
  try {
    const global = parseGlobalProfile(JSON.parse(await readFile(globalPath, "utf8")));
    profile = { ...profile, policy: evaluatePolicy(profilePolicyLayers(global, profile)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
  const result: {
    runId: string;
    decision: typeof decision;
    statuses: typeof statuses;
    phases: unknown[];
    checks: unknown[];
    state: string;
    workspace?: ReturnType<typeof verifyNativeWorkspace>;
    retrieval?: { state: string; inferenceTokens: number; characters: number };
  } = { runId, decision, statuses, phases: [], checks: [], state: "RUNNING" };
  const save = () => writeFile(join(directory, "receipt.json"), JSON.stringify(result, null, 2));
  let handoff = "";
  let reviewSummary = "";
  let verifyAfterChecks = async () => true;
  const runChecks = async (attempt: number) => {
    let passed = true,
      feedback = "";
    for (const name of task.requiredChecks!) {
      const command = profile.checks[name]!,
        executable = checkPrograms.get(name)!;
      const check = await createSafeProcessRunner([executable.program])({
        program: executable.program,
        args: [...executable.prefix, ...command.args],
        cwd: root,
        timeoutMs: command.timeoutMs ?? 60000,
        maxOutputBytes: profile.policy.maxOutputBytes ?? 1048576,
        signal: controller.signal,
      });
      const accepted =
        check.exitCode === 0 && !check.timedOut && !check.cancelled && !check.outputTruncated;
      result.checks.push({
        name,
        passed: accepted,
        attempt,
        exitCode: check.exitCode,
        timedOut: check.timedOut,
        cancelled: check.cancelled,
        outputTruncated: check.outputTruncated,
        durationMs: check.durationMs,
      });
      if (!accepted) {
        passed = false;
        const output = check.stdout + "\n" + check.stderr;
        feedback +=
          name +
          " failed. " +
          (secretFindings("check-output", output).length
            ? "Output withheld: sensitive pattern detected."
            : output.slice(-8000)) +
          "\n";
      }
      if (controller.signal.aborted) break;
    }
    if (!(await verifyAfterChecks())) {
      result.state = "SCOPE_CHANGED";
      passed = false;
    }
    await save();
    return { passed, feedback: feedback.slice(-8000) };
  };
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
  try {
    const existingManifest = await readFile(join(root, "package.json")).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    const protectedPaths = [
      ".vpr/profile.json",
      ...(!task.allowPackageChanges && existingManifest ? ["package.json"] : []),
      relative(root, resolve(file)).replaceAll("\\", "/"),
      ...task.requiredChecks
        .flatMap((name) => profile.checks[name]!.args)
        .filter((arg) => !arg.startsWith("-") && arg.includes(".")),
    ];
    const before = await nativeWorkspace(root, protectedPaths);
    let baseline = before;
    const verifyWorkspace = async () => {
      const after = await nativeWorkspace(root, protectedPaths),
        scope = verifyNativeWorkspace(baseline, after, task.allowedPaths!, protectedPaths, true),
        integrity = verifyNativeWorkspace(
          before,
          after,
          ["."],
          protectedPaths,
          task.allowExistingTestChanges,
        );
      result.workspace = {
        passed: scope.passed && integrity.passed,
        changedPaths: [
          ...new Set([...(result.workspace?.changedPaths ?? []), ...scope.changedPaths]),
        ],
        rejectedPaths: [...new Set([...scope.rejectedPaths, ...integrity.rejectedPaths])],
      };
      baseline = after;
      await save();
      return result.workspace.passed;
    };
    verifyAfterChecks = async () => {
      const after = await nativeWorkspace(root, protectedPaths),
        integrity = verifyNativeWorkspace(
          before,
          after,
          ["."],
          protectedPaths,
          task.allowExistingTestChanges,
        );
      baseline = after;
      if (!integrity.passed)
        result.workspace = {
          ...integrity,
          changedPaths: [
            ...new Set([...(result.workspace?.changedPaths ?? []), ...integrity.changedPaths]),
          ],
        };
      return integrity.passed;
    };
    const context = profile.setup?.integrations.graphify
      ? await graphContext(root, task.prompt, controller.signal)
      : { state: "disabled", text: "", inferenceTokens: 0 };
    result.retrieval = {
      state: context.state,
      inferenceTokens: context.inferenceTokens,
      characters: context.text.length,
    };
    await save();
    for (const phase of decision.phases) {
      if (controller.signal.aborted) {
        result.state = "CANCELLED";
        break;
      }
      const model = policy.models.find((model) => model.id === phase.modelId)!;
      if (model.provider === "codex" && phase.writeFiles && !profile.policy.allowShell)
        throw Error("Codex requires project shell permission");
      const response = await services.runNativeAgent({
        model,
        cwd: root,
        prompt:
          task.prompt +
          "\n" +
          context.text +
          "\nAcceptance checks: " +
          task.requiredChecks.join(", ") +
          "\n" +
          (phase.phase === "plan"
            ? "Return a concise plan, at most 6000 characters, with paths, invariants and checks. Do not implement."
            : phase.phase === "technical-plan"
              ? "Refine the architecture into a concise technical handoff, at most 6000 characters. Read only. Do not edit.\nArchitecture:\n" +
                handoff
              : phase.phase === "review"
                ? "Review the actual current source against the task and report concrete concerns with paths/lines. Do not edit. Executed check receipts: " +
                  JSON.stringify(result.checks)
                : "Implement the task. Preserve existing user work and protected acceptance tests. Plan from the preceding phases:\n" +
                  handoff),
        ...(typeof task.title === "string" ? { task: task.title.slice(0, 120) } : {}),
        ...(codexPrices ? { codexPrices } : {}),
        sessionId: runId,
        ...(parentSessionId ? { parentSessionId } : {}),
        accountKey:
          statuses.find((status) => status.provider === model.provider)?.accountKey ?? null,
        phase: phase.phase as NativeAgentRequest["phase"],
        writeFiles: phase.writeFiles,
        allowedPaths: task.allowedPaths,
        allowShell: profile.policy.allowShell === true,
        timeoutMs: phaseTimeoutMs,
        signal: controller.signal,
      });
      result.phases.push({
        phase: phase.phase,
        model: model.id,
        success: response.success,
        wallMs: response.wallMs,
        usage: response.usage,
        failure: response.failure,
        ...(response.diagnostic ? { diagnostic: response.diagnostic } : {}),
      });
      await save();
      if (!(await verifyWorkspace())) {
        result.state = "SCOPE_CHANGED";
        break;
      }
      if (!response.success) {
        result.state = controller.signal.aborted ? "CANCELLED" : "INCOMPLETE";
        break;
      }
      if (phase.phase === "plan" || phase.phase === "technical-plan") {
        if (response.answerTruncated || handoff.length + response.answer.length + 1 > 24000) {
          result.state = "HANDOFF_TOO_LARGE";
          break;
        }
        handoff += "\n" + response.answer;
      }
      if (phase.phase === "review") reviewSummary = response.answer;
      if (phase.writeFiles) {
        let validation = await runChecks(0);
        if (result.state !== "RUNNING") break;
        if (
          !validation.passed &&
          !controller.signal.aborted &&
          decision.maxImplementationRetries > 0
        ) {
          const repair = await services.runNativeAgent({
            model,
            cwd: root,
            prompt:
              task.prompt +
              "\nApply one bounded correction to the previous implementation. Preserve user work and all protected acceptance tests. Modify only authorized paths. Do not run commands, install, commit or delegate.\nPlan:\n" +
              handoff +
              "\nExecuted check feedback (not a claim by the model):\n" +
              validation.feedback,
            ...(typeof task.title === "string" ? { task: task.title.slice(0, 120) } : {}),
            sessionId: runId,
            ...(parentSessionId ? { parentSessionId } : {}),
            accountKey:
              statuses.find((status) => status.provider === model.provider)?.accountKey ?? null,
            phase: "repair",
            writeFiles: true,
            allowedPaths: task.allowedPaths!,
            allowShell: profile.policy.allowShell === true,
            timeoutMs: phaseTimeoutMs,
            signal: controller.signal,
            ...(codexPrices ? { codexPrices } : {}),
          });
          result.phases.push({
            phase: "repair",
            model: model.id,
            success: repair.success,
            wallMs: repair.wallMs,
            usage: repair.usage,
            failure: repair.failure,
            ...(repair.diagnostic ? { diagnostic: repair.diagnostic } : {}),
          });
          await save();
          if (!(await verifyWorkspace())) {
            result.state = "SCOPE_CHANGED";
            break;
          }
          if (!repair.success) {
            result.state = controller.signal.aborted ? "CANCELLED" : "INCOMPLETE";
            break;
          }
          validation = await runChecks(1);
          if (result.state !== "RUNNING") break;
        }
        if (controller.signal.aborted) result.state = "CANCELLED";
        else if (!validation.passed) result.state = "CHECKS_FAILED";
        if (result.state !== "RUNNING") break;
      }
    }
    if (result.state === "RUNNING")
      result.state = role === "coding" ? "CHECKED_AWAITING_REVIEW" : "FINISHED";
  } catch {
    result.state = controller.signal.aborted ? "CANCELLED" : "INCOMPLETE";
  } finally {
    clearTimeout(deadline);
    if (deadlineReached) result.state = "DEADLINE";
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await save();
    await lock.close();
    const owner = JSON.parse(await readFile(lockPath, "utf8"));
    if (owner.runId === runId) await unlink(lockPath);
  }
  io.stdout(
    JSON.stringify({
      ...result,
      ...(reviewSummary ? { reviewSummary } : {}),
      receipt: join(directory, "receipt.json"),
      dispatchPerformed: true,
    }) + "\n",
  );
  return ["CHECKED_AWAITING_REVIEW", "FINISHED"].includes(result.state) ? 0 : 1;
}
