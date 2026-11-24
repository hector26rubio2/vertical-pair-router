import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { BacklogService } from "@vpr/backlog";
import {
  parseGlobalProfile,
  parseProjectProfile,
  profilePolicyLayers,
  type ProjectProfileV1,
} from "@vpr/config";
import type { EntityId } from "@vpr/contracts";
import { evaluatePolicy } from "@vpr/runtime";
import { SqliteStorage } from "@vpr/storage-sqlite";

export function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === undefined || value.length === 0 ? undefined : value;
}

export function newEntityId(prefix: string): EntityId {
  return `${prefix}_${randomUUID()}` as EntityId;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function resolveFromCwd(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

export async function openStorage(dbPath: string): Promise<SqliteStorage> {
  const storage = new SqliteStorage(resolveFromCwd(dbPath));
  await storage.initialize();
  return storage;
}

export async function withStorage<T>(
  dbPath: string,
  fn: (storage: SqliteStorage) => Promise<T>,
): Promise<T> {
  const storage = await openStorage(dbPath);
  try {
    return await fn(storage);
  } finally {
    await storage.close();
  }
}

export function createBacklog(
  storage: SqliteStorage,
  projectId: EntityId,
  actor: string,
): BacklogService {
  return new BacklogService({
    projectId,
    storage,
    actor,
    confirmation: "required",
    now: nowIso,
    nextId: (prefix) => newEntityId(prefix),
  });
}

export async function readProjectProfile(root: string): Promise<ProjectProfileV1> {
  return parseProjectProfile(JSON.parse(await readFile(join(root, ".vpr", "profile.json"), "utf8")));
}

export async function readEffectiveProfile(root: string): Promise<ProjectProfileV1> {
  const profile = await readProjectProfile(root);
  const globalPath = process.env.VPR_GLOBAL_PROFILE ?? join(homedir(), ".vpr/global.json");
  try {
    const global = parseGlobalProfile(JSON.parse(await readFile(globalPath, "utf8")));
    return { ...profile, policy: evaluatePolicy(profilePolicyLayers(global, profile)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return profile;
  }
}
