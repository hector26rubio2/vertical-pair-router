import type { Run, RunState } from "@vpr/contracts";

const terminalStates = new Set<RunState>(["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"]);

const transitions: Readonly<Record<RunState, readonly RunState[]>> = {
  PENDING: ["ANALYZING", "CANCELLED", "FAILED", "NEEDS_APPROVAL"],
  ANALYZING: ["READY", "BLOCKED", "CANCELLED", "FAILED", "NEEDS_APPROVAL"],
  READY: ["RUNNING", "BLOCKED", "CANCELLED", "FAILED", "NEEDS_APPROVAL"],
  RUNNING: ["VALIDATING", "BLOCKED", "CANCELLED", "FAILED", "NEEDS_APPROVAL"],
  VALIDATING: ["REVIEW", "RUNNING", "BLOCKED", "CANCELLED", "FAILED", "NEEDS_APPROVAL"],
  REVIEW: ["COMPLETED", "RUNNING", "BLOCKED", "CANCELLED", "FAILED", "NEEDS_APPROVAL"],
  COMPLETED: [],
  BLOCKED: [],
  FAILED: [],
  CANCELLED: [],
  NEEDS_APPROVAL: ["ANALYZING", "READY", "RUNNING", "CANCELLED", "FAILED", "BLOCKED"]
};

export class InvalidRunTransitionError extends Error {
  public readonly from: RunState;
  public readonly to: RunState;

  public constructor(from: RunState, to: RunState) {
    super(`Invalid Run transition: ${from} -> ${to}`);
    this.name = "InvalidRunTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return !terminalStates.has(from) && transitions[from].includes(to);
}

export function transitionRun(run: Run, to: RunState, occurredAt: string): Run {
  if (!canTransitionRun(run.state, to)) {
    throw new InvalidRunTransitionError(run.state, to);
  }

  return {
    ...run,
    state: to,
    revision: run.revision + 1,
    updatedAt: occurredAt
  };
}

