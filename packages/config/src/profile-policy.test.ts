import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePolicy } from "@vpr/core";

import {
  UnsupportedProfileVersionError,
  parseGlobalProfile,
  parseProjectProfile,
  profilePolicyLayers
} from "./profile-policy.js";

test("maps global and project profiles into protected precedence", () => {
  const global = parseGlobalProfile({
    schemaVersion: 1,
    protectedPolicy: {
      allowShell: false,
      allowNetworkTelemetry: false,
      allowedProviders: ["local"]
    },
    defaults: { maxOutputBytes: 500_000 }
  });
  const project = parseProjectProfile({
    schemaVersion: 1,
    projectId: "project_fixture",
    name: "fixture",
    packageManager: "pnpm",
    checks: {},
    glossaryPath: "GLOSSARY.md",
    policy: {
      allowShell: true,
      allowNetworkTelemetry: true,
      allowedProviders: ["local", "external"],
      maxOutputBytes: 100_000
    }
  });

  const effective = evaluatePolicy(profilePolicyLayers(global, project));

  assert.equal(effective.allowShell, false);
  assert.equal(effective.allowNetworkTelemetry, false);
  assert.deepEqual(effective.allowedProviders, ["local"]);
  assert.equal(effective.maxOutputBytes, 100_000);
});

test("rejects unsupported profile schema versions", () => {
  assert.throws(
    () => parseGlobalProfile({ schemaVersion: 2 }),
    UnsupportedProfileVersionError
  );
});

