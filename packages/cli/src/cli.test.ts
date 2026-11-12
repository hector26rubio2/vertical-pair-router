import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "./cli.js";

test("runs a real local check and returns machine-readable completion", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-cli-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const writes: string[] = [];

  const exitCode = await runCli(
    ["doctor", "--db", join(directory, "vpr.sqlite")],
    { stdout: (value) => writes.push(value), stderr: (value) => writes.push(value) }
  );

  assert.equal(exitCode, 0);
  const output = JSON.parse(writes.join("")) as {
    state: string;
    evidence: { exitCode: number };
    capabilities: { id: string; state: string }[];
  };
  assert.equal(output.state, "COMPLETED");
  assert.equal(output.evidence.exitCode, 0);
  assert.equal(output.capabilities.find((capability) => capability.id === "node")?.state, "available");
});

test("previews init without writing and applies only with --apply", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-init-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  const previewWrites: string[] = [];

  const previewCode = await runCli(["init", "--project", root], {
    stdout: (value) => previewWrites.push(value),
    stderr: (value) => previewWrites.push(value)
  });
  const preview = JSON.parse(previewWrites.join("")) as { action: string; applied: boolean };

  assert.equal(previewCode, 0);
  assert.equal(preview.action, "create");
  assert.equal(preview.applied, false);
  await assert.rejects(readFile(join(root, ".vpr", "profile.json"), "utf8"), /ENOENT/);

  const applyWrites: string[] = [];
  const applyCode = await runCli(["init", "--project", root, "--apply"], {
    stdout: (value) => applyWrites.push(value),
    stderr: (value) => applyWrites.push(value)
  });
  const applied = JSON.parse(applyWrites.join("")) as { applied: boolean };

  assert.equal(applyCode, 0);
  assert.equal(applied.applied, true);
  assert.equal(
    (JSON.parse(await readFile(join(root, ".vpr", "profile.json"), "utf8")) as {
      schemaVersion: number;
    }).schemaVersion,
    1
  );
});

test("previews and applies a Story through the shared BacklogService", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-story-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const input = join(root, "story.json");
  const db = join(root, "backlog.sqlite");
  await writeFile(input, JSON.stringify({
    title: "CLI Story",
    need: "Create backlog items without a dashboard.",
    desiredOutcome: "A previewed and confirmed Story.",
    acceptanceCriteria: ["A later invocation recovers it."],
    exclusions: [],
    openQuestions: [],
    attachments: []
  }));

  const previewWrites: string[] = [];
  assert.equal(await runCli([
    "story", "--db", db, "--project-id", "project_cli", "--input", input
  ], {
    stdout: (value) => previewWrites.push(value),
    stderr: (value) => previewWrites.push(value)
  }), 0);
  const preview = JSON.parse(previewWrites.join("")) as { action: string; applied: boolean };
  assert.deepEqual(preview, { action: "create", applied: false });

  const applyWrites: string[] = [];
  assert.equal(await runCli([
    "story", "--db", db, "--project-id", "project_cli", "--input", input, "--apply"
  ], {
    stdout: (value) => applyWrites.push(value),
    stderr: (value) => applyWrites.push(value)
  }), 0);
  const applied = JSON.parse(applyWrites.join("")) as {
    applied: boolean;
    story: { revision: number; story: { status: string } };
  };
  assert.equal(applied.applied, true);
  assert.equal(applied.story.revision, 1);
  assert.equal(applied.story.story.status, "READY");

  const duplicateWrites: string[] = [];
  await runCli(["story", "--db", db, "--project-id", "project_cli", "--input", input], {
    stdout: (value) => duplicateWrites.push(value),
    stderr: (value) => duplicateWrites.push(value)
  });
  assert.equal((JSON.parse(duplicateWrites.join("")) as { action: string }).action, "duplicate");
});

test("exports JSONL and deletes project data only with exact confirmation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-data-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const input = join(root, "story.json");
  const db = join(root, "backlog.sqlite");
  const output = join(root, "events.jsonl");
  await writeFile(input, JSON.stringify({
    title: "Exportable Story",
    need: "Keep a portable local event history.",
    desiredOutcome: "A JSONL export that can be inspected without SQLite.",
    acceptanceCriteria: ["The export contains the Story event."],
    exclusions: [],
    openQuestions: [],
    attachments: []
  }));
  const sink = { stdout: (_value: string) => undefined, stderr: (_value: string) => undefined };

  assert.equal(await runCli([
    "story", "--db", db, "--project-id", "project_data", "--input", input, "--apply"
  ], sink), 0);
  assert.equal(await runCli([
    "data", "export", "--db", db, "--project-id", "project_data", "--out", output
  ], sink), 0);
  assert.match(await readFile(output, "utf8"), /backlog\.story\.created/);

  const retentionWrites: string[] = [];
  assert.equal(await runCli([
    "data", "retention", "--db", db, "--project-id", "project_data",
    "--before", "2099-01-01T00:00:00.000Z"
  ], {
    stdout: (value) => retentionWrites.push(value),
    stderr: (value) => retentionWrites.push(value)
  }), 0);
  assert.equal((JSON.parse(retentionWrites.join("")) as { candidates: number; applied: boolean }).candidates, 0);
  assert.equal((JSON.parse(retentionWrites.join("")) as { candidates: number; applied: boolean }).applied, false);

  await assert.rejects(
    runCli([
      "data", "delete", "--db", db, "--project-id", "project_data", "--confirm", "project_other"
    ], sink),
    /exact project id/
  );
  assert.equal(await runCli([
    "data", "delete", "--db", db, "--project-id", "project_data", "--confirm", "project_data"
  ], sink), 0);
});

