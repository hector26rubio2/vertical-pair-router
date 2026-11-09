import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessRunner } from "@vpr/contracts";

import { CapabilityRegistry } from "./capability-registry.js";

test("caches capability evidence until expiry and supports forced refresh", async () => {
  let calls = 0;
  let current = new Date("2026-11-09T12:00:00.000Z");
  const processRunner: ProcessRunner = async () => {
    calls += 1;
    return {
      exitCode: 0,
      durationMs: 1,
      stdout: `v${calls}`,
      stderr: "",
      outputTruncated: false,
      timedOut: false,
      cancelled: false
    };
  };
  const registry = new CapabilityRegistry(
    [
      {
        id: "node",
        program: process.execPath,
        args: ["--version"],
        cwd: process.cwd(),
        ttlMs: 1_000
      }
    ],
    processRunner,
    () => new Date(current)
  );

  assert.equal((await registry.get("node")).version, "v1");
  assert.equal((await registry.get("node")).version, "v1");
  assert.equal((await registry.get("node", true)).version, "v2");
  current = new Date("2026-11-09T12:00:02.000Z");
  assert.equal((await registry.get("node")).version, "v3");
  assert.equal(calls, 3);
});

test("refuses unknown capability ids", async () => {
  const registry = new CapabilityRegistry([], async () => {
    throw new Error("not called");
  });

  await assert.rejects(registry.get("missing"), /Unknown capability/);
});

