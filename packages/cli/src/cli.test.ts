import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  const output = JSON.parse(writes.join("")) as { state: string; evidence: { exitCode: number } };
  assert.equal(output.state, "COMPLETED");
  assert.equal(output.evidence.exitCode, 0);
});

