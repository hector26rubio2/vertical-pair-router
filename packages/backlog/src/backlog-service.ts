import type {
  DomainEvent,
  EntityId,
  IdPrefix,
  Run,
  RunState,
  StorageAdapter,
  Story,
  Task
} from "@vpr/contracts";
import { transitionRun as applyRunTransition } from "@vpr/core";

export type WorkflowKind = Task["workflow"];

export type StoryDraft = Omit<Story, "storyId" | "createdAt" | "updatedAt">;

export interface StoryPatch {
  readonly expectedRevision: number;
  readonly title?: string;
  readonly need?: string;
  readonly desiredOutcome?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly exclusions?: readonly string[];
  readonly openQuestions?: readonly string[];
  readonly attachments?: readonly string[];
}

export interface StoryRecord {
  readonly story: Story;
  readonly revision: number;
}

export interface StoryProposal {
  readonly action: "create" | "duplicate";
  readonly story: Story;
  readonly duplicateOf?: EntityId;
  readonly observedEventCount: number;
}

export interface StoryPatchProposal {
  readonly action: "update" | "none";
  readonly story: Story;
  readonly expectedRevision: number;
}

export interface PlannedSlice {
  readonly outcome: string;
  readonly acceptanceCriteria: readonly string[];
  readonly demoPath: string;
  readonly allowedPaths: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly risk: "low" | "medium" | "high";
  readonly changesPublicApi: boolean;
  readonly dependsOn: readonly number[];
}

export interface PlanningHandoff {
  readonly storyId: EntityId;
  readonly storyRevision: number;
  readonly tasks: readonly EntityId[];
  readonly requiresHumanReview: boolean;
  readonly nextAction: string;
}

export interface BacklogServiceOptions {
  readonly projectId: EntityId;
  readonly storage: StorageAdapter;
  readonly actor: string;
  readonly confirmation: "required" | "auto";
  readonly now: () => string;
  readonly nextId: (prefix: IdPrefix) => EntityId;
}

export class ConfirmationRequiredError extends Error {
  public constructor() {
    super("Backlog mutation requires explicit confirmation");
    this.name = "ConfirmationRequiredError";
  }
}

export class BacklogConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BacklogConflictError";
  }
}

interface BacklogState {
  readonly stories: Map<EntityId, StoryRecord>;
  readonly storyVersions: Map<EntityId, StoryRecord[]>;
  readonly tasks: Map<EntityId, Task>;
  readonly runs: Map<EntityId, Run>;
  readonly eventCount: number;
}

export class BacklogService {
  readonly #options: BacklogServiceOptions;

  public constructor(options: BacklogServiceOptions) {
    this.#options = options;
  }

  public async previewStory(draft: StoryDraft): Promise<StoryProposal> {
    validateStoryDraft(draft);
    const state = await this.#readState();
    const duplicate = [...state.stories.values()].find(
      ({ story }) => normalize(story.title) === normalize(draft.title)
    );
    const now = this.#options.now();
    return {
      action: duplicate === undefined ? "create" : "duplicate",
      story: {
        ...draft,
        storyId: this.#options.nextId("story"),
        createdAt: now,
        updatedAt: now
      },
      ...(duplicate === undefined ? {} : { duplicateOf: duplicate.story.storyId }),
      observedEventCount: state.eventCount
    };
  }

