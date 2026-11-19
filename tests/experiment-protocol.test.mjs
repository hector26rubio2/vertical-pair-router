import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeHandoff, validateFrozenHandoff, randomizeCells, scheduleStories, allocateSharedDesign,
  stableRolePrompt, executeFrozenHandoff} from '@vpr/experiments';
const handoff = {schemaVersion: 1, goal: 'Preserve identity', immutableContracts: ['post(key, amount)'],
  invariants: ['Stable identity'], allowedFiles: ['src/ledger.ts'], acceptanceTests: ['duplicate test'],
  escalationConditions: ['Public API change'], limits: {turns: 10, wallMs: 5000, inputContextTokens: 85000},
  contextPack: {id: 'pack-1', sha256: 'a'.repeat(64)}};
test('frozen handoff is validated, hashed and identical across executors without invented token size', () => {
  const frozen = freezeHandoff(handoff);
  assert.equal(frozen.tokens, null); assert.equal(frozen.tokenSource, 'unavailable');
  assert.equal(validateFrozenHandoff(frozen).goal, handoff.goal);
  assert.throws(() => validateFrozenHandoff({...frozen, artifact: frozen.artifact + ' '}), /hash/);
  assert.throws(() => freezeHandoff({...handoff, invariants: []}), /Invalid handoff/);
});
test('cell order is seeded, repetitions are independent and cache conditions remain requested labels', () => {
  const cells = [{task: 'F02', recipe: 'S-H', repeat: 1, cache: 'cold-requested'},
    {task: 'F02', recipe: 'S-H', repeat: 2, cache: 'warm-requested'},
    {task: 'F02', recipe: 'O-H', repeat: 1, cache: 'cold-requested'}];
  assert.deepEqual(randomizeCells(cells, 20261119), randomizeCells(cells, 20261119));
  assert.equal(cells[0].repeat, 1); assert.equal(new Set(randomizeCells(cells, 5)).size, 3);
});
test('stories batch by executor while honoring dependencies and overlapping file ownership', () => {
  const stories = [{id: 'a', model: 'haiku', files: ['src/a.ts'], dependencies: []},
    {id: 'b', model: 'haiku', files: ['src/b.ts'], dependencies: []},
    {id: 'c', model: 'sonnet', files: ['src/a.ts'], dependencies: []},
    {id: 'd', model: 'haiku', files: ['src/d.ts'], dependencies: ['a']}];
  const waves = scheduleStories(stories);
  assert.deepEqual(waves[0].map(s => s.id), ['a', 'b']);
  assert.ok(waves.findIndex(w => w.some(s => s.id === 'd')) > 0);
  assert.throws(() => scheduleStories([{...stories[0], dependencies: ['missing']}]), /dependency/);
  assert.throws(() => scheduleStories([{...stories[0], dependencies: ['b']}, {...stories[1], dependencies: ['a']}]), /cycle/);
});
test('shared design allocation only divides complete costs across consumers with real receipts', () => {
  assert.equal(allocateSharedDesign(null, []).allocatedPerConsumer, null);
  const value = allocateSharedDesign({min: 2, max: 4}, ['run-a', 'run-b']);
  assert.deepEqual(value.allocatedPerConsumer, {min: 1, max: 2});
  assert.throws(() => allocateSharedDesign({min: 2, max: 4}, ['same', 'same']), /duplicate/);
});
test('static prefix stays identical across stories and changes when role context changes', () => {
  const prefix = {tools: ['Read'], system: 'Executor', staticContext: 'Conventions'};
  const a = stableRolePrompt(prefix, 'Story A'), b = stableRolePrompt(prefix, 'Story B');
  assert.equal(a.prefixHash, b.prefixHash); assert.notEqual(a.prompt, b.prompt);
  assert.notEqual(a.prefixHash, stableRolePrompt({...prefix, system: 'Reviewer'}, 'Story A').prefixHash);
});
test('executor boundary validates before calling and blocks native experiments without explicit authorization', async () => {
  let called = 0;
  const executor = {mode: 'native', run: async () => {called++; return 'done';}};
  await assert.rejects(executeFrozenHandoff(freezeHandoff(handoff), executor,
    {contextPackSha256: 'a'.repeat(64)}), /approval/);
  assert.equal(called, 0);
  const simulation = {...executor, mode: 'simulation'};
  const result = await executeFrozenHandoff(freezeHandoff(handoff), simulation,
    {contextPackSha256: 'a'.repeat(64)});
  assert.equal(result, 'done'); assert.equal(called, 1);
  await assert.rejects(executeFrozenHandoff(freezeHandoff(handoff), simulation,
    {contextPackSha256: 'b'.repeat(64)}), /context pack/);
  assert.equal(called, 1);
});
