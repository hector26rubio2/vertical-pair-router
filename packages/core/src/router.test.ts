import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterDescriptor, EffectivePolicy, RouteRequest } from "@vpr/contracts";

import { AdapterCatalog, routeRequest } from "./index.js";

const policy: EffectivePolicy = {
  allowShell: false,
  allowNetworkTelemetry: false,
  allowedProviders: ["local", "claude", "other"],
  maxOutputBytes: 1_000_000,
  explanation: []
};

const local: AdapterDescriptor = {
  id: "local-tools",
  provider: "local",
  displayName: "Local tools",
  authentication: "none",
  credentialHandling: "none",
  capabilities: ["checks", "code"],
  availability: "available",
  availabilityEvidence: "local probe",
  quality: "standard",
  operatingSystems: ["win32", "linux", "darwin"],
  transmittedData: [],
  limits: { concurrency: 1 },
  cost: { source: "measured", estimatedUsd: 0 },
  latency: { source: "measured", estimatedMs: 10 }
};

const claude: AdapterDescriptor = {
  id: "claude-code-native",
  provider: "claude",
  displayName: "Claude Code native",
  authentication: "host-session",
  credentialHandling: "host-managed",
  capabilities: ["checks", "code", "agent", "worktree"],
  availability: "available",
  availabilityEvidence: "claude --version",
  quality: "high",
  operatingSystems: ["win32", "linux", "darwin"],
  transmittedData: ["selected-context", "prompts"],
  limits: { concurrency: 2 },
  cost: { source: "unavailable" },
  latency: { source: "unavailable" }
};

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    requestId: "route_1",
    requiredCapabilities: ["code"],
    sensitivity: "provider-allowed",
    requiredQuality: "standard",
    operatingSystem: "win32",
    preferredProvider: "local",
    fallbackOptIn: false,
    optimizeFor: "latency",
    ...overrides
  };
}

test("routes deterministically through policy, capability, privacy and quality", () => {
  const first = routeRequest(request({ sensitivity: "local-only" }), policy, [claude, local]);
  const second = routeRequest(request({ sensitivity: "local-only" }), policy, [local, claude]);
  assert.deepEqual(first, second);
  assert.equal(first.status, "routed");
  assert.equal(first.adapterId, "local-tools");
  assert.deepEqual(first.pipeline.map((stage) => stage.stage), [
    "policy", "capability", "privacy", "quality", "cost-latency"
  ]);
});

test("never chooses unavailable capability or a policy-disallowed provider", () => {
  const result = routeRequest(
    request({ requiredCapabilities: ["worktree"], preferredProvider: "claude" }),
    { ...policy, allowedProviders: ["local"] },
    [local, claude]
  );
  assert.equal(result.status, "unavailable");
  assert.match(result.explanation, /No eligible adapter/);
});

test("does not route to an adapter with unverified availability", () => {
  const result = routeRequest(request(), policy, [{
    ...local,
    availability: "unknown"
  }]);
  assert.equal(result.status, "unavailable");
  assert.match(result.pipeline[1]?.rejected[0]?.reason ?? "", /unknown/);
});

test("fallback changes provider only with opt-in and reports privacy/cost", () => {
  const blocked = routeRequest(
    request({ requiredCapabilities: ["worktree"], preferredProvider: "local" }),
    policy,
    [local, claude]
  );
  assert.equal(blocked.status, "approval-required");

  const allowed = routeRequest(
    request({
      requiredCapabilities: ["worktree"],
      preferredProvider: "local",
      fallbackOptIn: true
    }),
    policy,
    [local, claude]
  );
  assert.equal(allowed.status, "routed");
  assert.equal(allowed.adapterId, "claude-code-native");
  assert.equal(allowed.cost.source, "unavailable");
  assert.match(allowed.explanation, /provider changed from local to claude/);
  assert.match(allowed.explanation, /selected-context, prompts/);
});

test("unavailable cost is not treated as free", () => {
  const paidKnown: AdapterDescriptor = {
    ...claude,
    id: "other-known",
    provider: "other",
    authentication: "secret-resolver",
    credentialHandling: "secret-resolver-only",
    cost: { source: "estimated", estimatedUsd: 0.01 },
    latency: { source: "estimated", estimatedMs: 100 }
  };
  const result = routeRequest(
    request({ preferredProvider: null, fallbackOptIn: true, optimizeFor: "cost" }),
    policy,
    [claude, paidKnown]
  );
  assert.equal(result.adapterId, "other-known");
});

test("adapter catalog rejects credential extraction and invalid auth declarations", () => {
  const catalog = new AdapterCatalog();
  catalog.register(local);
  catalog.register(claude);
  assert.equal(catalog.list().length, 2);
  assert.throws(() => catalog.register({
    ...claude,
    id: "bad-direct-api",
    authentication: "secret-resolver",
    credentialHandling: "host-managed"
  }), /SecretResolver/);
  assert.throws(() => catalog.register({
    ...claude,
    id: "extractor",
    credentialHandling: "extract-host-credentials" as never
  }), /credential/);
});

