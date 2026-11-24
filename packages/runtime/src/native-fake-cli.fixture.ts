import { execFile } from "node:child_process";
import {
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

export interface FakeScenario {
  lines?: string[];
  exitCode?: number;
  hang?: boolean;
  guardValidationFails?: boolean;
  probeReady?: boolean;
}

export interface FakeCall {
  kind: "run" | "validate" | "probe";
  args: string[];
  cwd: string;
  stdin: string;
  env: Record<string, string | null>;
}

const fakeScript = `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(process.env.VPR_FAKE_SCENARIO, "utf8"));
const kind = args[0] === "plugin" && args[1] === "validate" ? "validate" : args.includes("sandbox") ? "probe" : "run";
let stdin = "";
if (kind === "run") {
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) stdin += chunk;
}
const watched = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GH_TOKEN", "CODEX_THREAD_ID", "VPR_CAPTURE_DISABLED", "CLAUDE_CODE_DISABLE_ADVISOR_TOOL", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"];
const env = Object.fromEntries(watched.map((name) => [name, process.env[name] ?? null]));
appendFileSync(process.env.VPR_FAKE_LOG, JSON.stringify({ kind, args, cwd: process.cwd(), stdin, env }) + "\\n");
if (kind === "validate") {
  const hooks = scenario.guardValidationFails ? [] : [{ hook: "http.fetch", hasCatch: true }];
  process.stdout.write(JSON.stringify({ success: true, contents: [{ gatingHooks: hooks }] }));
  process.exit(0);
}
if (kind === "probe") {
  if (scenario.probeReady === false) process.exit(1);
  process.stdout.write("VPR_EXECUTION_READY\\n");
  process.exit(0);
}
for (const line of scenario.lines ?? []) process.stdout.write(line + "\\n");
if (scenario.hang) setInterval(() => {}, 1000);
else process.exit(scenario.exitCode ?? 0);
`;

const launcherSource = `using System;
using System.Diagnostics;
class Launcher {
  static int Main() {
    string line = Environment.CommandLine;
    int end;
    if (line.StartsWith("\\"")) end = line.IndexOf('"', 1) + 1;
    else { end = line.IndexOf(' '); if (end < 0) end = line.Length; }
    string rest = line.Substring(end);
    ProcessStartInfo info = new ProcessStartInfo(Environment.GetEnvironmentVariable("VPR_FAKE_NODE"));
    info.UseShellExecute = false;
    info.Arguments = "\\"" + Environment.GetEnvironmentVariable("VPR_FAKE_SCRIPT") + "\\"" + rest;
    Process child = Process.Start(info);
    child.WaitForExit();
    return child.ExitCode;
  }
}
`;

let compiledLauncher: Promise<string> | undefined;

async function compileLauncher(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vpr-fake-launcher-"));
  const source = join(directory, "launcher.cs");
  const output = join(directory, "launcher.exe");
  await writeFile(source, launcherSource);
  const compiler = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  await promisify(execFile)(compiler, ["/nologo", "/out:" + output, source], {
    windowsHide: true,
  });
  return output;
}

async function installExecutable(
  directory: string,
  name: string,
): Promise<string> {
  if (process.platform === "win32") {
    compiledLauncher ??= compileLauncher();
    const path = join(directory, name + ".exe");
    await copyFile(await compiledLauncher, path);
    return path;
  }
  const path = join(directory, name);
  await writeFile(
    path,
    '#!/bin/sh\nexec "$VPR_FAKE_NODE" "$VPR_FAKE_SCRIPT" "$@"\n',
  );
  await chmod(path, 0o755);
  return path;
}

export interface FakeCli {
  directory: string;
  executable: string;
  usageHome: string;
  setScenario(scenario: FakeScenario): Promise<void>;
  calls(): Promise<FakeCall[]>;
  runCalls(): Promise<FakeCall[]>;
  waitForRun(): Promise<void>;
}

export async function installFakeCli(
  name: string,
  cleanups: { after(callback: () => Promise<void> | void): void },
): Promise<FakeCli> {
  const directory = await mkdtemp(join(tmpdir(), "vpr-fake-cli-"));
  const binaries = join(directory, "bin");
  const home = join(directory, "home");
  const usageHome = join(directory, "usage-home");
  await mkdir(binaries);
  await mkdir(home);
  await mkdir(usageHome);
  const script = join(directory, "fake.mjs");
  const scenarioPath = join(directory, "scenario.json");
  const logPath = join(directory, "calls.jsonl");
  await writeFile(script, fakeScript);
  await writeFile(scenarioPath, "{}");
  await writeFile(logPath, "");
  const executable = await installExecutable(binaries, name);
  const originals = new Map<string, string | undefined>();
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const overrides: Record<string, string> = {
    VPR_FAKE_NODE: process.execPath,
    VPR_FAKE_SCRIPT: script,
    VPR_FAKE_SCENARIO: scenarioPath,
    VPR_FAKE_LOG: logPath,
    VPR_USAGE_HOME: usageHome,
    HOME: home,
    USERPROFILE: home,
    [pathKey]: binaries + delimiter + (process.env[pathKey] ?? ""),
  };
  for (const [key, value] of Object.entries(overrides)) {
    originals.set(key, process.env[key]);
    process.env[key] = value;
  }
  cleanups.after(async () => {
    for (const [key, value] of originals)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  });
  const calls = async () =>
    (await readFile(logPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakeCall);
  return {
    directory,
    executable,
    usageHome,
    async setScenario(scenario) {
      await writeFile(scenarioPath, JSON.stringify(scenario));
      await writeFile(logPath, "");
    },
    calls,
    runCalls: async () => (await calls()).filter((call) => call.kind === "run"),
    async waitForRun() {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if ((await calls()).some((call) => call.kind === "run")) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Fake CLI never started");
    },
  };
}
