import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {createNativeCampaignPorts, freezeHandoff} from '@vpr/experiments';
import {fixture} from './fixtures/evidence.mjs';
test('native campaign requires approval and verifies an isolated workspace, model and context pack before invoking', async () => {
  const root = resolve('.tmp/experiment-review/native-adapter-' + randomUUID()); await mkdir(root, {recursive: true});
  const workspace = join(root, 'cell'); await mkdir(workspace);
  const frozenRoot = join(root, 'frozen'); await mkdir(frozenRoot);
  const packData = JSON.stringify({schemaVersion: 1, storyId: 'story_1', taskId: 'task_1', commit: 'fixture',
    createdAt: '2026-11-19T00:00:00Z', files: [], pending: [], totalBytes: 0});
  const pack = join(root, 'pack.json'); await writeFile(pack, packData);
  const packHash = createHash('sha256').update(packData).digest('hex');
  let calls = 0;
  const options = {isolatedRoot: root, frozenRoot, receiptDirectory: join(root, 'receipts'), contextPackPath: pack,
    contextPack: {id: 'pack-1', sha256: packHash}, requirements: 'Fix ledger identity',
    features: fixture().features, allowedProviders: ['claude'],
    models: [{id: 'h', provider: 'claude', model: 'claude-haiku-5-5', tier: 'light', roles: ['coding']}],
    workspaceForCell: async () => workspace,
    persist: async () => {}, verifyModel: async () => true,
    checks: async () => ({external: true, regression: true, build: true}),
    invoke: async input => {calls++; assert.equal(input.maxTurns, 5); assert.equal(input.writeFiles, true);
      return {success: true, answer: 'done', model: input.model.model, wallMs: 10, failure: null,
        usage: [{model: input.model.model, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0,
          cacheWriteTokens: 0, cost: {min: .0001, max: .0001}, complete: true}]};},
  };
  assert.throws(() => createNativeCampaignPorts(options), /approval/);
  const ports = createNativeCampaignPorts({...options, nativeApproval: 'explicitly-approved'});
  const frozenPlan = freezeHandoff({schemaVersion: 1, goal: 'Fix ledger', immutableContracts: ['post(key)'],
    invariants: ['Stable key'], allowedFiles: ['src'], acceptanceTests: ['regression'], escalationConditions: ['API change'],
    limits: {turns: 5, wallMs: 5000, inputContextTokens: 85000}, contextPack: {id: 'pack-1', sha256: packHash}});
  const result = await ports.phase({phase: 'implement', model: 'h', taskId: 'F02', cellId: 'trial-1',
    frozenPlan,
    limits: {turns: 5, wallMs: 5000, inputContextTokens: 85000},
    signal: new AbortController().signal, onReceipt: async () => {}});
  assert.equal(calls, 1); assert.equal(result.record.granularity, 'phase');
  assert.equal(result.record.tokens.contextMax, null); assert.equal(result.record.cost.totalMaxUsd, .0001);
  assert.equal(result.record.checks.build, true);
  const denied = createNativeCampaignPorts({...options, nativeApproval: 'explicitly-approved', verifyModel: async () => false});
  await assert.rejects(denied.phase({phase: 'design', model: 'h', taskId: 'F02', cellId: 'trial-2',
    limits: {turns: 5, wallMs: 5000, inputContextTokens: 85000}, signal: new AbortController().signal, onReceipt: async () => {}}), /verified/);
  assert.equal(calls, 1);
});
