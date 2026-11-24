import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentModel } from "@vpr/core";
import { runNativeAgent, type NativeAgentRequest } from "./native-agent.js";
import { installFakeCli, type FakeCli } from "./native-fake-cli.fixture.js";

const removal = {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 100,
};
const claudeModel: AgentModel = {
  id: "worker",
  provider: "claude",
  model: "claude-sonnet-5-5",
  roles: ["coding"],
  tier: "standard",
  effort: "high",
};
const codexModel: AgentModel = {
  id: "terra",
  provider: "codex",
  model: "gpt-6.1-terra",
  roles: ["coding"],
  tier: "standard",
};
const copilotModel: AgentModel = {
  id: "cop",
  provider: "copilot",
  model: "gpt-6.1-terra",
  roles: ["coding"],
  tier: "standard",
};

async function request(
  context: { after(callback: () => Promise<void> | void): void },
  model: AgentModel,
  overrides: Partial<NativeAgentRequest> = {},
): Promise<NativeAgentRequest> {
  const cwd = await mkdtemp(join(tmpdir(), "vpr-native-cwd-"));
  context.after(() => rm(cwd, removal));
  return {
    model,
    cwd,
    prompt: "do the work",
    sessionId: "session-1",
    phase: "implement",
    writeFiles: false,
    allowedPaths: ["src"],
    allowShell: false,
    timeoutMs: 20000,
    ...overrides,
  };
}

function stable(rows: Record<string, unknown>[]) {
  return rows.map(({ wallMs, ...row }) => {
    assert.equal(typeof wallMs, "number");
    return row;
  });
}

const claudeResult = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "claude answer",
    modelUsage: {
      "claude-sonnet-5-5": {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 2,
        cacheCreationInputTokens: 1,
        costUSD: 0.25,
      },
    },
    ...overrides,
  });

const codexLines = (text = "codex answer") => [
  JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text },
  }),
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 20,
      cache_write_input_tokens: 0,
      output_tokens: 30,
    },
  }),
];

const codexPrices = {
  expiresAt: "2999-01-01T00:00:00Z",
  cards: [
    {
      model: "gpt-6.1-terra",
      input: 1,
      output: 2,
      cacheRead: 0.5,
      cacheWrite30m: 1,
      cacheWrite12h: 2,
    },
  ],
};

function withoutGuardArguments(args: string[]) {
  const at = args.indexOf("--plugin-dir");
  assert.ok(at > 0);
  assert.equal(args[at + 2], "--settings");
  assert.equal(at + 4, args.length);
  const settings = JSON.parse(args[at + 3] as string) as Record<
    string,
    unknown
  >;
  return { base: args.slice(0, at), settings };
}

