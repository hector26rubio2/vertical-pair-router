import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { resolveExecutable } from "./resolve-executable.js";

test("resolves the first executable deterministically from PATH", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-path-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const first = join(root, "first");
  const second = join(root, "second");
  await mkdir(first);
  await mkdir(second);
  const filename = process.platform === "win32" ? "fixture.exe" : "fixture";
  await writeFile(join(first, filename), "fixture");
  await writeFile(join(second, filename), "fixture");
  if (process.platform !== "win32") {
    await chmod(join(first, filename), 0o755);
    await chmod(join(second, filename), 0o755);
  }

  const resolved = await resolveExecutable("fixture", {
    PATH: `${first}${delimiter}${second}`,
    PATHEXT: ".COM;.EXE;.BAT;.CMD"
  });

  assert.equal(resolved, join(first, filename));
});

test("does not select shell scripts on Windows shell-free execution", async (context) => {
  if (process.platform !== "win32") return;
  const root = await mkdtemp(join(tmpdir(), "vpr-path-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "fixture.cmd"), "@echo off\n");

  assert.equal(
    await resolveExecutable("fixture", { PATH: root, PATHEXT: ".CMD;.EXE" }),
    null
  );
});

