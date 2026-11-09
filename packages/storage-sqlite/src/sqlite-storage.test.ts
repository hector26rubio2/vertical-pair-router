import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

