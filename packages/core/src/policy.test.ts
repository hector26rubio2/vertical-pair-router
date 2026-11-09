import assert from "node:assert/strict";
import test from "node:test";

import type { PolicyLayer } from "@vpr/contracts";

import { evaluatePolicy } from "./policy.js";

test("lower layers can harden but cannot weaken protected booleans", () => {
  const layers: PolicyLayer[] = [
    {
      id: "protected",
      kind: "protected-user",
      rules: { allowShell: false, allowNetworkTelemetry: false }
    },
    {
      id: "project",
      kind: "project",
      rules: { allowShell: true, allowNetworkTelemetry: true }
    }
  ];

  const effective = evaluatePolicy(layers);

  assert.equal(effective.allowShell, false);
  assert.equal(effective.allowNetworkTelemetry, false);
  assert.deepEqual(
    effective.explanation.find((entry) => entry.rule === "allowShell")?.sources,
    ["protected", "project"]
  );
});

test("provider destinations are intersected across layers", () => {
  const effective = evaluatePolicy([
    {
      id: "user",
      kind: "protected-user",
      rules: { allowedProviders: ["local", "claude"] }
    },
    {
      id: "repo",
      kind: "project",
      rules: { allowedProviders: ["local", "openai"] }
    }
  ]);

  assert.deepEqual(effective.allowedProviders, ["local"]);
});

test("uses the smallest output limit", () => {
  const effective = evaluatePolicy([
    { id: "global", kind: "global", rules: { maxOutputBytes: 1_000_000 } },
    { id: "task", kind: "task", rules: { maxOutputBytes: 10_000 } },
    { id: "run", kind: "run", rules: { maxOutputBytes: 20_000 } }
  ]);

  assert.equal(effective.maxOutputBytes, 10_000);
});

