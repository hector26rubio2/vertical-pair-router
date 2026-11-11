import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import type { DomainEvent, EntityId, StorageAdapter } from "@vpr/contracts";

interface EventRow {
  readonly content_json: string;
}

const schemaVersion = 1;

export class SqliteStorage implements StorageAdapter {
  readonly #path: string;
  readonly #busyTimeoutMs: number;
  #database: DatabaseSync | undefined;

  public constructor(path: string, options: { readonly busyTimeoutMs?: number } = {}) {
    this.#path = path;
    this.#busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
  }

  public async initialize(): Promise<void> {
    if (this.#database !== undefined) {
      return;
    }
    await mkdir(dirname(this.#path), { recursive: true });
    const database = new DatabaseSync(this.#path, {
      enableForeignKeyConstraints: true,
      timeout: this.#busyTimeoutMs
    });
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all() as unknown as readonly { readonly name: string }[];
    const hasMetadata = tables.some((table) => table.name === "vpr_metadata");
    try {
      if (!hasMetadata && tables.length > 0) {
        throw new Error("SQLite storage contains an unversioned schema");
      }
      if (hasMetadata) assertSupportedSchema(database);
    } catch (error) {
      database.close();
      throw error;
    }
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS vpr_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO vpr_metadata(key, value)
      VALUES ('schema_version', '1')
      ON CONFLICT(key) DO NOTHING;
      CREATE TABLE IF NOT EXISTS domain_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        content_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS domain_events_project_sequence
      ON domain_events(project_id, sequence);
    `);
    try {
      assertSupportedSchema(database);
    } catch (error) {
      database.close();
      throw error;
    }
    this.#database = database;
  }

  public async appendEvent(event: DomainEvent): Promise<void> {
    assertSafePayload(event.payload);
    const database = this.#requireDatabase();
    const content = JSON.stringify(event);
    const existing = database
      .prepare("SELECT content_json FROM domain_events WHERE event_id = ?")
      .get(event.eventId) as EventRow | undefined;

    if (existing !== undefined) {
      if (existing.content_json !== content) {
        throw new Error(`Event id ${event.eventId} already exists with different content`);
      }
      return;
    }

    database
      .prepare(
        "INSERT INTO domain_events(event_id, project_id, occurred_at, content_json) VALUES (?, ?, ?, ?)"
      )
      .run(event.eventId, event.projectId, event.occurredAt, content);
  }

  public async readEvents(projectId: EntityId): Promise<readonly DomainEvent[]> {
    const rows = this.#requireDatabase()
      .prepare(
        "SELECT content_json FROM domain_events WHERE project_id = ? ORDER BY sequence ASC"
      )
      .all(projectId) as unknown as readonly EventRow[];

    return rows.map((row) => JSON.parse(row.content_json) as DomainEvent);
  }

  public async close(): Promise<void> {
    this.#database?.close();
    this.#database = undefined;
  }

  public async exportJsonl(projectId: EntityId): Promise<string> {
    const events = await this.readEvents(projectId);
    return events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : "");
  }

  public async backupTo(target: string): Promise<number> {
    await mkdir(dirname(target), { recursive: true });
    const reservation = await open(target, "wx");
    await reservation.close();
    try {
      return await backup(this.#requireDatabase(), target);
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
  }

  public async deleteProjectData(projectId: EntityId, confirmation: string): Promise<number> {
    if (confirmation !== projectId) {
      throw new Error("Project data deletion requires the exact project id as confirmation");
    }
    const database = this.#requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = database.prepare("DELETE FROM domain_events WHERE project_id = ?").run(projectId);
      database.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  public async deleteEventsBefore(
    projectId: EntityId,
    cutoffIso: string,
    confirmation: string
  ): Promise<number> {
    if (confirmation !== projectId) {
      throw new Error("Event retention requires the exact project id as confirmation");
    }
    if (!Number.isFinite(Date.parse(cutoffIso))) throw new TypeError("Invalid retention cutoff");
    const database = this.#requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = database.prepare(
        "DELETE FROM domain_events WHERE project_id = ? AND julianday(occurred_at) < julianday(?)"
      ).run(projectId, cutoffIso);
      database.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  #requireDatabase(): DatabaseSync {
    if (this.#database === undefined) {
      throw new Error("SqliteStorage must be initialized before use");
    }
    return this.#database;
  }
}

function assertSupportedSchema(database: DatabaseSync): void {
  const metadata = database.prepare(
    "SELECT value FROM vpr_metadata WHERE key = 'schema_version'"
  ).get() as { readonly value: string } | undefined;
  const storedVersion = Number(metadata?.value);
  if (!Number.isSafeInteger(storedVersion) || storedVersion < 1) {
    throw new Error("SQLite storage has an invalid schema version");
  }
  if (storedVersion > schemaVersion) {
    throw new Error(`SQLite schema version ${storedVersion} is newer than supported ${schemaVersion}`);
  }
}

const forbiddenPayloadKeys = new Set([
  "apikey",
  "cookie",
  "credential",
  "credentials",
  "password",
  "prompt",
  "secret",
  "sourcecode",
  "stderr",
  "stdout"
]);

function assertSafePayload(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenPayloadKeys.has(key.toLocaleLowerCase("en-US").replace(/[_-]/gu, ""))) {
      throw new Error(`Forbidden persisted payload field: ${path}.${key}`);
    }
    assertSafePayload(item, `${path}.${key}`);
  }
}

