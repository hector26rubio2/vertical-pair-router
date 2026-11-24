import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { proposeProjectProfile } from "@vpr/config";
import type { EntityId } from "@vpr/contracts";
import type { SqliteStorage } from "@vpr/storage-sqlite";

import {
  createBacklog,
  flagValue,
  readEffectiveProfile,
  readProjectProfile,
  withStorage,
} from "./project-workspace.js";

async function tempDir(context: test.TestContext, prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeProfile(root: string): Promise<void> {
  await writeFile(join(root, "package.json"), "{}");
  const proposal = await proposeProjectProfile(root);
  await mkdir(join(root, ".vpr"), { recursive: true });
  await writeFile(join(root, ".vpr", "profile.json"), proposal.content);
}

async function withEnv(name: string, value: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test("flagValue ignores missing and empty values", () => {
  assert.equal(flagValue(["--db", "x.db"], "--db"), "x.db");
  assert.equal(flagValue(["--db", ""], "--db"), undefined);
  assert.equal(flagValue(["--db"], "--db"), undefined);
  assert.equal(flagValue([], "--db"), undefined);
});

test("withStorage resolves relative paths against cwd and returns the result", async (context) => {
  const dir = await tempDir(context, "vpr-workspace-");
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const result = await withStorage("relative.db", async (storage) => {
      assert.deepEqual(await storage.readEvents("project_a" as EntityId), []);
      return "done";
    });
    assert.equal(result, "done");
    await access(join(dir, "relative.db"));
  } finally {
    process.chdir(previous);
  }
});

test("withStorage closes storage when the callback throws", async (context) => {
  const dir = await tempDir(context, "vpr-workspace-close-");
  let opened: SqliteStorage | undefined;
  await assert.rejects(
    withStorage(join(dir, "a.db"), async (storage) => {
      opened = storage;
      throw new Error("boom");
    }),
    /boom/u,
  );
  assert.ok(opened);
  await assert.rejects(opened.readEvents("project_a" as EntityId));
});

test("createBacklog builds a service bound to project and actor", async (context) => {
  const dir = await tempDir(context, "vpr-workspace-backlog-");
  await withStorage(join(dir, "a.db"), async (storage) => {
    const backlog = createBacklog(storage, "project_a" as EntityId, "vpr-test");
    assert.deepEqual(await backlog.listStories(), []);
  });
});

test("readEffectiveProfile returns the project profile when the global profile is missing", async (context) => {
  const root = await tempDir(context, "vpr-workspace-profile-");
  await writeProfile(root);
  await withEnv("VPR_GLOBAL_PROFILE", join(root, "missing-global.json"), async () => {
    assert.deepEqual(await readEffectiveProfile(root), await readProjectProfile(root));
  });
});

test("readEffectiveProfile rethrows invalid global profile errors", async (context) => {
  const root = await tempDir(context, "vpr-workspace-bad-global-");
  await writeProfile(root);
  const globalPath = join(root, "global.json");
  await writeFile(globalPath, "not json");
  await withEnv("VPR_GLOBAL_PROFILE", globalPath, async () => {
    await assert.rejects(readEffectiveProfile(root), SyntaxError);
  });
});
