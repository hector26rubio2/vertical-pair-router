import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { BacklogService, createStoryDraftFromGrill } from "@vpr/backlog";
import type { EntityId, Run } from "@vpr/contracts";
import { createDashboardServer } from "@vpr/dashboard";
import { applyProjectProfile, parseProjectProfile, proposeProjectProfile } from "@vpr/config";
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
  if (args[0] === "data") return runData(args.slice(1), io);
  if (args[0] === "dashboard") return runDashboard(args.slice(1), io);
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

async function runData(args: readonly string[], io: CliIo): Promise<number> {
  const action = args[0];
  const db = flagValue(args, "--db");
  const projectId = flagValue(args, "--project-id");
  if (db === undefined || projectId === undefined || !projectId.startsWith("project_")) {
    io.stderr("Data command requires --db and a --project-id starting with project_\n");
    return 2;
  }
  const storage = new SqliteStorage(isAbsolute(db) ? db : resolve(process.cwd(), db));
  await storage.initialize();
  try {
    if (action === "export") {
      const out = flagValue(args, "--out");
      if (out === undefined) {
        io.stderr("Data export requires --out\n");
        return 2;
      }
      const target = isAbsolute(out) ? out : resolve(process.cwd(), out);
      const content = await storage.exportJsonl(projectId as EntityId);
      await writeFile(target, content, { encoding: "utf8", flag: "wx" });
      io.stdout(`${JSON.stringify({
        action: "export",
        target,
        events: content.length === 0 ? 0 : content.trimEnd().split("\n").length
      })}\n`);
      return 0;
    }
    if (action === "delete") {
      const confirmation = flagValue(args, "--confirm");
      if (confirmation === undefined) {
        io.stderr("Data delete requires --confirm <project-id>\n");
        return 2;
      }
      const deleted = await storage.deleteProjectData(projectId as EntityId, confirmation);
      io.stdout(`${JSON.stringify({ action: "delete", projectId, deleted })}\n`);
      return 0;
    }
    if (action === "retention") {
      const cutoff = flagValue(args, "--before");
      if (cutoff === undefined || !Number.isFinite(Date.parse(cutoff))) {
        io.stderr("Data retention requires an ISO --before cutoff\n");
        return 2;
      }
      const candidates = (await storage.readEvents(projectId as EntityId))
        .filter((event) =>
          (event.type === "UsageObserved" || event.type === "UsageSampleRecorded") &&
          Date.parse(event.occurredAt) < Date.parse(cutoff)
        );
      const apply = args.includes("--apply");
      const confirmation = flagValue(args, "--confirm");
      if (apply && confirmation === undefined) {
        io.stderr("Applying retention requires --confirm <project-id>\n");
        return 2;
      }
      const deleted = apply
        ? await storage.deleteEventsBefore(projectId as EntityId, cutoff, confirmation ?? "")
        : 0;
      io.stdout(`${JSON.stringify({
        action: "retention",
        cutoff,
        candidates: candidates.length,
        applied: apply,
        deleted
      })}\n`);
      return 0;
    }
    io.stderr("Unknown data action; use export, retention or delete\n");
    return 2;
  } finally {
    await storage.close();
  }
}

async function runDashboard(args: readonly string[], io: CliIo): Promise<number> {
  const db = flagValue(args, "--db");
  const projectId = flagValue(args, "--project-id");
  const project = flagValue(args, "--project");
  if (
    db === undefined ||
    projectId === undefined ||
    project === undefined ||
    !projectId.startsWith("project_")
  ) {
    io.stderr("Dashboard requires --db, --project-id and --project\n");
    return 2;
  }
  const root = isAbsolute(project) ? project : resolve(process.cwd(), project);
  const profile = parseProjectProfile(JSON.parse(await readFile(
    join(root, ".vpr", "profile.json"),
    "utf8"
  )));
  const storage = new SqliteStorage(isAbsolute(db) ? db : resolve(process.cwd(), db));
  await storage.initialize();
  const backlog = new BacklogService({
    projectId: projectId as EntityId,
    storage,
    actor: "vpr-dashboard",
    confirmation: "required",
    now: () => new Date().toISOString(),
    nextId: (prefix) => `${prefix}_${randomUUID()}` as EntityId
  });
  const dashboard = await createDashboardServer({
    root,
    projectId: projectId as EntityId,
    glossaryPath: profile.glossaryPath,
    backlog,
    storage
  });
  const shutdown = async (): Promise<void> => {
    await dashboard.close();
    await storage.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  io.stdout(`${JSON.stringify({ action: "dashboard", url: dashboard.url, localOnly: true })}\n`);
  return 0;
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
      "vpr story --db <path> --project-id <id> --input <json> [--apply] | " +
      "vpr data export --db <path> --project-id <id> --out <jsonl> | " +
      "vpr data retention --db <path> --project-id <id> --before <iso> [--apply --confirm <id>] | " +
      "vpr data delete --db <path> --project-id <id> --confirm <id> | " +
      "vpr dashboard --db <path> --project-id <id> --project <path>\n"
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

