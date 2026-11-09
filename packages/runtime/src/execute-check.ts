import type {
  DomainEvent,
  EntityId,
  Evidence,
  ProcessRequest,
  ProcessRunner,
  Run,
  RunState,
  StorageAdapter
} from "@vpr/contracts";
import { transitionRun } from "@vpr/core";

export interface ExecuteCheckRunInput {
  readonly projectId: EntityId;
  readonly storyId: EntityId;
  readonly run: Run;
  readonly actor: string;
  readonly checkName: string;
  readonly request: ProcessRequest;
  readonly processRunner: ProcessRunner;
  readonly storage: StorageAdapter;
  readonly now: () => string;
  readonly nextId: (prefix: "evt" | "evd") => EntityId;
}

export interface ExecuteCheckRunResult {
  readonly run: Run;
  readonly evidence: Evidence;
}

const secretPatterns: readonly RegExp[] = [
  /\b(token|api[_-]?key|password|secret)\s*[=:]\s*[^\s,;]+/giu,
  /\b(sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gu
];

export function redactSecrets(value: string): string {
  return secretPatterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, "$1=[REDACTED]"),
    value
  );
}

export async function executeCheckRun(
  input: ExecuteCheckRunInput
): Promise<ExecuteCheckRunResult> {
  let current = input.run;

  const advance = async (to: RunState): Promise<void> => {
    const from = current.state;
    current = transitionRun(current, to, input.now());
    await input.storage.appendEvent(
      event(input, current, "RunStateChanged", { from, to })
    );
  };

  await advance("ANALYZING");
  await advance("READY");
  await advance("RUNNING");
  await advance("VALIDATING");

  const observedAt = input.now();
  const processResult = await input.processRunner(input.request);
  const summary = redactSecrets(
    [processResult.stdout, processResult.stderr].filter(Boolean).join("\n")
  );
  const evidence: Evidence = {
    evidenceId: input.nextId("evd"),
    runId: current.runId,
    kind: "check",
    name: input.checkName,
    observedAt,
    ...(processResult.exitCode === null ? {} : { exitCode: processResult.exitCode }),
    durationMs: processResult.durationMs,
    summary,
    outputTruncated: processResult.outputTruncated,
    source: "measured"
  };

  await input.storage.appendEvent(
    event(input, current, "EvidenceRecorded", {
      evidenceId: evidence.evidenceId,
      kind: evidence.kind,
      name: evidence.name,
      observedAt: evidence.observedAt,
      exitCode: evidence.exitCode ?? null,
      durationMs: evidence.durationMs ?? null,
      summary: evidence.summary,
      outputTruncated: evidence.outputTruncated,
      source: evidence.source,
      timedOut: processResult.timedOut,
      cancelled: processResult.cancelled
    })
  );

  const passed =
    processResult.exitCode === 0 &&
    !processResult.outputTruncated &&
    !processResult.timedOut &&
    !processResult.cancelled;

  if (passed) {
    await advance("REVIEW");
    await advance("COMPLETED");
  } else {
    await advance("FAILED");
  }

  return { run: current, evidence };
}

function event(
  input: ExecuteCheckRunInput,
  run: Run,
  type: string,
  payload: Readonly<Record<string, unknown>>
): DomainEvent {
  return {
    schemaVersion: 1,
    eventId: input.nextId("evt"),
    occurredAt: input.now(),
    projectId: input.projectId,
    storyId: input.storyId,
    taskId: run.taskId,
    runId: run.runId,
    actor: input.actor,
    type,
    payload
  };
}

