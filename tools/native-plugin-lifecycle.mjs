import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, cp, readFile, writeFile, realpath, rm } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";
import { tmpdir } from "node:os";
import { resolveExecutable, resolveProgramCommand } from "@vpr/runtime";
const packageRoot = resolve(
  process.argv[2] ?? ".tmp/package-smoke/node_modules/vertical-pair-router",
);
const executable = await resolveExecutable("claude");
assert.ok(executable, "Install the pinned Claude CLI before lifecycle verification");
const root = await mkdtemp(join(tmpdir(), "vpr-native-lifecycle-")),
  catalog = join(root, "catalog"),
  plugin = join(catalog, "plugin");
const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, "claude-config") };
for (const key of [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "CLAUDE_CODE_PLUGIN_DIRS",
])
  delete env[key];
const steps = [];
function command(name, args) {
  const value = execFileSync(executable, args, {
    cwd: root,
    env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1048576,
  });
  steps.push({ name, exitCode: 0 });
  return value;
}
const id = "vertical-pair-router@vpr-local";
async function version(value) {
  const path = join(plugin, ".claude-plugin/plugin.json"),
    manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.version = value;
  await writeFile(path, JSON.stringify(manifest));
}
function installed(expected) {
  const list = JSON.parse(command("list-" + expected, ["plugin", "list", "--json"]));
  const item = list.find((value) => value.id === id);
  assert.equal(item?.version, expected);
  assert.equal(item.enabled, true);
}
try {
  await mkdir(join(catalog, ".claude-plugin"), { recursive: true });
  await cp(join(packageRoot, "plugin"), plugin, {
    recursive: true,
    filter: (path) => basename(path) !== "node_modules",
  });
  await cp(
    join(packageRoot, ".claude-plugin/marketplace.json"),
    join(catalog, ".claude-plugin/marketplace.json"),
  );
  const current = JSON.parse(
      await readFile(join(plugin, ".claude-plugin/plugin.json"), "utf8"),
    ).version,
    previous = "0.0.0-lifecycle.1";
  const npm = await resolveProgramCommand("npm");
  assert.ok(npm);
  execFileSync(npm.program, [...npm.prefix, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: plugin,
    env,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 1048576,
  });
  steps.push({ name: "frozen-runtime-install", exitCode: 0 });
  await version(previous);
  const validation = JSON.parse(
    command("validate", ["plugin", "validate", "--strict", "--json", plugin]),
  );
  assert.equal(validation.success, true);
  assert.ok(
    !validation.directoryFindings?.some((finding) => finding.code === "README_MISSING"),
    "The independently copied plugin must include its own README",
  );
  command("install", [
    "plugin",
    "install",
    "vertical-pair-router",
    "--marketplace",
    catalog,
    "--scope",
    "user",
    "--json",
  ]);
  installed(previous);
  await version(current);
  command("update", ["plugin", "update", id, "--json"]);
  installed(current);
  const doctor = JSON.parse(
    execFileSync(
      process.execPath,
      [join(plugin, "bin/vpr.mjs"), "tools", "doctor", "--project", root],
      { cwd: root, env, windowsHide: true, encoding: "utf8", timeout: 30000 },
    ),
  );
  assert.equal(doctor.inferenceTokens, 0);
  steps.push({ name: "isolated-plugin-cli", exitCode: 0 });
  execFileSync(process.execPath, [join(packageRoot, "bin/vpr.mjs"), "plugin", "install"], {
    cwd: root,
    env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1048576,
  });
  steps.push({ name: "migrate-install-location", exitCode: 0 });
  installed(current);
  command("unregister-before-rollback", ["plugin", "uninstall", id, "--scope", "user", "--json"]);
  command("remove-catalog-before-rollback", [
    "plugin",
    "marketplace",
    "remove",
    "vpr-local",
    "--json",
  ]);
  await version(previous);
  command("rollback", [
    "plugin",
    "install",
    "vertical-pair-router",
    "--marketplace",
    catalog,
    "--scope",
    "user",
    "--json",
  ]);
  installed(previous);
  command("uninstall", ["plugin", "uninstall", id, "--scope", "user", "--json"]);
  assert.ok(
    !JSON.parse(command("list-uninstalled", ["plugin", "list", "--json"])).some(
      (item) => item.id === id,
    ),
  );
  const evidence = {
    at: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    host: command("host-version", ["--version"]).trim(),
    passed: true,
    steps,
    inferenceTokens: 0,
    scope:
      "Native plugin install/update/rollback/uninstall with fixture versions of the same code. No account sign-in or generative delegation; those require a separate provider pilot.",
  };
  const out = resolve(".tmp/native-plugin-lifecycle-" + process.platform + ".json");
  await mkdir(resolve(out, ".."), { recursive: true });
  await writeFile(out, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  const local = relative(await realpath(tmpdir()), await realpath(root));
  assert.ok(
    local && !local.startsWith("..") && !/^[a-z]:/iu.test(local),
    "Cleanup must remain under the OS temporary directory",
  );
  await rm(root, { recursive: true, force: true });
}
