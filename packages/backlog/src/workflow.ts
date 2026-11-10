import type { EntityId, Story } from "@vpr/contracts";

import type { StoryDraft, WorkflowKind } from "./backlog-service.js";

export const workflowCatalog = {
  feature: { objective: "Deliver observable user value", reviewRisk: "impact-dependent" },
  "bugfix-simple": { objective: "Reproduce, fix and prove one defect", reviewRisk: "standard" },
  "bugfix-complex": { objective: "Diagnose before fixing a non-obvious defect", reviewRisk: "high" },
  refactor: { objective: "Change structure while preserving behavior", reviewRisk: "standard" },
  documentation: { objective: "Make verified behavior understandable", reviewRisk: "standard" },
  infrastructure: { objective: "Change delivery/runtime controls safely", reviewRisk: "high" },
  research: { objective: "Answer a bounded question with evidence", reviewRisk: "impact-dependent" }
} as const satisfies Readonly<Record<WorkflowKind, { objective: string; reviewRisk: string }>>;

export interface GrillResult {
  readonly projectId: EntityId;
  readonly title: string;
  readonly need: string;
  readonly desiredOutcome: string;
  readonly acceptanceCriteria: readonly string[];
  readonly exclusions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly attachments: readonly string[];
}

export function createStoryDraftFromGrill(result: GrillResult): StoryDraft {
  return {
    ...result,
    status: isReady(result) ? "READY" : "DRAFT"
  };
}

function isReady(result: Pick<Story, "acceptanceCriteria" | "openQuestions">): boolean {
  return result.acceptanceCriteria.length > 0 && result.openQuestions.length === 0;
}
