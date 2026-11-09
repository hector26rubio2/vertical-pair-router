import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { skillRegistry } from "../packages/workflow/dist/index.js";

test("every registered Skill exists and declares the same canonical name", async () => {
  const declared = [];
  for (const descriptor of skillRegistry) {
    const content = await readFile(resolve(descriptor.relativePath), "utf8");
    const name = /^name:\s*(\S+)$/mu.exec(content)?.[1];
    assert.equal(name, descriptor.name, descriptor.relativePath);
    declared.push(name);
  }
  assert.equal(new Set(declared).size, skillRegistry.length);
});

