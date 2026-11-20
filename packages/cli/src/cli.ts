import {runExperimentsCommand} from './experiments-command.js';
import {provisionProjectAgents} from './project-agents.js';
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

import { createStoryDraftFromGrill } from "@vpr/backlog";
import type { EntityId, Run } from "@vpr/contracts";
import { createDashboardServer } from "@vpr/dashboard";
import {
  applyProjectProfile,
  applySetupSelection,
  assertOrchestratorProvider,
  proposeOrchestrationProfile,
  proposeProjectProfile,
} from "@vpr/config";
import { createSafeProcessRunner } from "@vpr/quality";
import { CapabilityRegistry, executeCheckRun, resolveExecutable } from "@vpr/runtime";
import { SqliteStorage } from "@vpr/storage-sqlite";
import {
  createBacklog,
  flagValue,
  openStorage,
  readProjectProfile,
  withStorage,
} from "./project-workspace.js";
import { runTaskCommand } from "./task-command.js";
import { provisionProject } from "./provision-project.js";
import { runModelEvidenceCommand } from "./model-evidence-command.js";
import { detectSubscriptionPlan } from "./subscription-detection.js";
import { runUsageCommand } from "./usage-command.js";
import { runAgentCommand } from "./agent-command.js";
import { runLocalToolsCommand } from "./local-tools-command.js";
import { checkStagedSecurity } from "@vpr/quality/staged-security";
import { readUsage } from "@vpr/runtime";
import { installPlugin } from "./plugin-install.js";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function runCli(args: readonly string[], io: CliIo = defaultIo): Promise<number> {
  if (args[0] === "tools") return runLocalToolsCommand(args.slice(1), io);
  if (args[0] === "security") {
    if (args[1] !== "check") {
      io.stderr("Usage: vpr security check --project <path>\n");
      return 2;
    }
    const at = args.indexOf("--project");
    const result = checkStagedSecurity(at < 0 ? process.cwd() : resolve(args[at + 1] ?? "."));
    io.stdout(JSON.stringify(result) + "\n");
    return result.passed ? 0 : 1;
  }
  if (args[0] === 'experiments') return runExperimentsCommand(args.slice(1), io);
  if (args[0] === "use") return runUsageCommand(args.slice(1), io);
  if (args[0] === "agent") return runAgentCommand(args.slice(1), io);
  if (args[0] === "models") return runModelEvidenceCommand(args.slice(1), io);
  if (args[0] === "plugin") {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const pluginRoot = existsSync(resolve(packageRoot, ".claude-plugin/plugin.json"))
      ? packageRoot
      : resolve(packageRoot, "plugin");
    if (args[1] === "path") {
      io.stdout(pluginRoot + "\n");
      return 0;
    }
    if (args[1] === "doctor") {
      const program = await resolveExecutable("claude");
      if (!program) {
        io.stdout(
          JSON.stringify({
            ready: false,
            reason: "Claude Code CLI unavailable",
            inferenceTokens: 0,
          }) + "\n",
        );
        return 3;
      }
      return new Promise<number>((done) => {
        const child = spawn(program, ["plugin", "validate", "--strict", "--json", pluginRoot], {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        });
        let content = "";
        const timer = setTimeout(() => {
          child.kill();
          io.stdout(
            JSON.stringify({
              ready: false,
              reason: "Native validation timed out",
              inferenceTokens: 0,
            }) + "\n",
          );
          done(3);
        }, 20000);
        child.stdout.on("data", (chunk) => {
          content += chunk.toString();
          if (content.length > 1048576) child.kill();
        });
        child.once("error", () => {
          clearTimeout(timer);
          done(3);
        });
        child.once("close", () => {
          clearTimeout(timer);
          try {
            const result = JSON.parse(content) as {
              manifest?: { errors?: unknown[] };
              contents?: { errors?: unknown[]; notes?: string[] }[];
              directory?: { findings?: unknown[] };
            };
            const notes = result.contents?.flatMap((item) => item.notes ?? []) ?? [];
            const ready =
              !result.manifest?.errors?.length &&
              result.contents?.every((item) => !item.errors?.length) &&
              notes.some((note) => note.includes("command.run{command=vpr-use}"));
            io.stdout(
              JSON.stringify({
                ready: !!ready,
                inferenceTokens: 0,
                command: "vpr-use",
                directoryFindings: result.directory?.findings ?? [],
                reason: ready
                  ? "Native usage command recognized; release/license findings are listed separately"
                  : "Update Claude Code or resolve plugin module validation before using the slash command",
              }) + "\n",
            );
            done(ready ? 0 : 3);
          } catch {
            io.stdout(
              JSON.stringify({
                ready: false,
                reason: "Native validator unavailable or incompatible",
                inferenceTokens: 0,
              }) + "\n",
            );
            done(3);
          }
        });
      });
    }
    if (args[1] !== "install") {
      io.stderr("Plugin actions: path, doctor, install\n");
      return 2;
    }
    await readFile(resolve(packageRoot, ".claude-plugin/marketplace.json"), "utf8");
    const program = await resolveExecutable("claude");
    if (!program) throw new Error("Claude Code executable unavailable");
    return installPlugin(program, packageRoot, io);
  }
  if (args[0] === "task") return runTaskCommand(args.slice(1), io);
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
  return withStorage(dbValue, (storage) => runDoctor(storage, io));
}