test("claude read-only run reports answer, usage, arguments and scrubbed environment", async (context) => {
  const fake = await installFakeCli("claude", context);
  await fake.setScenario({ lines: [claudeResult()] });
  process.env.ANTHROPIC_API_KEY = "test";
  context.after(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  const input = await request(context, claudeModel, {
    task: "task-1",
    accountKey: null,
  });
  const result = await runNativeAgent(input);
  assert.equal(result.success, true);
  assert.equal(result.failure, null);
  assert.equal(result.answer, "claude answer");
  assert.equal(result.answerTruncated, false);
  assert.equal(result.model, "claude-sonnet-5-5");
  assert.equal(typeof result.wallMs, "number");
  assert.ok(result.receipt);
  assert.equal("diagnostic" in result, false);
  assert.deepEqual(stable(result.usage), [
    {
      provider: "claude",
      sessionId: "session-1",
      parentSessionId: undefined,
      accountKey: null,
      role: "implement",
      task: "task-1",
      id: "implement:final:claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      inputSemantics: "uncached",
      cost: { min: 0.25, max: 0.25, basis: "provider-reported" },
      complete: true,
    },
  ]);
  const [call] = await fake.runCalls();
  assert.ok(call);
  const { base, settings } = withoutGuardArguments(call.args);
  assert.deepEqual(base, [
    "--print",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--model",
    "claude-sonnet-5-5",
    "--effort",
    "high",
    "--max-turns",
    "20",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode",
    "default",
    "--permission-prompts",
    "none",
    "--tools",
    "Read",
    "--allowedTools",
    "Read(./**)",
  ]);
  assert.deepEqual(settings, {
    enabledPlugins: {
      "vpr-context-guard@inline": true,
      "vertical-pair-router@vpr-local": false,
      "vertical-pair-router@inline": false,
      "vertical-pair-router@skills-dir": false,
    },
    modelSettings: { "claude-haiku-5-5": { autoCompactWindow: 100000 } },
  });
  assert.equal(realpathSync.native(call.cwd), realpathSync.native(input.cwd));
  assert.equal(
    call.stdin,
    "Task phase: implement. READ ONLY. Do not modify files. Work only inside the project. Do not access credentials, network, install tools, commit, publish or start more agents. Do not claim unexecuted tests passed.\ndo the work",
  );
  assert.equal(call.env.ANTHROPIC_API_KEY, null);
  assert.equal(call.env.VPR_CAPTURE_DISABLED, "1");
  assert.equal(call.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL, "1");
  assert.equal(call.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, "90");
  const records = await readdir(join(fake.usageHome, "usage", "records"));
  assert.equal(records.length, 1);
});

test("claude write run grants edit tools only inside authorized paths and honours maxTurns", async (context) => {
  const fake = await installFakeCli("claude", context);
  await fake.setScenario({ lines: [claudeResult()] });
  const result = await runNativeAgent(
    await request(context, claudeModel, {
      writeFiles: true,
      allowedPaths: [".", "docs/", "src"],
      maxTurns: 7,
    }),
  );
  assert.equal(result.success, true);
  const [call] = await fake.runCalls();
  assert.ok(call);
  const { base } = withoutGuardArguments(call.args);
  assert.equal(base[base.indexOf("--max-turns") + 1], "7");
  assert.equal(base[base.indexOf("--tools") + 1], "Read,Write,Edit");
  assert.equal(
    base[base.indexOf("--allowedTools") + 1],
    "Read(./**),Write(./**),Edit(./**),Write(./docs),Edit(./docs),Write(./docs/**),Edit(./docs/**),Write(./src),Edit(./src),Write(./src/**),Edit(./src/**)",
  );
  assert.match(
    call.stdin,
    /^Task phase: implement\. Modify only authorized paths: \., docs\/, src Work only/u,
  );
});

test("claude non-zero exit after a successful result is reported as incomplete", async (context) => {
  const fake = await installFakeCli("claude", context);
  await fake.setScenario({ lines: [claudeResult()], exitCode: 1 });
  const result = await runNativeAgent(await request(context, claudeModel));
  assert.equal(result.success, false);
  assert.equal(result.failure, "Native execution did not complete");
  assert.equal(result.answer, "claude answer");
  assert.equal(result.usage.length, 1);
});

test("claude provider errors are classified", async (context) => {
  const fake = await installFakeCli("claude", context);
  const cases: [string, string][] = [
    ["You've hit your usage limit", "provider-limit"],
    [
      "VPR: provider could not count next Haiku request now",
      "context-guard-stopped",
    ],
    ["something else broke", "native-provider-error"],
  ];
  for (const [text, failure] of cases) {
    await fake.setScenario({
      lines: [
        claudeResult({
          is_error: true,
          subtype: "error_during_execution",
          result: text,
        }),
      ],
    });
    const result = await runNativeAgent(await request(context, claudeModel));
    assert.equal(result.success, false);
    assert.equal(result.failure, failure);
    assert.equal(result.answer, text);
    if (failure === "context-guard-stopped")
      assert.equal(
        result.diagnostic,
        "VPR: provider could not count next Haiku request now",
      );
    else assert.equal("diagnostic" in result, false);
  }
});

test("claude success without usage is unavailable and long answers are truncated", async (context) => {
  const fake = await installFakeCli("claude", context);
  await fake.setScenario({ lines: [claudeResult({ modelUsage: {} })] });
  const missing = await runNativeAgent(await request(context, claudeModel));
  assert.equal(missing.success, false);
  assert.equal(missing.failure, "native-usage-unavailable");
  await fake.setScenario({
    lines: [claudeResult({ result: "x".repeat(12001) })],
  });
  const long = await runNativeAgent(await request(context, claudeModel));
  assert.equal(long.success, true);
  assert.equal(long.answer.length, 12000);
  assert.equal(long.answerTruncated, true);
});

test("claude process that never reports a result fails", async (context) => {
  const fake = await installFakeCli("claude", context);
  await fake.setScenario({
    lines: ["not json", JSON.stringify({ type: "system" })],
    exitCode: 0,
  });
  const result = await runNativeAgent(await request(context, claudeModel));
  assert.equal(result.success, false);
  assert.equal(result.failure, "Native execution did not complete");
  assert.equal(result.answer, "");
  assert.deepEqual(result.usage, []);
});

test("claude guard validation failure stops before running the model", async (context) => {
  const fake = await installFakeCli("claude", context);
  await fake.setScenario({
    lines: [claudeResult()],
    guardValidationFails: true,
  });
  const result = await runNativeAgent(await request(context, claudeModel));
  assert.equal(result.success, false);
  assert.equal(result.failure, "context-guard-unverified");
  assert.deepEqual(result.usage, []);
  assert.deepEqual(await fake.runCalls(), []);
});

test("claude abort and deadline stop the process", async (context) => {
  const fake = await installFakeCli("claude", context);
  await fake.setScenario({ hang: true });
  const controller = new AbortController();
  const pending = runNativeAgent(
    await request(context, claudeModel, { signal: controller.signal }),
  );
  await fake.waitForRun();
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.success, false);
  assert.equal(aborted.failure, "cancelled");
  const timedOut = await runNativeAgent(
    await request(context, claudeModel, { timeoutMs: 1000 }),
  );
  assert.equal(timedOut.success, false);
  assert.equal(timedOut.failure, "deadline");
});