  public async commitStory(
    proposal: StoryProposal,
    options: { readonly confirmed?: boolean } = {}
  ): Promise<StoryRecord> {
    this.#requireConfirmation(options.confirmed);
    const state = await this.#readState();
    if (proposal.action === "duplicate") {
      const existing = proposal.duplicateOf === undefined
        ? undefined
        : state.stories.get(proposal.duplicateOf);
      if (existing === undefined) throw new BacklogConflictError("Duplicate Story no longer exists");
      return existing;
    }
    if (state.eventCount !== proposal.observedEventCount) {
      throw new BacklogConflictError("Backlog changed after Story preview");
    }
    const record = { story: proposal.story, revision: 1 } as const;
    await this.#append("backlog.story.created", { record }, {
      storyId: proposal.story.storyId
    });
    return record;
  }

  public async previewStoryPatch(
    storyId: EntityId,
    patch: StoryPatch
  ): Promise<StoryPatchProposal> {
    const record = await this.getStory(storyId);
    if (record === undefined) throw new RangeError(`Unknown Story: ${storyId}`);
    if (record.revision !== patch.expectedRevision) {
      throw new BacklogConflictError(`Expected Story revision ${patch.expectedRevision}, got ${record.revision}`);
    }
    const candidate: Story = {
      ...record.story,
      ...withoutExpectedRevision(patch),
      status: record.story.status === "DRAFT" || record.story.status === "READY"
        ? deriveStoryStatus(patch.openQuestions ?? record.story.openQuestions, patch.acceptanceCriteria ?? record.story.acceptanceCriteria)
        : record.story.status
    };
    const changed = !equalStory(candidate, record.story);
    const story = changed ? { ...candidate, updatedAt: this.#options.now() } : record.story;
    return {
      action: changed ? "update" : "none",
      story,
      expectedRevision: patch.expectedRevision
    };
  }

  public async commitStoryPatch(
    proposal: StoryPatchProposal,
    options: { readonly confirmed?: boolean } = {}
  ): Promise<StoryRecord> {
    this.#requireConfirmation(options.confirmed);
    const current = await this.getStory(proposal.story.storyId);
    if (current === undefined || current.revision !== proposal.expectedRevision) {
      throw new BacklogConflictError("Story changed after patch preview");
    }
    if (proposal.action === "none") return current;
    validateStoryDraft(proposal.story);
    const record = { story: proposal.story, revision: current.revision + 1 } as const;
    await this.#append("backlog.story.updated", { record }, { storyId: proposal.story.storyId });
    return record;
  }

  public async getStory(storyId: EntityId): Promise<StoryRecord | undefined> {
    return (await this.#readState()).stories.get(storyId);
  }

  public async listStories(): Promise<readonly StoryRecord[]> {
    return [...(await this.#readState()).stories.values()];
  }

  public async getStoryVersions(storyId: EntityId): Promise<readonly StoryRecord[]> {
    return (await this.#readState()).storyVersions.get(storyId) ?? [];
  }

  public async planTasks(
    storyId: EntityId,
    workflow: WorkflowKind,
    slices: readonly PlannedSlice[]
  ): Promise<readonly Task[]> {
    const story = await this.getStory(storyId);
    if (story === undefined) throw new RangeError(`Unknown Story: ${storyId}`);
    if (story.story.status !== "READY" && story.story.status !== "IN_PROGRESS") {
      throw new BacklogConflictError("Tasks require a Story with resolved questions and acceptance criteria");
    }
    validateSlices(slices);
    const ids = slices.map(() => this.#options.nextId("task"));
    const tasks = slices.map<Task>((slice, index) => ({
      taskId: ids[index]!,
      storyId,
      outcome: slice.outcome,
      acceptanceCriteria: [...slice.acceptanceCriteria],
      dependencies: slice.dependsOn.map((dependency) => ids[dependency]!),
      allowedPaths: [...slice.allowedPaths],
      requiredChecks: [...slice.requiredChecks],
      workflow,
      demoPath: slice.demoPath,
      requiresHumanReview:
        slice.risk === "high" ||
        slice.changesPublicApi ||
        workflow === "infrastructure" ||
        workflow === "bugfix-complex",
      status: slice.dependsOn.length === 0 ? "READY" : "PENDING"
    }));
    for (const task of tasks) {
      await this.#append("backlog.task.created", { task }, { storyId, taskId: task.taskId });
    }
    return tasks;
  }

  public async getTask(taskId: EntityId): Promise<Task | undefined> {
    return (await this.#readState()).tasks.get(taskId);
  }

  public async listTasks(storyId?: EntityId): Promise<readonly Task[]> {
    const tasks = [...(await this.#readState()).tasks.values()];
    return storyId === undefined ? tasks : tasks.filter((task) => task.storyId === storyId);
  }

  public async transitionStory(
    storyId: EntityId,
    to: Story["status"]
  ): Promise<StoryRecord> {
    const current = await this.getStory(storyId);
    if (current === undefined) throw new RangeError(`Unknown Story: ${storyId}`);
    const allowed: Readonly<Record<Story["status"], readonly Story["status"][]>> = {
      DRAFT: ["READY", "BLOCKED"],
      READY: ["IN_PROGRESS", "BLOCKED"],
      IN_PROGRESS: ["COMPLETED", "BLOCKED"],
      COMPLETED: [],
      BLOCKED: ["DRAFT", "READY", "IN_PROGRESS"]
    };
    if (!allowed[current.story.status].includes(to)) {
      throw new BacklogConflictError(`Invalid Story transition: ${current.story.status} -> ${to}`);
    }
    if (to === "READY" && deriveStoryStatus(current.story.openQuestions, current.story.acceptanceCriteria) !== "READY") {
      throw new BacklogConflictError("A Story with unresolved questions cannot become READY");
    }
    const record = {
      story: { ...current.story, status: to, updatedAt: this.#options.now() },
      revision: current.revision + 1
    } as const;
    await this.#append("backlog.story.updated", { record }, { storyId });
    return record;
  }

  public async transitionTask(taskId: EntityId, to: Task["status"]): Promise<Task> {
    const state = await this.#readState();
    const current = state.tasks.get(taskId);
    if (current === undefined) throw new RangeError(`Unknown Task: ${taskId}`);
    const allowed: Readonly<Record<Task["status"], readonly Task["status"][]>> = {
      PENDING: ["READY", "BLOCKED"],
      READY: ["RUNNING", "BLOCKED"],
      RUNNING: ["COMPLETED", "BLOCKED"],
      COMPLETED: [],
      BLOCKED: ["READY"]
    };
    if (!allowed[current.status].includes(to)) {
      throw new BacklogConflictError(`Invalid Task transition: ${current.status} -> ${to}`);
    }
    if (to === "READY" && !current.dependencies.every(
      (dependency) => state.tasks.get(dependency)?.status === "COMPLETED"
    )) {
      throw new BacklogConflictError("A Task cannot become READY before its dependencies complete");
    }
    const task = { ...current, status: to };
    await this.#append("backlog.task.updated", { task }, { storyId: task.storyId, taskId });
    if (to === "COMPLETED") await this.#promoteDependants(taskId);
    return task;
  }

  public async createPlanningHandoff(storyId: EntityId): Promise<PlanningHandoff> {
    const story = await this.getStory(storyId);
    if (story === undefined) throw new RangeError(`Unknown Story: ${storyId}`);
    const tasks = await this.listTasks(storyId);
    return {
      storyId,
      storyRevision: story.revision,
      tasks: tasks.map((task) => task.taskId),
      requiresHumanReview: tasks.some((task) => task.requiresHumanReview),
      nextAction: "Validate Story revision and Task DAG, then create a Run for a READY Task."
    };
  }

  public async createRun(taskId: EntityId): Promise<Run> {
    const task = await this.getTask(taskId);
    if (task === undefined) throw new RangeError(`Unknown Task: ${taskId}`);
    if (task.status !== "READY" && task.status !== "RUNNING") {
      throw new BacklogConflictError(`Cannot create a Run for Task in ${task.status}`);
    }
    const now = this.#options.now();
    const run: Run = {
      runId: this.#options.nextId("run"),
      taskId,
      state: "PENDING",
      revision: 0,
      createdAt: now,
      updatedAt: now
    };
    await this.#append("backlog.run.created", { run }, { taskId, runId: run.runId });
    return run;
  }

  public async transitionRun(runId: EntityId, to: RunState): Promise<Run> {
    const current = await this.getRun(runId);
    if (current === undefined) throw new RangeError(`Unknown Run: ${runId}`);
    const run = applyRunTransition(current, to, this.#options.now());
    await this.#append("backlog.run.transitioned", { run }, { taskId: run.taskId, runId });
    return run;
  }

  public async getRun(runId: EntityId): Promise<Run | undefined> {
    return (await this.#readState()).runs.get(runId);
  }

  async #promoteDependants(completedTaskId: EntityId): Promise<void> {
    const state = await this.#readState();
    for (const candidate of state.tasks.values()) {
      if (candidate.status !== "PENDING" || !candidate.dependencies.includes(completedTaskId)) continue;
      const ready = candidate.dependencies.every(
        (dependency) => state.tasks.get(dependency)?.status === "COMPLETED"
      );
      if (ready) {
        const task = { ...candidate, status: "READY" as const };
        await this.#append("backlog.task.updated", { task }, {
          storyId: task.storyId,
          taskId: task.taskId
        });
      }
    }
  }

  async #append(
    type: string,
    payload: Readonly<Record<string, unknown>>,
    ids: { readonly storyId?: EntityId; readonly taskId?: EntityId; readonly runId?: EntityId }
  ): Promise<void> {
    const event: DomainEvent = {
      schemaVersion: 1,
      eventId: this.#options.nextId("evt"),
      occurredAt: this.#options.now(),
      projectId: this.#options.projectId,
      ...ids,
      actor: this.#options.actor,
      type,
      payload
    };
    await this.#options.storage.appendEvent(event);
  }

  async #readState(): Promise<BacklogState> {
    const events = await this.#options.storage.readEvents(this.#options.projectId);
    const stories = new Map<EntityId, StoryRecord>();
    const storyVersions = new Map<EntityId, StoryRecord[]>();
    const tasks = new Map<EntityId, Task>();
    const runs = new Map<EntityId, Run>();
    for (const event of events) {
      if (event.type === "backlog.story.created" || event.type === "backlog.story.updated") {
        const record = event.payload.record as StoryRecord;
        stories.set(record.story.storyId, record);
        const versions = storyVersions.get(record.story.storyId) ?? [];
        versions.push(record);
        storyVersions.set(record.story.storyId, versions);
      } else if (event.type === "backlog.task.created" || event.type === "backlog.task.updated") {
        const task = event.payload.task as Task;
        tasks.set(task.taskId, task);
      } else if (event.type === "backlog.run.created" || event.type === "backlog.run.transitioned") {
        const run = event.payload.run as Run;
        runs.set(run.runId, run);
      }
    }
    return { stories, storyVersions, tasks, runs, eventCount: events.length };
  }

  #requireConfirmation(confirmed: boolean | undefined): void {
    if (this.#options.confirmation === "required" && confirmed !== true) {
      throw new ConfirmationRequiredError();
    }
  }
}

function validateStoryDraft(draft: StoryDraft | Story): void {
  for (const [name, value] of [
    ["title", draft.title],
    ["need", draft.need],
    ["desiredOutcome", draft.desiredOutcome]
  ] as const) {
    if (value.trim().length === 0) throw new TypeError(`${name} is required`);
  }
  const expected = deriveStoryStatus(draft.openQuestions, draft.acceptanceCriteria);
  if (draft.status === "DRAFT" || draft.status === "READY") {
    if (draft.status !== expected) throw new TypeError(`Story status must be ${expected}`);
  }
}

function deriveStoryStatus(
  openQuestions: readonly string[],
  acceptanceCriteria: readonly string[]
): "DRAFT" | "READY" {
  return acceptanceCriteria.length > 0 && openQuestions.length === 0 ? "READY" : "DRAFT";
}

function withoutExpectedRevision(patch: StoryPatch): Omit<StoryPatch, "expectedRevision"> {
  const { expectedRevision: _ignored, ...fields } = patch;
  return fields;
}

function equalStory(left: Story, right: Story): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function validateSlices(slices: readonly PlannedSlice[]): void {
  if (slices.length === 0) throw new TypeError("At least one vertical slice is required");
  slices.forEach((slice, index) => {
    if (slice.outcome.trim().length === 0 || slice.demoPath.trim().length === 0) {
      throw new TypeError(`Task ${index} requires an outcome and demo path`);
    }
    if (slice.acceptanceCriteria.length === 0 || slice.requiredChecks.length === 0) {
      throw new TypeError(`Task ${index} requires falsifiable acceptance and checks`);
    }
    for (const dependency of slice.dependsOn) {
      if (!Number.isInteger(dependency) || dependency < 0 || dependency >= slices.length || dependency === index) {
        throw new RangeError(`Invalid dependency ${dependency} for Task ${index}`);
      }
    }
  });
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number): void => {
    if (visiting.has(index)) throw new BacklogConflictError("Task dependency graph contains a cycle");
    if (visited.has(index)) return;
    visiting.add(index);
    for (const dependency of slices[index]!.dependsOn) visit(dependency);
    visiting.delete(index);
    visited.add(index);
  };
  slices.forEach((_slice, index) => visit(index));
}
