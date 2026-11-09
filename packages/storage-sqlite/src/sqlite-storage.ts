import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DomainEvent, EntityId, StorageAdapter } from "@vpr/contracts";

interface EventRow {
  readonly content_json: string;
}

export class SqliteStorage implements StorageAdapter {
  readonly #path: string;
  #database: DatabaseSync | undefined;

  public constructor(path: string) {
    this.#path = path;
  }

  public async initialize(): Promise<void> {
    if (this.#database !== undefined) {
      return;
    }
    await mkdir(dirname(this.#path), { recursive: true });
    const database = new DatabaseSync(this.#path, {
      enableForeignKeyConstraints: true,
      timeout: 5_000
    });
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
    this.#database = database;
  }

  public async appendEvent(event: DomainEvent): Promise<void> {
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

  #requireDatabase(): DatabaseSync {
    if (this.#database === undefined) {
      throw new Error("SqliteStorage must be initialized before use");
    }
    return this.#database;
  }
}

