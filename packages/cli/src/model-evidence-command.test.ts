import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "./cli.js";

async function capture(args: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

test("models prices prints the packaged catalog for a provider", async () => {
  const result = await capture(["models", "prices", "--provider", "claude"]);
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(output.provider, "claude");
  assert.equal(output.inferenceTokens, 0);
  assert.equal(output.accountAvailabilityVerified, false);
  assert.equal(output.actualAccountCharge, null);
  assert.equal(typeof output.expired, "boolean");
  assert.ok(Array.isArray((output.catalog as { cards: unknown[] }).cards));
});

test("models prices rejects a missing or unknown provider", async () => {
  const usage = "Usage: vpr models prices --provider <claude|codex|copilot>\n";
  assert.deepEqual(await capture(["models", "prices"]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
  assert.deepEqual(await capture(["models", "prices", "--provider", "other"]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
  assert.deepEqual(await capture(["models", "prices", "--provider", ""]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
});

test("models status rejects a missing or unknown provider", async () => {
  const usage = "Usage: vpr models status --provider <claude|codex|copilot>\n";
  assert.deepEqual(await capture(["models", "status"]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
  assert.deepEqual(await capture(["models", "status", "--provider", "other"]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
});

test("models plan and quota require an input file", async () => {
  assert.deepEqual(await capture(["models", "plan"]), {
    code: 2,
    stdout: "",
    stderr:
      "Usage: vpr models plan --input <workflow-request.json> [--project <path>]\n",
  });
  assert.deepEqual(await capture(["models", "quota"]), {
    code: 2,
    stdout: "",
    stderr: "Usage: vpr models quota --input <before-after.json>\n",
  });
});

test("unknown models subcommand or missing query prints query usage", async () => {
  const usage = "Usage: vpr models query --query <task> [--project <path>]\n";
  assert.deepEqual(await capture(["models"]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
  assert.deepEqual(await capture(["models", "bogus", "--query", "x"]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
  assert.deepEqual(await capture(["models", "query"]), {
    code: 2,
    stdout: "",
    stderr: usage,
  });
});
