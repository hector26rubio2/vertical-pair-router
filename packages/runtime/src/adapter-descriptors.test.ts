import assert from "node:assert/strict";
import test from "node:test";

import { AdapterCatalog } from "@vpr/core";

import { builtInAdapterDescriptors } from "./adapter-descriptors.js";

test("built-in adapter descriptors satisfy the shared contract and evidence matrix", () => {
  const catalog = new AdapterCatalog();
  for (const descriptor of builtInAdapterDescriptors()) {
    assert.deepEqual(descriptor.operatingSystems, ["win32"]);
    assert.equal(descriptor.availability, "unknown");
    catalog.register(descriptor);
  }
  assert.deepEqual(catalog.list().map((descriptor) => descriptor.id), [
    "claude-code-native",
    "local-tools"
  ]);
});
