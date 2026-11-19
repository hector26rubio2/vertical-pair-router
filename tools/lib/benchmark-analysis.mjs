import { executionBlocker, qualityEvidence } from "./benchmark-quality.mjs";
export { executionBlocker } from "./benchmark-quality.mjs";
const baseArm = (row) => row.strategyArm ?? row.arm.replace(/-(?:attempt|repeat)-\d+$/u, "");
const bounded = (value) => Number.isFinite(value) && value >= 0;
export function comparisonSelection(task, rows) {
  const all = rows.filter((row) => row.taskId === task.id);
  const technical = (row) => {
    const phases = row.phases ?? [];
    return phases.some(
      (phase) =>
        ["provider-limit", "context-guard-unverified"].includes(phase.receipt?.stopped) ||
        /VPR:.*(?:context|count)|hit your.*limit/iu.test(phase.answer ?? ""),
    );
  };
  const oldContext = (row) =>
    (row.models ?? []).some(
      (model) => model.model?.includes("haiku") && contextEvidence(row, model).observedMax >= 90000,
    );
  const comparable = all.filter((row) => !technical(row) && !oldContext(row));
  const corrected = comparable.some(
    (row) => row.validationPolicy === "common-review-up-to-one-correction",
  );
  const selected = corrected
    ? comparable.filter((row) => row.validationPolicy === "common-review-up-to-one-correction")
    : comparable;
  return {
    selected,
    excluded: all.filter((row) => !selected.includes(row)),
    policy: corrected
      ? "common-review-up-to-one-correction"
      : task.protocol === "staged-recipe-v1"
        ? "common-review-first-pass"
        : "legacy-contract",
    technicalBlocked: all.filter(technical).length,
  };
}
export function contextEvidence(row, model) {
  const requests = (row.receipt?.requests ?? []).filter((request) => request.model === model.model);
  const valid = requests.filter((request) =>
    ["inputTokens", "cacheReadTokens", "cacheWriteTokens"].every((key) => bounded(request[key])),
  );
  const max = valid.length
    ? Math.max(
        ...valid.map(
          (request) => request.inputTokens + request.cacheReadTokens + request.cacheWriteTokens,
        ),
      )
    : null;
  return {
    observedMax: max ?? model.maxObservedPromptTokens ?? null,
    upperBound:
      model.cost?.contextPromptUpperBound ??
      (model.provider === "codex" &&
      [model.inputTokens, model.cacheReadTokens, model.cacheWriteTokens].every(bounded)
        ? model.inputTokens + model.cacheReadTokens + model.cacheWriteTokens
        : null),
    completePromptCoverage: model.cost?.perRequestPromptCoverage === true,
    requestCount: valid.length || null,
  };
}
function summarizeStrategy(arm, selected, task) {
  const samples = selected.filter((row) => baseArm(row) === arm);
  const accepted = samples.filter((row) => row.status === "accepted");
  const qualityAccepted = samples.filter((row) => qualityEvidence(row, task).qualified);
  const freshReviews = samples.filter((row) => qualityEvidence(row, task).freshReview).length;
  const complete = samples.every((row) => row.totalCost && row.receipt?.completeAccounting);
  const conditional = samples.some((row) =>
    row.models.some((model) => model.cost?.modelIdentityCaveat),
  );
  const cost =
    complete && accepted.length
      ? {
          min: samples.reduce((s, r) => s + r.totalCost.min, 0) / accepted.length,
          max: samples.reduce((s, r) => s + r.totalCost.max, 0) / accepted.length,
        }
      : null;
  const qualityCost =
    complete && qualityAccepted.length
      ? {
          min: samples.reduce((s, r) => s + r.totalCost.min, 0) / qualityAccepted.length,
          max: samples.reduce((s, r) => s + r.totalCost.max, 0) / qualityAccepted.length,
        }
      : null;
  const wall = accepted.map((row) => {
    const agent = row.receipt?.timings?.wallMs;
    return bounded(agent)
      ? agent +
          (row.localChecksTotalMs ??
            (row.checks?.own?.durationMs ?? 0) + (row.checks?.external?.durationMs ?? 0))
      : null;
  });
  return {
    arm,
    attempts: samples.length,
    accepted: accepted.length,
    acceptanceRate: accepted.length / samples.length,
    qualityAccepted: qualityAccepted.length,
    qualityAcceptanceRate: qualityAccepted.length / samples.length,
    costPerQualityAccepted: qualityCost,
    costPerAccepted: cost,
    conditional,
    accountingComplete: complete,
    meanAcceptedMs:
      wall.length && wall.every((value) => value !== null)
        ? wall.reduce((s, v) => s + v, 0) / wall.length
        : null,
    semanticReview: samples.some(
      (row) =>
        (row.semanticReview && row.semanticReview !== "passed") ||
        row.qualityReview?.findings?.some((f) =>
          ["critical", "high", "medium"].includes(f.severity),
        ),
    )
      ? "pending-or-failed"
      : samples.every((row) => row.semanticReview === "passed")
        ? "passed"
        : "not-measured",
    independentCodeReview:
      freshReviews === samples.length
        ? "fresh-model-review"
        : freshReviews
          ? "partial-fresh-model-review"
          : "not-measured",
    securityAssessment: "not-measured",
    maintainabilityAssessment: "not-measured",
    contexts: samples.flatMap((row, index) =>
      row.models.map((model) => ({
        attempt: index + 1,
        model: model.model,
        ...contextEvidence(row, model),
      })),
    ),
  };
}