test("codex read-only run reports answer, cost, arguments and scrubbed environment", async (context) => {
  const fake = await installFakeCli("codex", context);
  process.env.VPR_CODEX_CLI = fake.executable;
  process.env.OPENAI_API_KEY = "test";
  process.env.CODEX_THREAD_ID = "thread";
  context.after(() => {
    delete process.env.VPR_CODEX_CLI;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_THREAD_ID;
  });
  await fake.setScenario({ lines: codexLines() });
  const input = await request(context, codexModel, {
    codexPrices,
    parentSessionId: "parent",
  });
  const result = await runNativeAgent(input);
  assert.equal(result.success, true);
  assert.equal(result.failure, null);
  assert.equal(result.answer, "codex answer");
  assert.equal(result.answerTruncated, false);
  assert.equal("receipt" in result, false);
  assert.deepEqual(stable(result.usage), [
    {
      provider: "codex",
      sessionId: "session-1",
      parentSessionId: "parent",
      accountKey: undefined,
      role: "implement",
      task: undefined,
      id: "implement:final",
      model: "gpt-6.1-terra",
      inputTokens: 80,
      inputIncludingCacheTokens: 100,
      outputTokens: 30,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      inputSemantics: "uncached",
      modelIdentity: "requested-only",
      cost: { min: 150 / 1e6, max: 150 / 1e6, basis: "official-reference" },
      complete: true,
    },
  ]);
  const [call] = await fake.runCalls();
  assert.ok(call);
  assert.deepEqual(call.args, [
    "--no-daemon",
    "-a",
    "never",
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--json",
    "-C",
    input.cwd,
    "-m",
    "gpt-6.1-terra",
    "-c",
    'model_reasoning_effort="medium"',
    "-c",
    "features.multi_agent=false",
    "-c",
    'web_search="disabled"',
    "-c",
    "sandbox_workspace_write.network_access=false",
    "-",
  ]);
  assert.match(call.stdin, /^Task phase: implement\. READ ONLY\./u);
  assert.equal(call.env.OPENAI_API_KEY, null);
  assert.equal(call.env.CODEX_THREAD_ID, null);
  assert.equal(call.env.VPR_CAPTURE_DISABLED, "1");
  assert.equal(call.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, null);
});

test("codex without prices has no cost and write mode needs shell authorization", async (context) => {
  const fake = await installFakeCli("codex", context);
  process.env.VPR_CODEX_CLI = fake.executable;
  context.after(() => {
    delete process.env.VPR_CODEX_CLI;
  });
  await fake.setScenario({ lines: codexLines() });
  const noPrices = await runNativeAgent(await request(context, codexModel));
  assert.equal(noPrices.usage[0]?.cost, null);
  await assert.rejects(
    runNativeAgent(await request(context, codexModel, { writeFiles: true })),
    /Codex implementation requires project shell authorization; no permission override/u,
  );
  assert.equal((await fake.runCalls()).length, 1);
  const writing = await runNativeAgent(
    await request(context, codexModel, {
      writeFiles: true,
      allowShell: true,
      model: { ...codexModel, effort: "high" },
    }),
  );
  assert.equal(writing.success, true);
  const call = (await fake.runCalls())[1];
  assert.ok(call);
  assert.equal(
    call.args[call.args.indexOf("--sandbox") + 1],
    "workspace-write",
  );
  assert.equal(
    call.args[call.args.indexOf("-c") + 1],
    'model_reasoning_effort="high"',
  );
  assert.match(
    call.stdin,
    /^Task phase: implement\. Modify only authorized paths: src Work only/u,
  );
});

