import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import test from "node:test";
import { Script } from "node:vm";

import { BacklogService } from "@vpr/backlog";
import type { EntityId } from "@vpr/contracts";
import { SqliteStorage } from "@vpr/storage-sqlite";

import { createDashboardServer } from "./server.js";

test("serves an authenticated local snapshot and protects mutations", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vpr-dashboard-"));
  await writeFile(join(root, "GLOSSARY.md"), "# Glosario\n\n## Run\n\nEjecución auditable.\n\n- Alias: ejecución\n- Enlaces: ADR-0004\n- Fuente: test\n");
  const storage = new SqliteStorage(join(root, "events.sqlite"));
  await storage.initialize();
  let id = 0;
  const projectId = "project_dashboard" as EntityId;
  const backlog = new BacklogService({
    projectId,
    storage,
    actor: "dashboard-test",
    confirmation: "required",
    now: () => "2026-11-09T17:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}` as EntityId
  });
  await storage.appendEvent({ schemaVersion: 1, eventId: "evt_baseline", occurredAt: "2026-11-11T16:00:00.000Z", projectId, actor: "test", type: "UsageSampleRecorded", payload: { storyId: "story_1", commit: "abc", label: "baseline", metric: 10, source: "measured", sampleSize: 2 } });
  await storage.appendEvent({ schemaVersion: 1, eventId: "evt_plugin", occurredAt: "2026-11-11T16:01:00.000Z", projectId, actor: "test", type: "UsageSampleRecorded", payload: { storyId: "story_1", commit: "abc", label: "plugin", metric: 8, source: "measured", sampleSize: 2 } });
  const server = await createDashboardServer({ root, projectId, glossaryPath: "GLOSSARY.md", backlog, storage });
  context.after(async () => {
    await server.close();
    await storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const origin = new URL(server.url).origin;
  const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const probe = request(`${origin}/api/snapshot`, {
      headers: { Host: "attacker.example", Authorization: `Bearer ${server.token}` }
    }, (response) => { response.resume(); resolve(response.statusCode); });
    probe.once("error", reject);
    probe.end();
  });
  assert.equal(invalidHostStatus, 421);
  const browserScript = await (await fetch(`${origin}/app.js`)).text();
  assert.doesNotThrow(() => new Script(browserScript));
  assert.equal((await fetch(`${origin}/api/snapshot`)).status, 401);
  const auth = { Authorization: `Bearer ${server.token}` };
  const snapshotResponse = await fetch(`${origin}/api/snapshot`, { headers: auth });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json() as { glossary: { term: string; aliases: string[]; status: string }[]; usage: { tokens: { source: string } }; comparisons: { delta: number; smallSample: boolean }[] };
  assert.equal(snapshot.glossary[0]?.term, "Run");
  assert.deepEqual(snapshot.glossary[0]?.aliases, ["ejecución"]);
  assert.equal(snapshot.glossary[0]?.status, "canonical");
  assert.equal(snapshot.usage.tokens.source, "unavailable");
  assert.equal(snapshot.comparisons[0]?.delta, -2);
  assert.equal(snapshot.comparisons[0]?.smallSample, true);

  const story = {
    apply: true,
    story: {
      title: "Dashboard Story",
      need: "Use the shared service.",
      desiredOutcome: "A persisted Story.",
      acceptanceCriteria: ["Snapshot returns it."],
      exclusions: [], openQuestions: [], attachments: []
    }
  };
  assert.equal((await fetch(`${origin}/api/stories`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(story)
  })).status, 403);
  const applied = await fetch(`${origin}/api/stories`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Origin: origin, "X-VPR-CSRF": server.csrfToken },
    body: JSON.stringify(story)
  });
  assert.equal(applied.status, 200);
  assert.equal(((await applied.json()) as { applied: boolean }).applied, true);
  const refreshed = await fetch(`${origin}/api/snapshot`, { headers: auth });
  assert.equal(((await refreshed.json()) as { stories: unknown[] }).stories.length, 1);

  const mutationHeaders = {
    ...auth,
    "Content-Type": "application/json",
    Origin: origin,
    "X-VPR-CSRF": server.csrfToken
  };
  assert.equal((await fetch(`${origin}/api/stories`, {
    method: "POST",
    headers: { ...mutationHeaders, Origin: "https://attacker.example" },
    body: JSON.stringify(story)
  })).status, 403);
  assert.equal((await fetch(`${origin}/api/stories`, {
    method: "POST", headers: mutationHeaders, body: "x".repeat(65_537)
  })).status, 400);
  const proposed = await fetch(`${origin}/api/glossary/proposals`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({
      storyId: "story_1",
      term: {
        canonicalTerm: "Usage Engine",
        definition: "Proyección de medidas observadas.",
        aliases: [],
        avoid: ["factura"],
        links: ["@vpr/observability"],
        source: "story_1",
        recordedAt: "2026-11-11",
        owner: "VPR"
      }
    })
  });
  assert.equal(proposed.status, 200);
  const proposal = await proposed.json() as { proposalId: string; diff: string };
  assert.match(proposal.diff, /Usage Engine/);
  const appliedGlossary = await fetch(`${origin}/api/glossary/apply`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ proposalId: proposal.proposalId })
  });
  assert.equal(appliedGlossary.status, 200);
  assert.match(await readFile(join(root, "GLOSSARY.md"), "utf8"), /## Usage Engine/);
});
