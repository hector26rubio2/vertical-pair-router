import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { DomainEvent } from "@vpr/contracts";

import { SqliteStorage } from "./sqlite-storage.js";

test("persists ordered project events across reopen", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-storage-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "events.sqlite");
  const first = new SqliteStorage(path);
  await first.initialize();

  const event: DomainEvent = {
    schemaVersion: 1,
    eventId: "evt_001",
    occurredAt: "2026-11-09T12:00:00.000Z",
    projectId: "project_001",
    actor: "test",
    type: "StoryCreated",
    payload: { title: "First story" }
  };

  await first.appendEvent(event);
  await first.close();

  const reopened = new SqliteStorage(path);
  await reopened.initialize();
  const events = await reopened.readEvents("project_001");
  await reopened.close();

  assert.deepEqual(events, [event]);
});

test("treats a repeated event id as an idempotent append", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-storage-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const storage = new SqliteStorage(join(directory, "events.sqlite"));
  await storage.initialize();
  const event: DomainEvent = {
    schemaVersion: 1,
    eventId: "evt_same",
    occurredAt: "2026-11-09T12:00:00.000Z",
    projectId: "project_001",
    actor: "test",
    type: "RunStarted",
    payload: { runId: "run_001" }
  };

  await storage.appendEvent(event);
  await storage.appendEvent(event);
  const events = await storage.readEvents("project_001");
  await storage.close();

  assert.equal(events.length, 1);
});

test("rejects reuse of an event id with different content", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-storage-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const storage = new SqliteStorage(join(directory, "events.sqlite"));
  await storage.initialize();
  const original: DomainEvent = {
    schemaVersion: 1,
    eventId: "evt_conflict",
    occurredAt: "2026-11-09T12:00:00.000Z",
    projectId: "project_001",
    actor: "test",
    type: "RunStarted",
    payload: {}
  };

  await storage.appendEvent(original);
  await assert.rejects(
    storage.appendEvent({ ...original, type: "RunCompleted" }),
    /different content/
  );
  await storage.close();
});

test("rejects sensitive payload fields and requires exact deletion confirmation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-storage-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const storage = new SqliteStorage(join(directory, "events.sqlite"));
  await storage.initialize();
  const event: DomainEvent = {
    schemaVersion: 1,
    eventId: "evt_safe",
    occurredAt: "2026-11-09T12:00:00.000Z",
    projectId: "project_001",
    actor: "test",
    type: "UsageObserved",
    payload: { tokens: 12, source: "provider_reported" }
  };
  await storage.appendEvent(event);
  await assert.rejects(storage.appendEvent({
    ...event,
    eventId: "evt_unsafe",
    payload: { prompt: "private source" }
  }), /Forbidden/);
  assert.match(await storage.exportJsonl("project_001"), /"tokens":12/);
  await assert.rejects(storage.deleteProjectData("project_001", "wrong"), /exact project id/);
  assert.equal(await storage.deleteProjectData("project_001", "project_001"), 1);
  assert.deepEqual(await storage.readEvents("project_001"), []);
  await storage.close();
});

test("backs up and restores a Unicode path without replacing an existing target", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-almacén-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "datos-ñ.sqlite");
  const target = join(directory, "copias", "respaldo.sqlite");
  const storage = new SqliteStorage(source);
  await storage.initialize();
  const event: DomainEvent = {
    schemaVersion: 1,
    eventId: "evt_unicode",
    occurredAt: "2026-11-11T12:00:00.000Z",
    projectId: "project_unicode",
    actor: "test",
    type: "StoryCreated",
    payload: { title: "Información local" }
  };
  await storage.appendEvent(event);
  assert.ok(await storage.backupTo(target) > 0);
  await assert.rejects(storage.backupTo(target), /EEXIST/);
  await storage.close();

  const restored = new SqliteStorage(target);
  await restored.initialize();
  assert.deepEqual(await restored.readEvents("project_unicode"), [event]);
  await restored.close();
});

test("reports lock contention and rejects a database from a newer schema", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-lock-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "events.sqlite");
  const storage = new SqliteStorage(path, { busyTimeoutMs: 25 });
  await storage.initialize();
  const lock = new DatabaseSync(path);
  lock.exec("BEGIN IMMEDIATE");
  await assert.rejects(storage.appendEvent({
    schemaVersion: 1,
    eventId: "evt_locked",
    occurredAt: "2026-11-11T12:00:00.000Z",
    projectId: "project_lock",
    actor: "test",
    type: "RunStarted",
    payload: {}
  }), /database is locked/);
  lock.exec("ROLLBACK");
  lock.prepare("UPDATE vpr_metadata SET value = '2' WHERE key = 'schema_version'").run();
  lock.close();
  await storage.close();

  await assert.rejects(new SqliteStorage(path).initialize(), /newer than supported/);

  const unversionedPath = join(directory, "unversioned.sqlite");
  const unversioned = new DatabaseSync(unversionedPath);
  unversioned.exec("CREATE TABLE legacy(value TEXT)");
  unversioned.close();
  await assert.rejects(new SqliteStorage(unversionedPath).initialize(), /unversioned schema/);
});

test("previews retention from events and applies only with exact project confirmation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vpr-retention-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const storage = new SqliteStorage(join(directory, "events.sqlite"));
  await storage.initialize();
  for (const [eventId, occurredAt] of [
    ["evt_old", "2026-01-01T00:00:00.000Z"],
    ["evt_new", "2026-11-11T00:00:00.000Z"]
  ] as const) {
    await storage.appendEvent({
      schemaVersion: 1,
      eventId,
      occurredAt,
      projectId: "project_retention",
      actor: "test",
      type: "UsageObserved",
      payload: { source: "measured" }
    });
  }
  await assert.rejects(
    storage.deleteEventsBefore("project_retention", "2026-06-01T00:00:00.000Z", "wrong"),
    /exact project id/
  );
  await storage.appendEvent({
    schemaVersion: 1,
    eventId: "evt_durable_story",
    occurredAt: "2026-01-01T00:00:00.000Z",
    projectId: "project_retention",
    actor: "test",
    type: "backlog.story.created",
    payload: { title: "Durable Story" }
  });
  assert.equal(await storage.deleteEventsBefore(
    "project_retention",
    "2026-06-01T00:00:00.000Z",
    "project_retention"
  ), 1);
  assert.deepEqual((await storage.readEvents("project_retention")).map((event) => event.eventId), ["evt_new", "evt_durable_story"]);
  await storage.close();
});

