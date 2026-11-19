import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as core from "@vpr/core";

const fixtures = JSON.parse(
  await readFile(
    new URL("./fixtures/routing-characterization.json", import.meta.url),
    "utf8",
  ),
);
test("all five public routing functions preserve their serialized decisions", () => {
  assert.equal(new Set(fixtures.map((f) => f.fn)).size, 5);
  for (const fixture of fixtures) {
    const actual = core[fixture.fn](...fixture.args);
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      fixture.expected,
      fixture.fn,
    );
  }
});