export function analyzeTask(task, rows) {
  const selection = comparisonSelection(task, rows),
    selected = selection.selected;
  const hashes = new Set(selected.map((row) => row.acceptanceHash).filter(Boolean));
  const contractConflict = hashes.size > 1;
  const strategies = [...new Set(selected.map(baseArm))].map((arm) =>
    summarizeStrategy(arm, selected, task),
  );
  const candidates = strategies.filter(
    (s) =>
      s.qualityAccepted &&
      s.costPerQualityAccepted &&
      !s.conditional &&
      !contractConflict &&
      s.qualityAcceptanceRate >= 0.8 &&
      s.semanticReview === "passed",
  );
  const cheapest = [...candidates].sort(
    (a, b) => a.costPerQualityAccepted.max - b.costPerQualityAccepted.max,
  )[0];
  const conditionalCandidate = !contractConflict
    ? [...strategies]
        .filter(
          (s) =>
            s.conditional &&
            s.qualityAccepted &&
            s.costPerQualityAccepted &&
            s.qualityAcceptanceRate >= 0.8 &&
            s.semanticReview === "passed",
        )
        .sort((a, b) => a.costPerQualityAccepted.max - b.costPerQualityAccepted.max)[0]
    : null;
  const fastest = [...strategies]
    .filter((s) => s.qualityAccepted && s.semanticReview === "passed" && s.meanAcceptedMs !== null)
    .sort((a, b) => a.meanAcceptedMs - b.meanAcceptedMs)[0];
  const expected =
    task.expectedArms ??
    (task.id === "R01"
      ? ["sonnet-codex-6-luna", "sonnet-codex-6.1-terra", "sonnet-codex-6.1-sol"]
      : [
          "haiku-solo",
          "sonnet-solo",
          "sonnet-haiku",
          "opus-solo",
          "opus-haiku",
          ...(task.id === "F01"
            ? ["sonnet", "opus"].flatMap((planner) =>
                ["6-luna", "6.1-terra", "6.1-sol"].map((model) => planner + "-codex-" + model),
              )
            : []),
        ]);
  const missing = expected.filter((arm) => !strategies.some((s) => s.arm === arm));
  const nextTrial = selected
    .filter(
      (row) =>
        row.status === "accepted" &&
        row.semanticReview === "reviewed-draft" &&
        row.receipt?.completeAccounting &&
        row.totalCost &&
        !contractConflict,
    )
    .sort((a, b) => a.totalCost.max - b.totalCost.max)[0];
  return {
    taskId: task.id,
    contractConflict,
    strategies,
    comparisonPolicy: selection.policy,
    excludedTrials: selection.excluded.length,
    technicalBlocked: selection.technicalBlocked,
    cheapestObserved: cheapest?.arm ?? null,
    fastestObserved: fastest?.arm ?? null,
    conditionalEngineeringCandidate: conditionalCandidate
      ? {
          arm: conditionalCandidate.arm,
          cost: conditionalCandidate.costPerQualityAccepted,
          basis:
            "Accepted bounded engineering contract, conditional requested model pricing; repeat and verify identity before default routing.",
        }
      : null,
    nextTrialCandidate: nextTrial
      ? {
          arm: baseArm(nextTrial),
          cost: nextTrial.totalCost,
          priceConditional: nextTrial.models.some((model) => model.cost?.modelIdentityCaveat),
          basis:
            "Next trial among coordinator-reviewed drafts; not approved engineering quality or autonomous optimal routing",
        }
      : null,
    missing,
    attemptedNotQualified: strategies.filter((s) => !s.qualityAccepted).map((s) => s.arm),
    comparativeConfidence: contractConflict
      ? "incompatible-contracts"
      : candidates.length > 1 && candidates.every((s) => s.attempts >= 3) && !missing.length
        ? "repeated-bounded-tests"
        : "exploratory",
    qualityConclusion:
      "Only acceptance of the measured contract is established; equal general code quality is not established.",
    recommendedRoute: cheapest
      ? "Bounded quality-reviewed candidate: " + cheapest.arm + "; repeat before default routing."
      : "No confirmed engineering winner. Do not infer executor quality from model tier or token cost.",
  };
}
