import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { BacklogService, createStoryDraftFromGrill } from "@vpr/backlog";
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
  if (args[0] === "story") return runStory(args.slice(1), io);
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

async function runStory(args: readonly string[], io: CliIo): Promise<number> {
  const db = flagValue(args, "--db");
  const projectId = flagValue(args, "--project-id");
  const input = flagValue(args, "--input");
  if (db === undefined || projectId === undefined || input === undefined) {
    io.stderr("Missing required --db, --project-id or --input\n");
    return 2;
  }
  if (!projectId.startsWith("project_")) {
    io.stderr("--project-id must start with project_\n");
    return 2;
  }
  const storage = new SqliteStorage(isAbsolute(db) ? db : resolve(process.cwd(), db));
  await storage.initialize();
  try {
    const source = parseStoryInput(JSON.parse(await readFile(
      isAbsolute(input) ? input : resolve(process.cwd(), input),
      "utf8"
    )));
    const service = new BacklogService({
      projectId: projectId as EntityId,
      storage,
      actor: "vpr-cli",
      confirmation: "required",
      now: () => new Date().toISOString(),
      nextId: (prefix) => `${prefix}_${randomUUID()}` as EntityId
    });
    const proposal = await service.previewStory(createStoryDraftFromGrill({
      projectId: projectId as EntityId,
      ...source
    }));
    const apply = args.includes("--apply");
    const story = apply
      ? await service.commitStory(proposal, { confirmed: true })
      : undefined;
    io.stdout(`${JSON.stringify({
      action: proposal.action,
      applied: apply && proposal.action === "create",
      ...(story === undefined ? {} : { story })
    })}\n`);
    return 0;
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
    "Usage: vpr doctor --db <path> | vpr init --project <path> [--apply] | " +
      "vpr story --db <path> --project-id <id> --input <json> [--apply]\n"
  );
  return 2;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === undefined || value.length === 0 ? undefined : value;
}

interface StoryInput {
  readonly title: string;
  readonly need: string;
  readonly desiredOutcome: string;
  readonly acceptanceCriteria: readonly string[];
  readonly exclusions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly attachments: readonly string[];
}

function parseStoryInput(value: unknown): StoryInput {
  if (!isRecord(value)) throw new TypeError("Story input must be a JSON object");
  const strings = ["title", "need", "desiredOutcome"] as const;
  for (const field of strings) {
    if (typeof value[field] !== "string") throw new TypeError(`Story ${field} must be a string`);
  }
  const arrays = ["acceptanceCriteria", "exclusions", "openQuestions", "attachments"] as const;
  for (const field of arrays) {
    if (!Array.isArray(value[field]) || !value[field].every((item) => typeof item === "string")) {
      throw new TypeError(`Story ${field} must be a string array`);
    }
  }
  return value as unknown as StoryInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function id(prefix: "project" | "story" | "task" | "run" | "evt" | "evd"): EntityId {
  return `${prefix}_${randomUUID()}` as EntityId;
}

