import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("hooks/scripts/session-start.mjs");

test("SessionStart emits bounded factual context without session or transcript data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-hook-unicode-ñ-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vpr"));
  await writeFile(
    join(root, ".vpr", "profile.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectId: "project_fixture",
      checks: { test: { program: "pnpm", args: ["test"] } }
    })
  );
  const input = {
    session_id: "must-not-leak",
    transcript_path: "C:/private/transcript.jsonl",
    cwd: root,
    hook_event_name: "SessionStart",
    source: "resume",
    model: "provider-model"
  };

  const result = await runHook(JSON.stringify(input));
  const output = JSON.parse(result.stdout);
  const additionalContext = output.hookSpecificOutput.additionalContext;

  assert.equal(result.code, 0);
  assert.match(additionalContext, /project_fixture/u);
  assert.match(additionalContext, /configured checks: test/u);
  assert.doesNotMatch(result.stdout, /must-not-leak|transcript|provider-model/u);
});

test("SessionStart reports an absent profile without creating files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-hook-empty-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const result = await runHook(
    JSON.stringify({ cwd: root, hook_event_name: "SessionStart", source: "startup" })
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /profile: absent/u);
});

test("SessionStart treats malformed profile content as unavailable data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-hook-invalid-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vpr"));
  await writeFile(join(root, ".vpr", "profile.json"), "{not-json");

  const result = await runHook(
    JSON.stringify({ cwd: root, hook_event_name: "SessionStart", source: "startup" })
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /invalid or unreadable/u);
  assert.doesNotMatch(result.stdout, /not-json/u);
});

test("SessionStart fails visibly on oversized input", async () => {
  const result = await runHook("x".repeat(70 * 1024));

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /input exceeds/u);
});

function runHook(input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [script], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

