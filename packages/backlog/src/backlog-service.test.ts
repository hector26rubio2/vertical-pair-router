import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { EntityId } from "@vpr/contracts";
import { SqliteStorage } from "@vpr/storage-sqlite";

import {
  BacklogConflictError,
  BacklogService,
  ConfirmationRequiredError,
  createStoryDraftFromGrill,
  workflowCatalog
} from "./index.js";

const projectId = "project_phase_006" as EntityId;

function ids(): (prefix: string) => EntityId {
  let value = 0;
  return (prefix) => `${prefix}_${++value}` as EntityId;
}

test("previews, confirms, deduplicates and versions a Story", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-backlog-"));
  const storage = new SqliteStorage(join(root, "backlog.sqlite"));
  await storage.initialize();
  context.after(async () => {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const service = new BacklogService({
    projectId,
    storage,
    actor: "test",
    confirmation: "required",
    now: () => "2026-11-09T13:00:00.000Z",
    nextId: ids()
  });
  const draft = createStoryDraftFromGrill({
    projectId,
    title: "Route a vertical pair",
    need: "Choose an executor from verified capabilities.",
    desiredOutcome: "A deterministic route with evidence.",
    acceptanceCriteria: ["The same inputs select the same eligible executor."],
    exclusions: ["Provider billing."],
    openQuestions: [],
    attachments: []
  });

  const proposal = await service.previewStory(draft);
  assert.equal(proposal.action, "create");
  await assert.rejects(service.commitStory(proposal), ConfirmationRequiredError);
  const created = await service.commitStory(proposal, { confirmed: true });
  assert.equal(created.revision, 1);
  assert.equal(created.story.status, "READY");

  const duplicate = await service.previewStory({ ...draft, title: "  ROUTE a vertical pair " });
  assert.equal(duplicate.action, "duplicate");
  assert.equal(duplicate.duplicateOf, created.story.storyId);

  const patch = await service.previewStoryPatch(created.story.storyId, {
    expectedRevision: 1,
    desiredOutcome: "A deterministic, explainable route with evidence."
  });
  const updated = await service.commitStoryPatch(patch, { confirmed: true });
  assert.equal(updated.revision, 2);
  assert.equal((await service.getStoryVersions(created.story.storyId)).length, 2);

  const noOp = await service.previewStoryPatch(created.story.storyId, { expectedRevision: 2 });
  assert.equal(noOp.action, "none");

  await assert.rejects(
    service.commitStoryPatch({ ...patch, story: { ...patch.story, title: "stale" } }, { confirmed: true }),
    BacklogConflictError
  );
});

test("grill keeps ambiguous work in draft and does not invent Tasks", () => {
  const draft = createStoryDraftFromGrill({
    projectId,
    title: "Improve routing",
    need: "Routing should be better.",
    desiredOutcome: "Unknown until owner answers.",
    acceptanceCriteria: [],
    exclusions: [],
    openQuestions: ["Which routing failure matters?"],
    attachments: ["docs/optional-spec.md"]
  });
  assert.equal(draft.status, "DRAFT");
  assert.deepEqual(draft.openQuestions, ["Which routing failure matters?"]);
});

test("plans a valid vertical DAG for every supported workflow", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-backlog-"));
  const storage = new SqliteStorage(join(root, "backlog.sqlite"));
  await storage.initialize();
  context.after(async () => {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const service = new BacklogService({
    projectId,
    storage,
    actor: "test",
    confirmation: "auto",
    now: () => "2026-11-09T13:00:00.000Z",
    nextId: ids()
  });
  const story = await service.commitStory(await service.previewStory(createStoryDraftFromGrill({
    projectId,
    title: "Exercise workflow catalog",
    need: "Every workflow needs an executable plan.",
    desiredOutcome: "Valid vertical DAGs.",
    acceptanceCriteria: ["All catalog workflows produce a recoverable Task."],
    exclusions: [],
    openQuestions: [],
    attachments: []
  })));

  for (const workflow of Object.keys(workflowCatalog)) {
    const planned = await service.planTasks(story.story.storyId, workflow as keyof typeof workflowCatalog, [{
      outcome: `Deliver ${workflow} slice`,
      acceptanceCriteria: [`The ${workflow} slice is observable.`],
      demoPath: `vpr demo ${workflow}`,
      allowedPaths: ["packages/backlog"],
      requiredChecks: ["pnpm check"],
      risk: workflow === "infrastructure" ? "high" : "low",
      changesPublicApi: false,
      dependsOn: []
    }]);
    assert.equal(planned.length, 1);
    assert.equal(planned[0]?.workflow, workflow);
    assert.equal(planned[0]?.status, "READY");
    assert.equal(planned[0]?.requiresHumanReview, workflow === "infrastructure" || workflow === "bugfix-complex");
  }
});

test("recovers the same Story, Task and Run after reopening SQLite", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-backlog-"));
  const db = join(root, "backlog.sqlite");
  const firstStorage = new SqliteStorage(db);
  await firstStorage.initialize();
  const first = new BacklogService({
    projectId,
    storage: firstStorage,
    actor: "test",
    confirmation: "auto",
    now: () => "2026-11-09T13:00:00.000Z",
    nextId: ids()
  });
  const story = await first.commitStory(await first.previewStory(createStoryDraftFromGrill({
    projectId,
    title: "Persist backlog state",
    need: "Resume across process boundaries.",
    desiredOutcome: "The same aggregate is recovered.",
    acceptanceCriteria: ["Story, Task and Run survive reopen."],
    exclusions: [],
    openQuestions: [],
    attachments: []
  })));
  const [task] = await first.planTasks(story.story.storyId, "feature", [{
    outcome: "Persist one vertical slice",
    acceptanceCriteria: ["Reopen returns it."],
    demoPath: "vpr backlog show",
    allowedPaths: ["packages/backlog"],
    requiredChecks: ["pnpm check"],
    risk: "medium",
    changesPublicApi: true,
    dependsOn: []
  }]);
  assert.ok(task);
  assert.equal(task.requiresHumanReview, true);
  const handoff = await first.createPlanningHandoff(story.story.storyId);
  assert.equal(handoff.tasks.length, 1);
  assert.equal(handoff.requiresHumanReview, true);
  await first.transitionStory(story.story.storyId, "IN_PROGRESS");
  await first.transitionTask(task.taskId, "RUNNING");
  const run = await first.createRun(task.taskId);
  await first.transitionRun(run.runId, "ANALYZING");
  await firstStorage.close();

  const secondStorage = new SqliteStorage(db);
  await secondStorage.initialize();
  context.after(async () => {
    await secondStorage.close();
    await rm(root, { recursive: true, force: true });
  });
  const second = new BacklogService({
    projectId,
    storage: secondStorage,
    actor: "test",
    confirmation: "auto",
    now: () => "2026-11-09T14:00:00.000Z",
    nextId: ids()
  });

  assert.equal((await second.getStory(story.story.storyId))?.story.title, "Persist backlog state");
  assert.equal((await second.getStory(story.story.storyId))?.story.status, "IN_PROGRESS");
  assert.equal((await second.getTask(task.taskId))?.status, "RUNNING");
  assert.equal((await second.getRun(run.runId))?.state, "ANALYZING");
});

test("completing a Task promotes dependants whose prerequisites are complete", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-backlog-"));
  const storage = new SqliteStorage(join(root, "backlog.sqlite"));
  await storage.initialize();
  context.after(async () => {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const service = new BacklogService({
    projectId,
    storage,
    actor: "test",
    confirmation: "auto",
    now: () => "2026-11-09T13:00:00.000Z",
    nextId: ids()
  });
  const story = await service.commitStory(await service.previewStory(createStoryDraftFromGrill({
    projectId,
    title: "Promote DAG dependencies",
    need: "Only runnable Tasks should be READY.",
    desiredOutcome: "Dependants unlock after prerequisites.",
    acceptanceCriteria: ["Completing A makes B ready."],
    exclusions: [],
    openQuestions: [],
    attachments: []
  })));
  const tasks = await service.planTasks(story.story.storyId, "feature", [
    {
      outcome: "Deliver A",
      acceptanceCriteria: ["A is visible."],
      demoPath: "demo A",
      allowedPaths: ["a"],
      requiredChecks: ["test"],
      risk: "low",
      changesPublicApi: false,
      dependsOn: []
    },
    {
      outcome: "Deliver B",
      acceptanceCriteria: ["B is visible."],
      demoPath: "demo B",
      allowedPaths: ["b"],
      requiredChecks: ["test"],
      risk: "low",
      changesPublicApi: false,
      dependsOn: [0]
    }
  ]);
  assert.equal(tasks[1]?.status, "PENDING");
  await service.transitionTask(tasks[0]!.taskId, "RUNNING");
  await service.transitionTask(tasks[0]!.taskId, "COMPLETED");
  assert.equal((await service.getTask(tasks[1]!.taskId))?.status, "READY");
});
