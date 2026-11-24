import test from 'node:test';
import assert from 'node:assert/strict';
import {materializeAndRouteTasks} from '@vpr/experiments';
import {BacklogService, createStoryDraftFromGrill} from '@vpr/backlog';
import {SqliteStorage} from '@vpr/storage-sqlite';
import {fixture} from './fixtures/evidence.mjs';
import {readFileSync} from 'node:fs';
import {loadRoutingPolicy} from '@vpr/config';
test('designer tasks are created through BacklogService and independently routed from manual execution labels', async () => {
  const storage = new SqliteStorage(':memory:'); await storage.initialize(); let id = 0;
  try {
    const service = new BacklogService({projectId: 'project_experiment', storage, actor: 'experiment',
      confirmation: 'required', now: () => '2026-11-19T00:00:00Z', nextId: prefix => `${prefix}_${++id}`});
    const proposal = await service.previewStory(createStoryDraftFromGrill({projectId: 'project_experiment',
      title: 'Fix ledger', need: 'Stable identities', desiredOutcome: 'No duplicates',
      acceptanceCriteria: ['Duplicate regression passes'], exclusions: [], openQuestions: [], attachments: []}));
    const created = await service.commitStory(proposal, {confirmed: true});
    const original = JSON.parse(readFileSync(new URL('./fixtures/routing-characterization.json', import.meta.url)))
      .find(row => row.fn === 'routeWorkflow');
    const policy = await loadRoutingPolicy(new URL('../.vpr/routing-policy.yaml', import.meta.url));
    const slice = {outcome: 'Fix identity', acceptanceCriteria: ['Duplicate regression passes'],
      demoPath: 'ledger demo', allowedPaths: ['src/ledger.ts'], requiredChecks: ['test'],
      risk: 'medium', changesPublicApi: false, dependsOn: []};
    const template = {policy, agentPolicy: original.args[0], task: original.args[1],
      protocol: 'hierarchical-v1', acceptanceContractHash: 'a'.repeat(64), evidence: []};
    const result = await materializeAndRouteTasks(service, created.story.storyId, 'bugfix-complex', [
      {slice, features: fixture().features},
      {slice: {...slice, outcome: 'Review compatibility', dependsOn: [0]},
        features: {...fixture().features, executionComplexity: 'normal'}},
    ], template);
    assert.equal((await service.listTasks()).length, 2);
    assert.equal(result[0].features.executionComplexity, 'simple');
    assert.equal(result[1].features.executionComplexity, 'normal');
    assert.deepEqual(result[1].task.dependencies, [result[0].task.taskId]);
    assert.equal(result[0].decision.mode, 'shadow');
    assert.equal(result[0].decision.dispatchPerformed, false);
  } finally {await storage.close();}
});
