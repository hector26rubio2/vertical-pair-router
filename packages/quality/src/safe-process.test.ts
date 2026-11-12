import assert from "node:assert/strict";
import { execPath } from "node:process";
import test from "node:test";

import { ProgramNotAllowedError, createSafeProcessRunner } from "./safe-process.js";

const cwd = process.cwd();

test("executes an allowlisted program without a shell", async () => {
  const run = createSafeProcessRunner([execPath]);
  const result = await run({
    program: execPath,
    args: ["-e", "process.stdout.write('safe-output')"],
    cwd,
    timeoutMs: 1_000,
    maxOutputBytes: 1_024
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "safe-output");
  assert.equal(result.stderr, "");
  assert.equal(result.timedOut, false);
  assert.equal(result.cancelled, false);
});

test("rejects programs outside the allowlist", async () => {
  const run = createSafeProcessRunner([]);

  await assert.rejects(
    run({
      program: execPath,
      args: ["--version"],
      cwd,
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    }),
    ProgramNotAllowedError
  );
});

test("bounds combined output and reports truncation", async () => {
  const run = createSafeProcessRunner([execPath]);
  const result = await run({
    program: execPath,
    args: ["-e", "process.stdout.write('a'.repeat(80)); process.stderr.write('b'.repeat(80))"],
    cwd,
    timeoutMs: 1_000,
    maxOutputBytes: 100
  });

  assert.equal(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr), 100);
  assert.equal(result.outputTruncated, true);
});

test("terminates a process after its timeout", async () => {
  const run = createSafeProcessRunner([execPath]);
  const result = await run({
    program: execPath,
    args: ["-e", "setTimeout(() => {}, 10_000)"],
    cwd,
    timeoutMs: 50,
    maxOutputBytes: 1_024
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.cancelled, false);
  assert.equal(result.exitCode, null);
});

test("honors AbortSignal cancellation", async () => {
  const controller = new AbortController();
  const run = createSafeProcessRunner([execPath]);
  const pending = run({
    program: execPath,
    args: ["-e", "setTimeout(() => {}, 10_000)"],
    cwd,
    timeoutMs: 1_000,
    maxOutputBytes: 1_024,
    signal: controller.signal
  });

  controller.abort();
  const result = await pending;

  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});

test("preserves hostile shell metacharacters as literal arguments", async () => {
  const payload = 'space value; & echo injected | $(whoami) `whoami` "quoted" %PATH%';
  const result = await createSafeProcessRunner([execPath])({
    program: execPath,
    args: ["-e", "process.stdout.write(process.argv[1])", payload],
    cwd,
    timeoutMs: 1_000,
    maxOutputBytes: 1_024
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, payload);
});

