import {type BacklogService, type PlannedSlice, type WorkflowKind} from '@vpr/backlog';
import {type EntityId, type WorkFeatures} from '@vpr/contracts';
import {routeWork, type RouteWorkRequest} from '@vpr/core';

/** A designer's proposal; creating Tasks still requires a ready, confirmed Story. */
export interface TaskDraft {
  readonly slice: PlannedSlice;
  readonly features: WorkFeatures;
}
export async function materializeAndRouteTasks(service: BacklogService, storyId: EntityId,
  workflow: WorkflowKind, drafts: readonly TaskDraft[], template: Omit<RouteWorkRequest, 'features'>) {
  if (!drafts.length || drafts.some(draft => draft.features.designComplexity === null
    || draft.features.executionComplexity === null || draft.features.risk === null)) {
    throw new Error('Each Task needs independent manual design, execution and risk labels');
  }
  // Validate all decisions before mutating the backlog. Never inherit the parent's complexity.
  const decisions = drafts.map((draft, index) => routeWork({...template, features: draft.features,
    task: {...template.task, complexity: draft.features.executionComplexity!, risk: draft.features.risk!,
      taskSignature: template.task.taskSignature + ':draft:' + index,
      hasAcceptanceChecks: draft.slice.requiredChecks.length > 0}}));
  const tasks = await service.planTasks(storyId, workflow, drafts.map(draft => draft.slice));
  return tasks.map((task, index) => ({task, features: drafts[index]!.features, decision: decisions[index]!}));
}
