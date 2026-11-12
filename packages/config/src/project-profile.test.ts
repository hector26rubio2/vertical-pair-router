import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProfileChangedError,
  applyProjectProfile,
  proposeProjectProfile
} from "./project-profile.js";
import { parseProjectProfile } from './profile-policy.js';

test('preserves reviewed technology and integration choices through parsing', async context => {
  const root = await mkdtemp(join(tmpdir(), 'vpr-setup-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), '{}');
  const proposal = await proposeProjectProfile(root);
  const setup = { technologies: ['TypeScript', 'React'], integrations: { husky: true, graphify: true, archify: true } };
  const profile = parseProjectProfile({ ...proposal.profile, setup });
  assert.deepEqual(profile.setup, setup);
  assert.throws(() => parseProjectProfile({ ...profile, setup: { technologies: [], integrations: { husky: 'yes' } } }), /setup/);
});

test('preserves user-specific subscription selection and rejects identity data as a plan', async context => {
  const root = await mkdtemp(join(tmpdir(), 'vpr-subscription-profile-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), '{}');
  const proposal = await proposeProjectProfile(root);
  const subscriptions = [{ provider: 'claude', planId: 'claude-max', source: 'provider_reported' }];
  const profile = parseProjectProfile({ ...proposal.profile, subscriptions });
  await applyProjectProfile({ ...proposal, profile, content: JSON.stringify(profile, null, 2) + '\n' });
  assert.deepEqual((await proposeProjectProfile(root)).profile.subscriptions, subscriptions);
  assert.throws(() => parseProjectProfile({ ...profile, subscriptions: [{ ...subscriptions[0], planId: 'email@example.com' }] }), /subscription/);
});

test("detects pnpm scripts and proposes a versioned profile", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-profile-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { test: "node --test", build: "tsc -b" } })
  );
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const proposal = await proposeProjectProfile(root);

  assert.equal(proposal.action, "create");
  assert.equal(proposal.profile.schemaVersion, 1);
  assert.equal(proposal.profile.packageManager, "pnpm");
  assert.deepEqual(proposal.profile.checks, {
    build: { program: "pnpm", args: ["build"] },
    test: { program: "pnpm", args: ["test"] }
  });
  await assert.rejects(readFile(proposal.target, "utf8"), /ENOENT/);
});

test("applies only the reviewed proposal and then becomes a no-op", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-profile-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  const proposal = await proposeProjectProfile(root);

  await applyProjectProfile(proposal);
  const persisted = JSON.parse(await readFile(proposal.target, "utf8")) as { schemaVersion: number };
  assert.equal(persisted.schemaVersion, 1);
  assert.equal((await proposeProjectProfile(root)).action, "none");
});

test("refuses apply after the target changed", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-profile-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  const proposal = await proposeProjectProfile(root);
  await applyProjectProfile(proposal);
  await writeFile(proposal.target, JSON.stringify({ ...proposal.profile, name: 'user-edited' }) + '\n');
  const update = await proposeProjectProfile(root);
  await writeFile(update.target, "{}\n");

  await assert.rejects(applyProjectProfile(update), ProfileChangedError);
});

