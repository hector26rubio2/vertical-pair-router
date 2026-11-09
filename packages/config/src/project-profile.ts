import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { EntityId, PolicyRules } from "@vpr/contracts";

export interface CheckCommand {
  readonly program: string;
  readonly args: readonly string[];
}

export interface ProjectProfileV1 {
  readonly schemaVersion: 1;
  readonly projectId: EntityId;
  readonly name: string;
  readonly packageManager: "pnpm" | "npm" | "yarn" | "unknown";
  readonly checks: Readonly<Record<string, CheckCommand>>;
  readonly glossaryPath: string;
  readonly policy: PolicyRules;
}

export interface ProjectProfileProposal {
  readonly action: "create" | "update" | "none";
  readonly target: string;
  readonly beforeHash: string | null;
  readonly profile: ProjectProfileV1;
  readonly content: string;
}

export class ProfileChangedError extends Error {
  public constructor(target: string) {
    super(`Profile changed after preview: ${target}`);
    this.name = "ProfileChangedError";
  }
}

export async function proposeProjectProfile(rootInput: string): Promise<ProjectProfileProposal> {
  const root = resolve(rootInput);
  const packageJsonPath = join(root, "package.json");
  const packageJson = await readJsonObject(packageJsonPath);
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const packageManager = await detectPackageManager(root);
  const checks = Object.fromEntries(
    ["build", "lint", "test", "typecheck"]
      .filter(
        (name) => packageManager !== "unknown" && typeof scripts[name] === "string"
      )
      .map((name) => [name, { program: packageManager, args: [name] }])
  ) as Readonly<Record<string, CheckCommand>>;
  const projectName =
    typeof packageJson.name === "string" && packageJson.name.length > 0
      ? packageJson.name
      : basename(root);
  const profile: ProjectProfileV1 = {
    schemaVersion: 1,
    projectId: `project_${sha256(root).slice(0, 20)}`,
    name: projectName,
    packageManager,
    checks,
    glossaryPath: "GLOSSARY.md",
    policy: {
      allowShell: false,
      allowNetworkTelemetry: false,
      allowedProviders: ["local"],
      maxOutputBytes: 1_048_576
    }
  };
  const content = `${JSON.stringify(profile, null, 2)}\n`;
  const target = join(root, ".vpr", "profile.json");
  const current = await readOptional(target);

  return {
    action: current === null ? "create" : current === content ? "none" : "update",
    target,
    beforeHash: current === null ? null : sha256(current),
    profile,
    content
  };
}

export async function applyProjectProfile(proposal: ProjectProfileProposal): Promise<void> {
  const current = await readOptional(proposal.target);
  const currentHash = current === null ? null : sha256(current);
  if (currentHash !== proposal.beforeHash) {
    throw new ProfileChangedError(proposal.target);
  }
  if (proposal.action === "none") {
    return;
  }

  const directory = dirname(proposal.target);
  await mkdir(directory, { recursive: true });
  if (proposal.action === "update") {
    await copyFile(proposal.target, `${proposal.target}.bak`);
  }
  const temporary = `${proposal.target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, proposal.content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, proposal.target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function detectPackageManager(
  root: string
): Promise<ProjectProfileV1["packageManager"]> {
  if (await exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(root, "package-lock.json"))) return "npm";
  if (await exists(join(root, "yarn.lock"))) return "yarn";
  return "unknown";
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new TypeError(`Expected a JSON object at ${path}`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

