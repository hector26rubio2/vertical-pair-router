import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Script, createContext } from "node:vm";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolveExecutable } from "@vpr/runtime";
import { verifyModelReceipt } from "@vpr/observability";

if (!process.argv.includes("--approve-provider"))
  throw new Error("Use --approve-provider to authorize this bounded Claude account experiment");
const executable = await resolveExecutable("claude");
if (!executable) throw new Error("Claude Code unavailable");
const cwd = await mkdtemp(join(tmpdir(), "vpr-model-experiment-"));
const specs = [
  {
    name: "normalizeSku",
    requirement:
      "normalizeSku(value): require a string, otherwise throw TypeError. Trim ends, collapse each run of whitespace into a single hyphen and lowercase. Return the string.",
    cases: [
      [["  BLUE   Hat "], "blue-hat"],
      [["A\tB"], "a-b"],
      [[""], ""],
      [[12], "throws"],
    ],
  },
  {
    name: "shippingCents",
    requirement:
      "shippingCents(subtotal, grams, expedited): subtotal and grams must be nonnegative safe integers, expedited boolean, otherwise throw TypeError. Base " +
      "shipping 499 cents plus 100 cents per STARTED kg. Waive base and weight charge if subtotal >=10000; expedited adds 700 even when waived.",
    cases: [
      [[1000, 1001, false], 699],
      [[10000, 2500, false], 0],
      [[10000, 2500, true], 700],
      [[0, 0, false], 499],
      [[-1, 0, false], "throws"],
    ],
  },
  {
    name: "discountCents",
    requirement:
      "discountCents(gross, basisPoints): require nonnegative safe integers, basisPoints <=10000, otherwise throw TypeError. Return floor(gross * basisPoints / 10000), computed exactly with BigInt then converted to Number.",
    cases: [
      [[999, 1500], 149],
      [[1234, 10000], 1234],
      [[1234, 0], 0],
      [[9007199254740991, 5000], 4503599627370495],
      [[100, 10001], "throws"],
    ],
  },
];
function jsonText(text) {
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/u, "")
      .replace(/\s*```$/u, ""),
  );
}
async function call(model, role, prompt) {
  const started = performance.now();
  const child = spawn(
    executable,
    [
      "--print",
      "--model",
      model,
      "--max-turns",
      "1",
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "",
      "--permission-mode",
      "plan",
    ],
    { cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let data = "",
    diagnostics = "",
    bytes = 0;
  child.stderr?.on("data", (chunk) => {
    if (diagnostics.length < 2000) diagnostics += chunk.toString();
  });
  const timer = setTimeout(() => child.kill(), 90_000);
  const pending = new Promise((done, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) child.kill();
      else data += chunk.toString();
    });
    child.once("close", (code) => {
      if (code === 0) return done();
      const errorResult = data.split(/\r?\n/u).flatMap((line) => {
        try {
          const value = JSON.parse(line);
          return value.is_error ? [String(value.result ?? value.error ?? value.subtype)] : [];
        } catch {
          return [];
        }
      });
      reject(
        new Error(
          "Provider failed for " +
            role +
            ": " +
            (errorResult.join("; ") || diagnostics).slice(0, 400),
        ),
      );
    });
  });
  child.stdin.end(prompt);
  try {
    await pending;
  } finally {
    clearTimeout(timer);
  }
  const events = data
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const result = events.findLast((event) => event.type === "result");
  if (!result || result.is_error || !result.usage)
    throw new Error("Missing successful usage receipt for " + role);
  const observedModels = [
    ...new Set(
      events
        .filter((event) => event.type === "assistant")
        .map((event) => event.message?.model)
        .filter(Boolean),
    ),
  ];
  const usage = result.usage;
  const receipt = {
    role,
    requestedModel: model,
    observedModels,
    modelVerification: verifyModelReceipt(model, observedModels).status,
    durationMs: Math.round(performance.now() - started),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteInputTokens: usage.cache_creation_input_tokens ?? 0,
    source: "provider_reported",
  };
  for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteInputTokens"])
    if (!Number.isSafeInteger(receipt[key]) || receipt[key] < 0)
      throw new Error("Invalid usage counter");
  return { answer: jsonText(result.result), receipt };
}
function check(code, selectedSpecs) {
  if (typeof code !== "string" || code.length > 20000) return false;
  // Only pure fixture functions; no Node globals, imports or timers. Each call is bounded.
  const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
  try {
    new Script(code).runInContext(context, { timeout: 500 });
    for (const spec of selectedSpecs)
      for (const [args, expected] of spec.cases) {
        let value,
          threw = false;
        try {
          value = new Script(`${spec.name}(...${JSON.stringify(args)})`).runInContext(context, {
            timeout: 100,
          });
        } catch {
          threw = true;
        }
        if (expected === "throws" ? !threw : threw || value !== expected) return false;
      }
    return true;
  } catch {
    return false;
  }
}
const request = (list) =>
  'Implement these pure JavaScript functions. No imports, tools or side effects. Return ONLY JSON {"code":"function definitions"}. Requirements: ' +
  list.map((spec) => spec.requirement).join("\n");
console.log("Running single-model baseline");
const baseline = await call("sonnet", "baseline-worker", request(specs));
console.log("Running decomposition coordinator");
const coordinator = await call(
  "sonnet",
  "coordinator",
  'Plan these independent pure function implementations. Return ONLY JSON {"tasks":[{"name":"...","model":"haiku"}]}, exactly one task per function. Requirements: ' +
    specs.map((spec) => spec.requirement).join("\n"),
);
if (
  !Array.isArray(coordinator.answer.tasks) ||
  coordinator.answer.tasks.length !== specs.length ||
  specs.some(
    (spec) =>
      coordinator.answer.tasks.filter((task) => task.name === spec.name && task.model === "haiku")
        .length !== 1,
  )
)
  throw new Error("Coordinator decomposition did not match acceptance");
const workers = [];
for (let index = 0; index < specs.length; index += 2) {
  console.log("Running worker batch " + (index / 2 + 1));
  workers.push(
    ...(await Promise.all(
      specs.slice(index, index + 2).map((spec) => call("haiku", spec.name, request([spec]))),
    )),
  );
}
const total = (receipts) =>
  receipts.reduce(
    (sum, row) =>
      sum + row.inputTokens + row.outputTokens + row.cachedInputTokens + row.cacheWriteInputTokens,
    0,
  );
const before = [baseline.receipt],
  after = [coordinator.receipt, ...workers.map((worker) => worker.receipt)];
const baselinePassed = check(baseline.answer.code, specs);
const optimizedPassed =
  workers.every((worker, index) => check(worker.answer.code, [specs[index]])) &&
  check(workers.map((worker) => worker.answer.code).join("\n"), specs);
const report = {
  scenario:
    "Three independent pure-function implementations; exploratory microbenchmark, not full VPR delegation",
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  acceptanceHash: createHash("sha256").update(JSON.stringify(specs)).digest("hex"),
  maxParallelWorkers: 2,
  baseline: { passed: baselinePassed, receipts: before, tokens: total(before) },
  split: { passed: optimizedPassed, receipts: after, tokens: total(after) },
  savedTokens: baselinePassed && optimizedPassed ? total(before) - total(after) : null,
  includesCoordinator: true,
  review: "Deterministic fixture checks; no model reviewer",
  inferenceUsedForMeter: false,
};
const directory = resolve(".vpr", "benchmarks");
await mkdir(directory, { recursive: true });
const target = join(directory, "delegation-" + Date.now() + ".json");
await writeFile(target, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ report: target, ...report }));