async function runDoctor(storage: SqliteStorage, io: CliIo): Promise<number> {
  const now = (): string => new Date().toISOString();
  const run: Run = {
    runId: id("run"),
    taskId: id("task"),
    state: "PENDING",
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
  };

  const resolvedPrograms = {
    git: (await resolveExecutable("git")) ?? "git",
    pnpm: (await resolveExecutable("pnpm")) ?? "pnpm",
    powershell: (await resolveExecutable("pwsh")) ?? "pwsh",
  };
  const processRunner = createSafeProcessRunner([
    process.execPath,
    ...Object.values(resolvedPrograms),
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
      maxOutputBytes: 16_384,
    },
    processRunner,
    storage,
    now,
    nextId: (prefix) => id(prefix),
  });
  const registry = new CapabilityRegistry(
    [
      {
        id: "node",
        program: process.execPath,
        args: ["--version"],
        cwd: process.cwd(),
        ttlMs: 300_000,
      },
      {
        id: "git",
        program: resolvedPrograms.git,
        args: ["--version"],
        cwd: process.cwd(),
        ttlMs: 300_000,
      },
      {
        id: "pnpm",
        program: resolvedPrograms.pnpm,
        args: ["--version"],
        cwd: process.cwd(),
        ttlMs: 300_000,
      },
      {
        id: "powershell",
        program: resolvedPrograms.powershell,
        args: ["--version"],
        cwd: process.cwd(),
        ttlMs: 300_000,
      },
    ],
    processRunner,
  );
  const capabilities = await Promise.all(
    ["node", "git", "pnpm", "powershell"].map((capability) => registry.get(capability)),
  );
  io.stdout(
    `${JSON.stringify({
      runId: result.run.runId,
      state: result.run.state,
      evidence: result.evidence,
      capabilities,
    })}\n`,
  );
  return result.run.state === "COMPLETED" ? 0 : 1;
}

async function runData(args: readonly string[], io: CliIo): Promise<number> {
  const action = args[0];
  const db = flagValue(args, "--db");
  const projectId = flagValue(args, "--project-id");
  if (db === undefined || projectId === undefined || !projectId.startsWith("project_")) {
    io.stderr("Data command requires --db and a --project-id starting with project_\n");
    return 2;
  }
  return withStorage(db, (storage) => runDataAction(action, args, storage, projectId, io));
}

