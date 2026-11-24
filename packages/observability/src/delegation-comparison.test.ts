import assert from "node:assert/strict";
import test from "node:test";
import { compareDelegationArms, type ExperimentArm } from "./delegation-comparison.js";
const baseline: ExperimentArm = {
  storyId: "story",
  baseCommit: "base",
  acceptanceHash: "acceptance",
  checksHash: "checks",
  checksPassed: true,
  qualityAccepted: true,
  completeCoverage: true,
  executions: [
    {
      executionId: "one",
      role: "worker",
      usage: {
        provider: "claude",
        model: "sonnet",
        agentId: "main",
        parentAgentId: null,
        inputTokens: 1000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 100,
        scope: "session",
        source: "provider_reported",
      },
    },
  ],
};
test("accounts for all heterogeneous workers and coordinator, including negative savings", () => {
  const optimized: ExperimentArm = {
    ...baseline,
    executions: [
      {
        ...baseline.executions[0]!,
        executionId: "coordinator",
        role: "coordinator",
        usage: { ...baseline.executions[0]!.usage, inputTokens: 200, outputTokens: 100 },
      },
      ...["a", "b", "c"].map((executionId) => ({
        ...baseline.executions[0]!,
        executionId,
        usage: {
          ...baseline.executions[0]!.usage,
          model: "haiku",
          inputTokens: 300,
          outputTokens: 50,
        },
      })),
    ],
  };
  const result = compareDelegationArms(baseline, optimized);
  assert.equal(result.optimized.tokens, 1350);
  assert.equal(result.optimized.byRole.coordinator, 300);
  assert.equal(result.savedTokens, -250);
  assert.equal(result.modelMixChanged, true);
  assert.equal(result.monetarySavings, null);
});
test("rejects incomparable work, missing quality and duplicated receipts", () => {
  assert.throws(
    () => compareDelegationArms(baseline, { ...baseline, checksHash: "other" }),
    /identical/,
  );
  assert.throws(
    () => compareDelegationArms(baseline, { ...baseline, qualityAccepted: false }),
    /quality/,
  );
  assert.throws(
    () =>
      compareDelegationArms(baseline, {
        ...baseline,
        executions: [...baseline.executions, ...baseline.executions],
      }),
    /Duplicate/,
  );
});