test("codex expired prices and failing exit are reported", async (context) => {
  const fake = await installFakeCli("codex", context);
  process.env.VPR_CODEX_CLI = fake.executable;
  context.after(() => {
    delete process.env.VPR_CODEX_CLI;
  });
  await fake.setScenario({ lines: codexLines(), exitCode: 2 });
  const expired = await runNativeAgent(
    await request(context, codexModel, {
      codexPrices: { ...codexPrices, expiresAt: "2000-01-01T00:00:00Z" },
    }),
  );
  assert.equal(expired.success, false);
  assert.equal(expired.failure, "Native execution did not complete");
  assert.equal(expired.answer, "codex answer");
  assert.equal(expired.usage[0]?.cost, null);
  await fake.setScenario({ lines: [] });
  const silent = await runNativeAgent(await request(context, codexModel));
  assert.equal(silent.success, false);
  assert.equal(silent.failure, "Native execution did not complete");
  assert.deepEqual(silent.usage, []);
  await fake.setScenario({ lines: codexLines("y".repeat(12005)) });
  const long = await runNativeAgent(await request(context, codexModel));
  assert.equal(long.answer.length, 12000);
  assert.equal(long.answerTruncated, true);
});

test("codex abort and deadline stop the process", async (context) => {
  const fake = await installFakeCli("codex", context);
  process.env.VPR_CODEX_CLI = fake.executable;
  context.after(() => {
    delete process.env.VPR_CODEX_CLI;
  });
  await fake.setScenario({ hang: true });
  const controller = new AbortController();
  const pending = runNativeAgent(
    await request(context, codexModel, { signal: controller.signal }),
  );
  await fake.waitForRun();
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.success, false);
  assert.equal(aborted.failure, "cancelled");
  const timedOut = await runNativeAgent(
    await request(context, codexModel, { timeoutMs: 1000 }),
  );
  assert.equal(timedOut.success, false);
  assert.equal(timedOut.failure, "deadline");
});

test(
  "codex windows execution probe failure is reported without running the model",
  { skip: process.platform !== "win32" },
  async (context) => {
    const fake = await installFakeCli("codex", context);
    process.env.VPR_CODEX_CLI = fake.executable;
    context.after(() => {
      delete process.env.VPR_CODEX_CLI;
    });
    await fake.setScenario({ lines: codexLines(), probeReady: false });
    const result = await runNativeAgent(await request(context, codexModel));
    assert.equal(result.success, false);
    assert.equal(result.failure, "native-execution-unavailable");
    assert.equal(
      result.diagnostic,
      "Codex Windows execution preflight failed; inspect the native CLI locally",
    );
    assert.deepEqual(result.usage, []);
    assert.deepEqual(await fake.runCalls(), []);
    assert.equal((await fake.calls()).length, 1);
  },
);

test("shared preamble rejects haiku on other providers and unavailable executables", async (context) => {
  const guarded = await runNativeAgent(
    await request(context, { ...codexModel, model: "claude-haiku-5-5" }),
  );
  assert.deepEqual(guarded, {
    success: false,
    answer: "",
    model: "claude-haiku-5-5",
    usage: [],
    wallMs: 0,
    failure: "context-guard-unverified",
  });
  process.env.VPR_CODEX_CLI = "relative-codex";
  context.after(() => {
    delete process.env.VPR_CODEX_CLI;
  });
  await assert.rejects(
    runNativeAgent(await request(context, codexModel)),
    /Native CLI unavailable/u,
  );
  await assert.rejects(
    runNativeAgent(await request(context, codexModel, { allowedPaths: [] })),
    /Invalid bounded native execution/u,
  );
  await assert.rejects(
    runNativeAgent(
      await request(context, codexModel, { allowedPaths: ["../escape"] }),
    ),
    /Invalid bounded native execution/u,
  );
  await assert.rejects(
    runNativeAgent(await request(context, codexModel, { timeoutMs: 999 })),
    /Invalid bounded native execution/u,
  );
});

test("copilot process that never speaks the protocol hits the deadline", async (context) => {
  const fake: FakeCli = await installFakeCli("copilot", context);
  process.env.VPR_COPILOT_CLI = fake.executable;
  context.after(() => {
    delete process.env.VPR_COPILOT_CLI;
  });
  await fake.setScenario({ exitCode: 1 });
  const result = await runNativeAgent(
    await request(context, copilotModel, { timeoutMs: 1000 }),
  );
  assert.equal(result.success, false);
  assert.equal(result.answer, "");
  assert.equal(result.failure, "deadline");
  assert.deepEqual(result.usage, []);
});