async function runDataAction(
  action: string | undefined,
  args: readonly string[],
  storage: SqliteStorage,
  projectId: string,
  io: CliIo,
): Promise<number> {
  if (action === "export") {
    const out = flagValue(args, "--out");
    if (out === undefined) {
      io.stderr("Data export requires --out\n");
      return 2;
    }
    const target = isAbsolute(out) ? out : resolve(process.cwd(), out);
    const content = await storage.exportJsonl(projectId as EntityId);
    await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    io.stdout(
      `${JSON.stringify({
        action: "export",
        target,
        events: content.length === 0 ? 0 : content.trimEnd().split("\n").length,
      })}\n`,
    );
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
    const candidates = (await storage.readEvents(projectId as EntityId)).filter(
      (event) =>
        (event.type === "UsageObserved" || event.type === "UsageSampleRecorded") &&
        Date.parse(event.occurredAt) < Date.parse(cutoff),
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
    io.stdout(
      `${JSON.stringify({
        action: "retention",
        cutoff,
        candidates: candidates.length,
        applied: apply,
        deleted,
      })}\n`,
    );
    return 0;
  }
  io.stderr("Unknown data action; use export, retention or delete\n");
  return 2;
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
  const profile = await readProjectProfile(root);
  const storage = await openStorage(db);
  const backlog = createBacklog(storage, projectId as EntityId, "vpr-dashboard");
  const dashboard = await createDashboardServer({
    readNativeUsage: () => readUsage({ scope: "machine", detail: true }),
    root,
    projectId: projectId as EntityId,
    glossaryPath: profile.glossaryPath,
    ...(profile.subscriptions ? { subscriptions: profile.subscriptions } : {}),
    backlog,
    storage,
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
  return withStorage(db, (storage) => runStoryInput(args, storage, projectId, input, io));
}

async function runStoryInput(
  args: readonly string[],
  storage: SqliteStorage,
  projectId: string,
  input: string,
  io: CliIo,
): Promise<number> {
  const source = parseStoryInput(
    JSON.parse(await readFile(isAbsolute(input) ? input : resolve(process.cwd(), input), "utf8")),
  );
  const service = createBacklog(storage, projectId as EntityId, "vpr-cli");
  const proposal = await service.previewStory(
    createStoryDraftFromGrill({
      projectId: projectId as EntityId,
      ...source,
    }),
  );
  const apply = args.includes("--apply");
  const story = apply ? await service.commitStory(proposal, { confirmed: true }) : undefined;
  io.stdout(
    `${JSON.stringify({
      action: proposal.action,
      applied: apply && proposal.action === "create",
      ...(story === undefined ? {} : { story }),
    })}\n`,
  );
  return 0;
}

async function runInit(args: readonly string[], io: CliIo): Promise<number> {
  const projectFlag = args.indexOf("--project");
  const project = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
  if (project === undefined || project.length === 0) {
    io.stderr("Missing required --project path\n");
    return 2;
  }
  let proposal = await proposeProjectProfile(project);
  const integrationsAt = args.indexOf("--integrations"),
    technologiesAt = args.indexOf("--technologies");
  if (integrationsAt >= 0 || technologiesAt >= 0) {
    const profile = applySetupSelection(proposal.profile, {
      ...(technologiesAt < 0
        ? {}
        : { technologies: (args[technologiesAt + 1] ?? "").split(",").filter(Boolean) }),
      ...(integrationsAt < 0
        ? {}
        : {
            integrations: args[integrationsAt + 1]?.split(",").map((value) => value.trim()) ?? [],
          }),
    });
    const content = JSON.stringify(profile, null, 2) + "\n";
    proposal = {
      ...proposal,
      profile,
      content,
      action:
        content === proposal.content
          ? proposal.action
          : proposal.action === "create"
            ? "create"
            : "update",
    };
  }
  if (args.includes("--interactive")) {
    if (!process.stdin.isTTY) throw new Error("--interactive requires a terminal");
    const interview = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const detectedTechnologies = proposal.profile.setup?.technologies ?? [];
      const technologies = (
        (await interview.question(
          "Tecnologías del proyecto (separadas por coma) [" +
            detectedTechnologies.join(", ") +
            "]: ",
        )) || detectedTechnologies.join(",")
      )
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const yes = async (question: string): Promise<boolean> =>
        /^(s|si|sí|y|yes)$/iu.test((await interview.question(question + " [s/N]: ")).trim());
      const integrations = {
        husky: await yes("¿Activar integración Husky para este proyecto Node?"),
        graphify: await yes("¿Habilitar Graphify local para mapa del código?"),
        archify: await yes("¿Habilitar Archify para diagramas?"),
      };
      const provider = (
        await interview.question("Proveedor orquestador (claude/codex/copilot): ")
      ).trim();
      assertOrchestratorProvider(provider);
      const detectedPlan = await detectSubscriptionPlan(provider);
      const planAnswer = (
        await interview.question(
          `Plan de suscripción (ej. claude-pro, codex-business-standard, copilot-pro) [${detectedPlan ?? "desconocido"}]: `,
        )
      ).trim();
      const model = (
        await interview.question("Modelo del orquestador (alias o ID de tu cuenta): ")
      ).trim();
      const light = (
        await interview.question("Modelo ligero para inventario y tareas simples: ")
      ).trim();
      const standard = (
        await interview.question("Modelo para implementación normal/revisión: ")
      ).trim();
      const high = (
        await interview.question("Modelo para tareas complejas o de alto riesgo: ")
      ).trim();
      const allowLightCoding = await yes(
        "¿Permitir modelo ligero en código simple de bajo riesgo con checks?",
      );
      const objective =
        (
          await interview.question(
            "Objetivo (reference-cost/tokens/subscription-quota) [reference-cost]: ",
          )
        ).trim() || "reference-cost";
      const profile = proposeOrchestrationProfile(proposal.profile, {
        technologies,
        integrations,
        provider,
        planId: planAnswer || detectedPlan,
        planSource: planAnswer ? "user_reported" : "provider_reported",
        model,
        light,
        standard,
        high,
        allowLightCoding,
        objective,
      });
      const content = JSON.stringify(profile, null, 2) + "\n";
      proposal = {
        ...proposal,
        profile,
        content,
        action: proposal.action === "none" ? "update" : proposal.action,
      };
    } finally {
      interview.close();
    }
  }
  const apply = args.includes("--apply");
  if (apply) {
    await applyProjectProfile(proposal);
  }
  const integrations = apply ? await provisionProject(resolve(project), proposal.profile) : [];
  const agents = apply ? await provisionProjectAgents(resolve(project), proposal.profile) : [];
  io.stdout(
    `${JSON.stringify({
      action: proposal.action,
      target: proposal.target,
      beforeHash: proposal.beforeHash,
      profile: proposal.profile,
      integrations,
      agents,
      applied: apply && proposal.action !== "none",
    })}\n`,
  );
  return 0;
}

function usage(io: CliIo): number {
  io.stderr(
    "Usage: vpr doctor --db <path> | vpr init --project <path> [--interactive] [--integrations husky,graphify,archify] [--apply] | vpr tools <doctor|graph|query|diagram> --project <path> | " +
      "vpr story --db <path> --project-id <id> --input <json> [--apply] | " +
      "vpr data export --db <path> --project-id <id> --out <jsonl> | " +
      "vpr data retention --db <path> --project-id <id> --before <iso> [--apply --confirm <id>] | " +
      "vpr data delete --db <path> --project-id <id> --confirm <id> | " +
      "vpr dashboard --db <path> --project-id <id> --project <path> | " +
      "vpr task <list|plan|check|review> --project <path> --db <path> [options]\n",
  );
  return 2;
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
