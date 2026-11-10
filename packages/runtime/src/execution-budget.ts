export interface ExecutionLimits {
  readonly maxWallTimeMs: number;
  readonly maxRetries: number;
  readonly maxRouterIterations: number;
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
}

export interface UsageObservability {
  readonly tokens: "unavailable" | "observable" | "enforceable";
  readonly cost: "unavailable" | "observable" | "enforceable";
}

export class ExecutionLimitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionLimitError";
  }
}

export class ExecutionBudget {
  readonly #limits: ExecutionLimits;
  readonly #observability: UsageObservability;
  readonly #startedAtMs: number;
  readonly #nowMs: () => number;
  readonly providerInternalLimits: Readonly<Record<string, number>>;
  #attempt = 0;
  #iteration = 0;

  public constructor(input: {
    readonly limits: ExecutionLimits;
    readonly observability: UsageObservability;
    readonly providerInternal: Readonly<Record<string, number>>;
    readonly startedAtMs: number;
    readonly nowMs: () => number;
  }) {
    validateLimits(input.limits);
    this.#limits = input.limits;
    this.#observability = input.observability;
    this.#startedAtMs = input.startedAtMs;
    this.#nowMs = input.nowMs;
    this.providerInternalLimits = { ...input.providerInternal };
  }

  public consumeAttempt(): { readonly attempt: number; readonly maxAttempts: number } {
    this.assertWithinWallTime();
    const maxAttempts = this.#limits.maxRetries + 1;
    if (this.#attempt >= maxAttempts) throw new ExecutionLimitError("VPR retry limit exceeded");
    this.#attempt += 1;
    return { attempt: this.#attempt, maxAttempts };
  }

  public consumeRouterIteration(): { readonly iteration: number; readonly maxIterations: number } {
    this.assertWithinWallTime();
    if (this.#iteration >= this.#limits.maxRouterIterations) {
      throw new ExecutionLimitError("VPR router iteration limit exceeded");
    }
    this.#iteration += 1;
    return { iteration: this.#iteration, maxIterations: this.#limits.maxRouterIterations };
  }

  public observeUsage(usage: {
    readonly tokens?: number;
    readonly costUsd?: number;
  }): {
    readonly enforcement: {
      readonly tokens: "enforced" | "observed-only" | "unavailable";
      readonly cost: "enforced" | "observed-only" | "unavailable";
    };
  } {
    if (
      this.#observability.tokens === "enforceable" &&
      this.#limits.maxTokens !== undefined &&
      usage.tokens !== undefined &&
      usage.tokens > this.#limits.maxTokens
    ) {
      throw new ExecutionLimitError("Observable token limit exceeded");
    }
    if (
      this.#observability.cost === "enforceable" &&
      this.#limits.maxCostUsd !== undefined &&
      usage.costUsd !== undefined &&
      usage.costUsd > this.#limits.maxCostUsd
    ) {
      throw new ExecutionLimitError("Observable cost limit exceeded");
    }
    return {
      enforcement: {
        tokens: capabilityResult(this.#observability.tokens),
        cost: capabilityResult(this.#observability.cost)
      }
    };
  }

  public assertWithinWallTime(): void {
    if (this.#nowMs() - this.#startedAtMs > this.#limits.maxWallTimeMs) {
      throw new ExecutionLimitError("VPR wall time limit exceeded");
    }
  }
}

function capabilityResult(
  capability: "unavailable" | "observable" | "enforceable"
): "enforced" | "observed-only" | "unavailable" {
  if (capability === "enforceable") return "enforced";
  if (capability === "observable") return "observed-only";
  return "unavailable";
}

function validateLimits(limits: ExecutionLimits): void {
  if (
    limits.maxWallTimeMs <= 0 ||
    !Number.isInteger(limits.maxRetries) ||
    limits.maxRetries < 0 ||
    !Number.isInteger(limits.maxRouterIterations) ||
    limits.maxRouterIterations <= 0
  ) {
    throw new RangeError("Execution limits must be positive and retries non-negative");
  }
}
