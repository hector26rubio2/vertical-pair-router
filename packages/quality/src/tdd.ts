import type { QualityCheckEvidence } from "./check-catalog.js";

export type TddEntry =
  | {
      readonly stage: "RED" | "GREEN" | "REFACTOR";
      readonly testReference: string;
      readonly evidence: QualityCheckEvidence;
    }
  | { readonly stage: "NOT_APPLICABLE"; readonly reason: string };

export type TddMethod =
  | { readonly status: "TDD"; readonly entries: readonly TddEntry[] }
  | { readonly status: "NOT_APPLICABLE"; readonly reason: string };

export function recordTddMethod(entries: readonly TddEntry[]): TddMethod {
  if (entries.length === 1 && entries[0]?.stage === "NOT_APPLICABLE") {
    if (entries[0].reason.trim().length < 10) {
      throw new TypeError("NOT_APPLICABLE requires a specific reason");
    }
    return { status: "NOT_APPLICABLE", reason: entries[0].reason };
  }
  if (entries.some((entry) => entry.stage === "NOT_APPLICABLE")) {
    throw new TypeError("NOT_APPLICABLE cannot be mixed with TDD evidence");
  }
  const executable = entries as readonly Extract<TddEntry, { stage: "RED" | "GREEN" | "REFACTOR" }>[];
  const red = executable[0];
  const green = executable[1];
  if (red?.stage !== "RED" || red.evidence.status !== "failed" || red.evidence.source !== "measured") {
    throw new TypeError("TDD RED must be a real failing check");
  }
  if (
    green?.stage !== "GREEN" ||
    green.evidence.status !== "passed" ||
    green.evidence.source !== "measured" ||
    green.testReference !== red.testReference
  ) {
    throw new TypeError("TDD GREEN must pass the same referenced test");
  }
  for (const refactor of executable.slice(2)) {
    if (
      refactor.stage !== "REFACTOR" ||
      refactor.evidence.status !== "passed" ||
      refactor.evidence.source !== "measured" ||
      refactor.testReference !== red.testReference
    ) {
      throw new TypeError("TDD REFACTOR must keep the referenced test green");
    }
  }
  return { status: "TDD", entries: [...entries] };
}

export interface RegressionAssessment {
  readonly useful: boolean;
  readonly warnings: readonly string[];
}

export function assessRegressionTest(input: {
  readonly bugReproducible: boolean;
  readonly assertionTargetsObservableBehavior: boolean;
  readonly mocksInternalImplementation: boolean;
  readonly expectedDerivedFromActual: boolean;
}): RegressionAssessment {
  const warnings: string[] = [];
  if (!input.bugReproducible) warnings.push("The defect is not independently reproducible.");
  if (!input.assertionTargetsObservableBehavior) warnings.push("The assertion does not target observable behavior.");
  if (input.mocksInternalImplementation) warnings.push("The test mocks internal implementation details.");
  if (input.expectedDerivedFromActual) warnings.push("The expectation is tautological because it derives from actual output.");
  return { useful: warnings.length === 0, warnings };
}
