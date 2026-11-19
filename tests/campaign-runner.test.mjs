import test from 'node:test';
import assert from 'node:assert/strict';
import {runFactorialCampaign, runHierarchicalTrial} from '@vpr/experiments';
import {fixture} from './fixtures/evidence.mjs';
const handoff = {schemaVersion: 1, goal: 'Preserve identity', immutableContracts: ['post(key, amount)'],
  invariants: ['Stable identity'], allowedFiles: ['src/ledger.ts'], acceptanceTests: ['duplicate test'],
  escalationConditions: ['Public API change'], limits: {turns: 10, wallMs: 5000, inputContextTokens: 85000},
  contextPack: {id: 'pack-1', sha256: 'a'.repeat(64)}};
function ports() {
  const seen = [], saved = []; let sequence = 0;
  return {mode: 'simulation', seen, saved,
    persist: async row => {saved.push(row);},
    phase: async input => {
      seen.push(input);
      const record = {...fixture('phase-' + ++sequence), runId: 'session-' + sequence,
        model: input.model, phase: input.phase, turns: 1};
      return {status: 'passed', record, handoff: input.phase === 'design' ? handoff : undefined};
    },
  };
}
test('factorial designs once per designer and sends the same frozen bytes to each randomized execution', async () => {
  const p = ports();
  const result = await runFactorialCampaign({taskId: 'F02', designers: ['sonnet', 'opus'],
    executors: ['haiku', 'sonnet', 'terra'], reviewer: 'sonnet', repetitions: 3, seed: 42,
    cacheConditions: ['cold-requested'], limits: handoff.limits}, p);
  assert.equal(p.seen.filter(r => r.phase === 'design').length, 2);
  assert.equal(result.trials.length, 18); assert.equal(p.seen.filter(r => r.phase === 'review').length, 18);
  for (const designer of ['sonnet', 'opus']) {
    const runs = p.seen.filter(r => r.phase === 'implement' && r.designer === designer);
    assert.equal(new Set(runs.map(r => r.frozenPlan.artifact)).size, 1);
  }
  assert.equal(result.designAllocations[0].actualConsumers, 9);
  assert.equal(result.completeAccounting, true); assert.equal(result.status, 'simulation');
});
test('native phase is never invoked without explicit campaign approval', async () => {
  const p = ports(); p.mode = 'native';
  await assert.rejects(runFactorialCampaign({taskId: 'F02', designers: ['sonnet'], executors: ['haiku'],
    reviewer: 'sonnet', repetitions: 3, seed: 1, cacheConditions: ['cold-requested'], limits: handoff.limits}, p), /approval/);
  assert.equal(p.seen.length, 0);
});
test('one repair maximum and a fresh review are included in accounting', async () => {
  const p = ports(), normal = p.phase;
  p.phase = async input => {
    const value = await normal(input);
    return input.phase === 'implement' || (input.phase === 'review' && !input.repaired)
      ? {...value, status: 'failed'} : value;
  };
  const result = await runFactorialCampaign({taskId: 'F02', designers: ['sonnet'], executors: ['haiku'],
    reviewer: 'sonnet', repetitions: 3, seed: 1, cacheConditions: ['cold-requested'], limits: handoff.limits}, p);
  assert.equal(p.seen.filter(r => r.phase === 'repair').length, 3);
  assert.equal(p.seen.filter(r => r.phase === 'review').length, 6);
  assert.equal(result.trials[0].phases.length, 4);
  assert.equal(result.trials[0].accepted, true);
});
test('hierarchical execution reclassifies each story, preserves dependencies and records triage escalation', async () => {
  const p = ports(), normal = p.phase;
  p.phase = async input => ({...await normal(input),
    ...(input.phase === 'triage' ? {escalate: true, escalationReason: 'invariant-ambiguity'} : {}),
    ...(input.phase === 'design' ? {stories: [
      {id: 'a', model: 'ignored', files: ['src/a.ts'], dependencies: []},
      {id: 'b', model: 'ignored', files: ['src/b.ts'], dependencies: ['a']},
    ]} : {}),
  });
  const classified = [];
  p.routeStory = async story => {classified.push(story.id); return {executorId: story.id === 'a' ? 'haiku' : 'sonnet', shadow: {}};};
  p.materializeTasks = async stories => stories.map(story => ({...story, taskId: 'task_' + story.id}));
  const result = await runHierarchicalTrial({taskId: 'F02', triager: 'sonnet', designer: 'sonnet',
    advancedDesigner: 'opus', reviewer: 'sonnet', limits: handoff.limits}, p);
  assert.deepEqual(classified, ['a', 'b']); assert.equal(result.designer, 'opus');
  assert.equal(result.escalationReason, 'invariant-ambiguity');
  assert.deepEqual(result.assignments.map(a => a.model), ['haiku', 'sonnet']);
  assert.equal(p.seen.find(r => r.phase === 'design').model, 'opus');
});
test('cancellation preserves the last partial receipt and cannot claim complete accounting', async () => {
  const p = ports(), receipt = fixture('partial');
  const controller = new AbortController();
  p.phase = async input => {
    await input.onReceipt(receipt);
    controller.abort(new Error('owner cancelled'));
    return new Promise(() => {});
  };
  const result = await runFactorialCampaign({taskId: 'F02', designers: ['sonnet'], executors: ['haiku'],
    reviewer: 'sonnet', repetitions: 3, seed: 1, cacheConditions: ['cold-requested'], limits: handoff.limits}, p,
    {signal: controller.signal});
  assert.equal(result.completeAccounting, false);
  assert.equal(result.cost.observedMax, .005);
  assert.equal(p.saved[0].id, 'partial'); assert.equal(result.trials.filter(t => t.accepted).length, 0);
});
