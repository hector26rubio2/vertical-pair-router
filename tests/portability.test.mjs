import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseGlobalProfile, parseProjectProfile } from "../packages/config/dist/index.js";

test("core remains host-independent and depends only on public contracts", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../packages/core/package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.dependencies, { "@vpr/contracts": "workspace:*" });
  for (const file of ["policy.ts", "router.ts", "run-state.ts"]) {
    const source = await readFile(new URL(`../packages/core/src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["']node:|claude|process\.|window\./iu);
  }
});

test("shipped personal and company profile examples parse without private fields", async () => {
  const personal = JSON.parse(await readFile(new URL("../examples/profiles/personal-global.json", import.meta.url), "utf8"));
  const project = JSON.parse(await readFile(new URL("../examples/profiles/company-project.json", import.meta.url), "utf8"));
  assert.equal(parseGlobalProfile(personal).protectedPolicy.allowNetworkTelemetry, false);
  assert.equal(parseProjectProfile(project).policy.allowedProviders?.[0], "local");
  assert.doesNotMatch(JSON.stringify({ personal, project }), /secret|token|password|api.?key/iu);
});
