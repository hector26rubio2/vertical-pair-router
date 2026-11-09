import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import type { EntityId, Run } from "@vpr/contracts";
import { createSafeProcessRunner } from "@vpr/quality";
import { executeCheckRun } from "@vpr/runtime";
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
  if (args[0] !== "doctor") {
    io.stderr("Usage: vpr doctor --db <absolute-or-relative-path>\n");
    return 2;
  }

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
      processRunner: createSafeProcessRunner([process.execPath]),
      storage,
      now,
      nextId: (prefix) => id(prefix)
    });
    io.stdout(
      `${JSON.stringify({
        runId: result.run.runId,
        state: result.run.state,
        evidence: result.evidence
      })}\n`
    );
    return result.run.state === "COMPLETED" ? 0 : 1;
  } finally {
    await storage.close();
  }
}

function id(prefix: "project" | "story" | "task" | "run" | "evt" | "evd"): EntityId {
  return `${prefix}_${randomUUID()}` as EntityId;
}

