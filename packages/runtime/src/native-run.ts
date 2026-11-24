import type { AgentModel, routeWorkflow } from "@vpr/core";

import type { NativeAgentRequest, NativeAgentResult } from "./native-agent.js";
import type { NativeProviderStatus } from "./native-providers.js";
import { verifyNativeWorkspace } from "./native-workspace.js";

export type NativeWorkflowDecision = ReturnType<typeof routeWorkflow>;

export interface NativeCheckOutcome {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface NativeRunWorkspaceReport {
  passed: boolean;
  changedPaths: string[];
  rejectedPaths: string[];
}

export interface NativeRunReceipt {
  runId: string;
  decision: NativeWorkflowDecision;
  statuses: NativeProviderStatus[];
  phases: unknown[];
  checks: unknown[];
  state: string;
  workspace?: NativeRunWorkspaceReport;
  retrieval?: { state: string; inferenceTokens: number; characters: number };
}

export interface NativeRunInput {
  readonly runId: string;
  readonly cwd: string;
  readonly decision: NativeWorkflowDecision;
  readonly statuses: NativeProviderStatus[];
  readonly models: readonly AgentModel[];
  readonly role: string;
  readonly prompt: string;
  readonly title?: unknown;
  readonly requiredChecks: readonly string[];
  readonly allowedPaths: readonly string[];
  readonly allowShell: boolean;
  readonly allowExistingTestChanges?: boolean | undefined;
  readonly phaseTimeoutMs: number;
  readonly parentSessionId?: string | undefined;
  readonly codexPrices?: NativeAgentRequest["codexPrices"] | undefined;
}

export interface NativeRunPorts {
  readonly signal: AbortSignal;
  readonly deadlineReached: () => boolean;
  readonly runAgent: (request: NativeAgentRequest) => Promise<NativeAgentResult>;
  readonly runCheck: (name: string, signal: AbortSignal) => Promise<NativeCheckOutcome>;
  readonly resolveProtectedPaths: () => Promise<readonly string[]>;
  readonly snapshotWorkspace: (
    protectedPaths: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
  readonly graphContext: (
    signal: AbortSignal,
  ) => Promise<{ state: string; text: string; inferenceTokens: number }>;
  readonly hasSecret: (output: string) => boolean;
  readonly saveReceipt: (receipt: NativeRunReceipt) => Promise<void>;
}

export interface NativeRunOutcome {
  readonly receipt: NativeRunReceipt;
  readonly reviewSummary: string;
}

const wholeWorkspace = ["."];

export async function executeNativeRun(
  input: NativeRunInput,
  ports: NativeRunPorts,
): Promise<NativeRunOutcome> {
  const { decision } = input;
  const { signal } = ports;
  const result: NativeRunReceipt = {
    runId: input.runId,
    decision,
    statuses: input.statuses,
    phases: [],
    checks: [],
    state: "RUNNING",
  };
  const save = () => ports.saveReceipt(result);
  const accountKeyFor = (model: AgentModel) =>
    input.statuses.find((status) => status.provider === model.provider)?.accountKey ?? null;
  const optionalRequestFields = () => ({
    ...(typeof input.title === "string" ? { task: input.title.slice(0, 120) } : {}),
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.codexPrices ? { codexPrices: input.codexPrices } : {}),
  });
  let handoff = "";
  let reviewSummary = "";
  let verifyAfterChecks = async () => true;
  const runChecks = async (attempt: number) => {
    let passed = true,
      feedback = "";
    for (const name of input.requiredChecks) {
      const check = await ports.runCheck(name, signal);
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
          (ports.hasSecret(output)
            ? "Output withheld: sensitive pattern detected."
            : output.slice(-8000)) +
          "\n";
      }
      if (signal.aborted) break;
    }
    if (!(await verifyAfterChecks())) {
      result.state = "SCOPE_CHANGED";
      passed = false;
    }
    await save();
    return { passed, feedback: feedback.slice(-8000) };
  };
  try {
    const protectedPaths = await ports.resolveProtectedPaths();
    const before = await ports.snapshotWorkspace(protectedPaths);
    let baseline = before;
    const verifyWorkspace = async () => {
      const after = await ports.snapshotWorkspace(protectedPaths),
        scope = verifyNativeWorkspace(baseline, after, input.allowedPaths, protectedPaths, true),
        integrity = verifyNativeWorkspace(
          before,
          after,
          wholeWorkspace,
          protectedPaths,
          input.allowExistingTestChanges,
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
      const after = await ports.snapshotWorkspace(protectedPaths),
        integrity = verifyNativeWorkspace(
          before,
          after,
          wholeWorkspace,
          protectedPaths,
          input.allowExistingTestChanges,
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
    const context = await ports.graphContext(signal);
    result.retrieval = {
      state: context.state,
      inferenceTokens: context.inferenceTokens,
      characters: context.text.length,
    };
    await save();
    for (const phase of decision.phases) {
      if (signal.aborted) {
        result.state = "CANCELLED";
        break;
      }
      const model = input.models.find((model) => model.id === phase.modelId)!;
      if (model.provider === "codex" && phase.writeFiles && !input.allowShell)
        throw Error("Codex requires project shell permission");
      const response = await ports.runAgent({
        model,
        cwd: input.cwd,
        prompt:
          input.prompt +
          "\n" +
          context.text +
          "\nAcceptance checks: " +
          input.requiredChecks.join(", ") +
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
        ...optionalRequestFields(),
        sessionId: input.runId,
        accountKey: accountKeyFor(model),
        phase: phase.phase as NativeAgentRequest["phase"],
        writeFiles: phase.writeFiles,
        allowedPaths: input.allowedPaths,
        allowShell: input.allowShell,
        timeoutMs: input.phaseTimeoutMs,
        signal,
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
        result.state = signal.aborted ? "CANCELLED" : "INCOMPLETE";
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
        if (!validation.passed && !signal.aborted && decision.maxImplementationRetries > 0) {
          const repair = await ports.runAgent({
            model,
            cwd: input.cwd,
            prompt:
              input.prompt +
              "\nApply one bounded correction to the previous implementation. Preserve user work and all protected acceptance tests. Modify only authorized paths. Do not run commands, install, commit or delegate.\nPlan:\n" +
              handoff +
              "\nExecuted check feedback (not a claim by the model):\n" +
              validation.feedback,
            ...optionalRequestFields(),
            sessionId: input.runId,
            accountKey: accountKeyFor(model),
            phase: "repair",
            writeFiles: true,
            allowedPaths: input.allowedPaths,
            allowShell: input.allowShell,
            timeoutMs: input.phaseTimeoutMs,
            signal,
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
            result.state = signal.aborted ? "CANCELLED" : "INCOMPLETE";
            break;
          }
          validation = await runChecks(1);
          if (result.state !== "RUNNING") break;
        }
        if (signal.aborted) result.state = "CANCELLED";
        else if (!validation.passed) result.state = "CHECKS_FAILED";
        if (result.state !== "RUNNING") break;
      }
    }
    if (result.state === "RUNNING")
      result.state = input.role === "coding" ? "CHECKED_AWAITING_REVIEW" : "FINISHED";
  } catch {
    result.state = signal.aborted ? "CANCELLED" : "INCOMPLETE";
  } finally {
    if (ports.deadlineReached()) result.state = "DEADLINE";
    await save();
  }
  return { receipt: result, reviewSummary };
}
