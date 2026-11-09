import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessRunner } from "@vpr/contracts";

import { probeCapability } from "./probe-capability.js";

test("records an available capability with expiry and evidence", async () => {
  const processRunner: ProcessRunner = async () => ({
    exitCode: 0,
    durationMs: 4,
    stdout: "v24.15.0\n",
    stderr: "",
    outputTruncated: false,
    timedOut: false,
    cancelled: false
  });

  const capability = await probeCapability(
    {
      id: "node",
      program: process.execPath,
      args: ["--version"],
      cwd: process.cwd(),
      ttlMs: 60_000
    },
    processRunner,
    () => new Date("2026-11-09T12:00:00.000Z")
  );

  assert.equal(capability.state, "available");
  assert.equal(capability.version, "v24.15.0");
  assert.equal(capability.expiresAt, "2026-11-09T12:01:00.000Z");
  assert.equal(capability.evidence[0]?.source, "measured");
  assert.equal(capability.evidence[0]?.reference, process.execPath);
});

test("marks timeout and truncated probes as degraded", async () => {
  const processRunner: ProcessRunner = async () => ({
    exitCode: null,
    durationMs: 50,
    stdout: "partial",
    stderr: "",
    outputTruncated: true,
    timedOut: true,
    cancelled: false
  });

  const capability = await probeCapability(
    { id: "tool", program: "tool", args: [], cwd: process.cwd(), ttlMs: 1_000 },
    processRunner,
    () => new Date("2026-11-09T12:00:00.000Z")
  );

  assert.equal(capability.state, "degraded");
  assert.deepEqual(capability.limitations, ["probe timed out", "probe output was truncated"]);
});

