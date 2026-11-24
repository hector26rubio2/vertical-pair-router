import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowRoles, WorkflowCase } from "@vpr/runtime";
import type { ProjectProfileV1 } from "@vpr/config";
export async function loadWorkflowCases(
  root: string,
  policy: NonNullable<ProjectProfileV1["orchestration"]>,
): Promise<(request: WorkflowRoles) => WorkflowCase[]> {
  let text;
  try {
    text = await readFile(join(root, ".vpr/benchmarks/workflow-cases.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return () => [];
    throw error;
  }
  if (Buffer.byteLength(text) > 1048576) throw Error("Workflow case library exceeds 1 MiB");
  const library = JSON.parse(text) as { rows?: Record<string, unknown>[] };
  if (!Array.isArray(library.rows)) throw Error("Invalid workflow case library");
  const rows = library.rows;
  return (request) =>
    rows.flatMap((row) => {
      if (!row || typeof row.caseId !== "string" || typeof row.taskSignature !== "string")
        return [];
      const ids =
        row.plannerId === null
          ? [
              request.currentModelId,
              request.preferredExecutorId,
              ...(request.executorModelIds ?? []),
            ]
          : [
              request.preferredExecutorId,
              ...(request.executorModelIds ?? []),
              request.currentModelId,
            ];
      const executor = ids
        .map((id) =>
          policy.models.find(
            (model) =>
              model.id === id &&
              model.provider === row.executorProvider &&
              model.model === row.executorId &&
              (model.effort ?? "medium") === row.executorEffort,
          ),
        )
        .find(Boolean);
      const planner =
        row.plannerId === null
          ? null
          : policy.models.find(
              (model) =>
                [request.plannerId, request.advancedPlannerId].includes(model.id) &&
                model.provider === row.plannerProvider &&
                model.model === row.plannerId &&
                (model.effort ?? "medium") === row.plannerEffort,
            );
      if (!executor || planner === undefined) return [];
      const technical =
        row.technicalPlannerId == null
          ? null
          : policy.models.find(
              (model) =>
                model.id === request.technicalPlannerId &&
                model.provider === row.technicalPlannerProvider &&
                model.model === row.technicalPlannerId &&
                (model.effort ?? "medium") === row.technicalPlannerEffort,
            );
      if (technical === undefined) return [];
      const reviewer =
        row.reviewerId === undefined
          ? (technical ?? planner)
          : row.reviewerId === null
            ? null
            : policy.models.find(
                (model) =>
                  [
                    request.reviewerId,
                    request.technicalPlannerId,
                    request.plannerId,
                    request.advancedPlannerId,
                  ].includes(model.id) &&
                  model.provider === row.reviewerProvider &&
                  model.model === row.reviewerId &&
                  (model.effort ?? "medium") === row.reviewerEffort,
              );
      if (reviewer === undefined) return [];
      return [
        {
          ...row,
          executorId: executor.id,
          plannerId: planner?.id ?? null,
          technicalPlannerId: technical?.id ?? null,
          reviewerId: reviewer?.id ?? null,
        } as unknown as WorkflowCase,
      ];
    });
}
