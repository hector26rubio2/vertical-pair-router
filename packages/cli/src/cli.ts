import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import type { EntityId, Run } from "@vpr/contracts";
import { applyProjectProfile, proposeProjectProfile } from "@vpr/config";
import { createSafeProcessRunner } from "@vpr/quality";
import {
  CapabilityRegistry,
  executeCheckRun,
  resolveExecutable
} from "@vpr/runtime";
import { SqliteStorage } from "@vpr/storage-sqlite";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value)
};

export async function runCli(args: readonly string[], io: CliIo = defaultIo): Promise<number> {
  if (args[0] === "init") return runInit(args.slice(1), io);
  if (args[0] !== "doctor") return usage(io);

  const dbFlag = args.indexOf("--db");
  const dbValue = dbFlag >= 0 ? args[dbFlag + 1] : undefined;
  if (dbValue === undefined || dbValue.length === 0) {
    io.stderr("Missing required --db path\n");
    return 2;
  }
  const dbPath = isAbsolute(dbValue) ? dbValue : resolve(process.cwd(), dbValue);
  const storage = new SqliteStorage(dbPath);
  await storage.initialize();

  const now = (): string => new Date().toISOString();
  const run: Run = {
    runId: id("run"),
    taskId: id("task"),
    state: "PENDING",
    revision: 0,
    createdAt: now(),
    updatedAt: now()
  };

  try {
    const resolvedPrograms = {
      git: (await resolveExecutable("git")) ?? "git",
      pnpm: (await resolveExecutable("pnpm")) ?? "pnpm",
      powershell: (await resolveExecutable("pwsh")) ?? "pwsh"
    };
    const processRunner = createSafeProcessRunner([
      process.execPath,
      ...Object.values(resolvedPrograms)
    ]);
    const result = await executeCheckRun({
      projectId: id("project"),
      storyId: id("story"),
      run,
      actor: "vpr-cli",
      checkName: "node-version",
      request: {
        program: process.execPath,
        args: ["--version"],
        cwd: process.cwd(),
        timeoutMs: 5_000,
        maxOutputBytes: 16_384
      },
      processRunner,
      storage,
      now,
      nextId: (prefix) => id(prefix)
    });
    const registry = new CapabilityRegistry(
      [
        { id: "node", program: process.execPath, args: ["--version"], cwd: process.cwd(), ttlMs: 300_000 },
        { id: "git", program: resolvedPrograms.git, args: ["--version"], cwd: process.cwd(), ttlMs: 300_000 },
        { id: "pnpm", program: resolvedPrograms.pnpm, args: ["--version"], cwd: process.cwd(), ttlMs: 300_000 },
        { id: "powershell", program: resolvedPrograms.powershell, args: ["--version"], cwd: process.cwd(), ttlMs: 300_000 }
      ],
      processRunner
    );
    const capabilities = await Promise.all(
      ["node", "git", "pnpm", "powershell"].map((capability) => registry.get(capability))
    );
    io.stdout(
      `${JSON.stringify({
        runId: result.run.runId,
        state: result.run.state,
        evidence: result.evidence,
        capabilities
      })}\n`
    );
    return result.run.state === "COMPLETED" ? 0 : 1;
  } finally {
    await storage.close();
  }
}

async function runInit(args: readonly string[], io: CliIo): Promise<number> {
  const projectFlag = args.indexOf("--project");
  const project = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
  if (project === undefined || project.length === 0) {
    io.stderr("Missing required --project path\n");
    return 2;
  }
  const proposal = await proposeProjectProfile(project);
  const apply = args.includes("--apply");
  if (apply) {
    await applyProjectProfile(proposal);
  }
  io.stdout(
    `${JSON.stringify({
      action: proposal.action,
      target: proposal.target,
      beforeHash: proposal.beforeHash,
      profile: proposal.profile,
      applied: apply && proposal.action !== "none"
    })}\n`
  );
  return 0;
}

function usage(io: CliIo): number {
  io.stderr(
    "Usage: vpr doctor --db <path> | vpr init --project <path> [--apply]\n"
  );
  return 2;
}

function id(prefix: "project" | "story" | "task" | "run" | "evt" | "evd"): EntityId {
  return `${prefix}_${randomUUID()}` as EntityId;
}

