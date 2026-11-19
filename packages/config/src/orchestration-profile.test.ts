import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applySetupSelection,
  proposeOrchestrationProfile,
  type OrchestrationAnswers,
} from "./orchestration-profile.js";
import { proposeProjectProfile } from "./project-profile.js";

async function baseProfile(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vpr-orchestration-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), "{}");
  return (await proposeProjectProfile(root)).profile;
}

const answers: OrchestrationAnswers = {
  technologies: ["TypeScript"],
  integrations: { husky: true, graphify: false, archify: true },
  provider: "claude",
  planId: "claude-pro",
  planSource: "user_reported",
  model: "opus",
  light: "haiku",
  standard: "sonnet",
  high: "opus-max",
  allowLightCoding: true,
  objective: "tokens",
};

test("builds coordinator and worker template with provider policy", async (context) => {
  const profile = proposeOrchestrationProfile(await baseProfile(context), answers);
  assert.deepEqual(profile.setup, {
    technologies: ["TypeScript"],
    integrations: { husky: true, graphify: false, archify: true },
  });
  assert.deepEqual(profile.policy.allowedProviders, ["local", "claude"]);
  assert.equal(profile.orchestration?.orchestratorId, "coordinator");
  assert.equal(profile.orchestration?.maxWorkers, 2);
  assert.equal(profile.orchestration?.allowLightCoding, true);
  assert.equal(profile.orchestration?.objective, "tokens");
  assert.deepEqual(
    profile.orchestration?.models.map((model) => [model.id, model.model, model.tier, model.roles]),
    [
      ["coordinator", "opus", "standard", ["orchestrator"]],
      ["light-worker", "haiku", "light", ["inventory", "coding"]],
      ["standard-worker", "sonnet", "standard", ["coding", "review"]],
      ["high-worker", "opus-max", "high", ["coding", "review"]],
    ],
  );
});

test("records subscription source as given and omits it without plan", async (context) => {
  const base = await baseProfile(context);
  const user = proposeOrchestrationProfile(base, answers);
  assert.deepEqual(user.subscriptions, [
    { provider: "claude", planId: "claude-pro", source: "user_reported" },
  ]);
  const detected = proposeOrchestrationProfile(base, { ...answers, planSource: "provider_reported" });
  assert.equal(detected.subscriptions?.[0]?.source, "provider_reported");
  const none = proposeOrchestrationProfile(base, { ...answers, planId: null });
  assert.equal(none.subscriptions, undefined);
});

test("rejects unknown provider and objective", async (context) => {
  const base = await baseProfile(context);
  assert.throws(
    () => proposeOrchestrationProfile(base, { ...answers, provider: "gemini" }),
    new TypeError("Unknown orchestrator provider"),
  );
  assert.throws(
    () => proposeOrchestrationProfile(base, { ...answers, objective: "speed" }),
    new TypeError("Invalid routing objective"),
  );
});

test("applies setup selection and keeps previous values for omitted parts", async (context) => {
  const base = await baseProfile(context);
  const first = applySetupSelection(base, {
    technologies: ["Go"],
    integrations: ["husky", "archify"],
  });
  assert.deepEqual(first.setup, {
    technologies: ["Go"],
    integrations: { husky: true, graphify: false, archify: true },
  });
  const second = applySetupSelection(first, { technologies: ["Rust"] });
  assert.deepEqual(second.setup, {
    technologies: ["Rust"],
    integrations: { husky: true, graphify: false, archify: true },
  });
  const third = applySetupSelection(first, { integrations: ["none"] });
  assert.deepEqual(third.setup, {
    technologies: ["Go"],
    integrations: { husky: false, graphify: false, archify: false },
  });
});

test("rejects invalid or empty integrations", async (context) => {
  const base = await baseProfile(context);
  assert.throws(
    () => applySetupSelection(base, { integrations: ["husky", "nope"] }),
    new TypeError("Integrations: husky,graphify,archify or none"),
  );
  assert.throws(
    () => applySetupSelection(base, { integrations: [] }),
    new TypeError("--integrations needs a value"),
  );
});
