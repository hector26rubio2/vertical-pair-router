import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {proposeProjectProfile} from '@vpr/config';
import {provisionProjectAgents} from './project-agents.js';

test('init agent provisioning uses configured explicit models and preserves existing Explore definitions', async () => {
  const root = resolve('.tmp/experiment-review/agents-' + randomUUID()); await mkdir(root, {recursive: true});
  await writeFile(join(root, 'package.json'), '{"name":"agents-test"}');
  const base = (await proposeProjectProfile(root)).profile;
  const profile = {...base, policy: {...base.policy, allowedProviders: ['claude']}, orchestration: {
    orchestratorId: 's', maxWorkers: 2, allowLightCoding: true, models: [
      {id: 'h', provider: 'claude' as const, model: 'claude-haiku-5-5', tier: 'light' as const, roles: ['inventory', 'coding'] as const},
      {id: 's', provider: 'claude' as const, model: 'claude-sonnet-5-5', tier: 'standard' as const, roles: ['orchestrator', 'review'] as const},
    ]}};
  const first = await provisionProjectAgents(root, profile);
  assert.equal(first.filter(row => row.state === 'created').length, 3);
  const content = await readFile(join(root, '.claude/agents/Explore.md'), 'utf8');
  assert.match(content, /name: Explore/u); assert.match(content, /model: "claude-haiku-5-5"/u);
  assert.match(content, /\.tmp\/|node_modules/u);
  await writeFile(join(root, '.claude/agents/Explore.md'), '---\nname: Explore\nmodel: sonnet\ndescription: Owner agent\n---\nOwner content\n');
  const second = await provisionProjectAgents(root, profile);
  assert.ok(second.some(row => row.name === 'Explore' && row.state === 'preserved'));
  assert.match(await readFile(join(root, '.claude/agents/Explore.md'), 'utf8'), /Owner content/u);
});
