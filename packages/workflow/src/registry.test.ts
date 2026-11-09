import assert from "node:assert/strict";
import test from "node:test";

import { selectWorkflow, skillRegistry } from "./registry.js";

test("routes ambiguous features through vpr-grill", () => {
  const route = selectWorkflow({
    workClass: "feature",
    ambiguity: "high",
    complexity: "normal",
    reproducibility: "not-applicable"
  });

  assert.equal(route.selectedSkill, "vpr-grill");
  assert.match(route.why, /ambigua/u);
});

test("keeps a clear small feature on the light route", () => {
  const request = {
    workClass: "feature",
    ambiguity: "low",
    complexity: "small",
    reproducibility: "not-applicable"
  } as const;

  assert.deepEqual(selectWorkflow(request), selectWorkflow(request));
  assert.equal(selectWorkflow(request).selectedSkill, "vpr-feature");
  assert.ok(selectWorkflow(request).rejectedSkills.includes("vpr-grill"));
});

test("routes an unclear bug to diagnosis and a reproduced bug to bugfix", () => {
  assert.equal(
    selectWorkflow({
      workClass: "bug",
      ambiguity: "high",
      complexity: "normal",
      reproducibility: "missing"
    }).selectedSkill,
    "vpr-diagnose"
  );
  assert.equal(
    selectWorkflow({
      workClass: "bug",
      ambiguity: "low",
      complexity: "small",
      reproducibility: "confirmed"
    }).selectedSkill,
    "vpr-bugfix"
  );
});

test("registry names only existing VPR skill directories", () => {
  assert.deepEqual(
    skillRegistry.map((skill) => skill.name).sort(),
    [
      "vpr-bugfix",
      "vpr-diagnose",
      "vpr-feature",
      "vpr-grill",
      "vpr-init",
      "vpr-plan",
      "vpr-retro",
      "vpr-review",
      "vpr-verify"
    ]
  );
});

