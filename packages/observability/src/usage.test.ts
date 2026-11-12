import assert from "node:assert/strict";
import test from "node:test";

import type { DomainEvent } from "@vpr/contracts";

import { compareSamples, projectUsage, projectUsageComparisons, retentionCandidates } from "./usage.js";

const events: DomainEvent[] = [
  { schemaVersion: 1, eventId: "evt_1", occurredAt: "2026-11-01T00:00:00Z", projectId: "project_1", runId: "run_1", actor: "test", type: "EvidenceRecorded", payload: { exitCode: 0, durationMs: 10, outputTruncated: false } },
  { schemaVersion: 1, eventId: "evt_2", occurredAt: "2026-11-02T00:00:00Z", projectId: "project_1", runId: "run_1", actor: "test", type: "RunStateChanged", payload: { to: "COMPLETED" } },
  { schemaVersion: 1, eventId: "evt_3", occurredAt: "2026-11-03T00:00:00Z", projectId: "project_1", runId: "run_1", actor: "test", type: "UsageObserved", payload: { tokens: 50, source: "provider_reported" } }
];

test("projects only observed metrics and labels unavailable values", () => {
  const usage = projectUsage(events);
  assert.deepEqual(usage.runs, { total: 1, completed: 1, failed: 0 });
  assert.deepEqual(usage.tokens, { value: 50, source: "provider_reported" });
  assert.deepEqual(usage.costUsd, { value: null, source: "unavailable" });
});

test("compares only equivalent samples and flags small samples", () => {
  const baseline = { storyId: "story_1", commit: "abc", label: "baseline", metric: 10, source: "measured", sampleSize: 1 } as const;
  const plugin = { storyId: "story_1", commit: "abc", label: "plugin", metric: 8, source: "measured", sampleSize: 1 } as const;
  assert.deepEqual(compareSamples(baseline, plugin), { delta: -2, smallSample: true, sources: ["measured", "measured"] });
  assert.throws(() => compareSamples(baseline, { ...plugin, commit: "other" }), /same Story and commit/);
});

test("retention is a preview of old events", () => {
  assert.deepEqual(retentionCandidates(events, "2026-11-04T00:00:00Z").map((event) => event.eventId), ["evt_3"]);
  assert.equal(events.length, 3);
});

test("projects only paired baseline/plugin samples for the same Story and commit", () => {
  const samples: DomainEvent[] = [
    { schemaVersion: 1, eventId: "evt_b", occurredAt: "2026-11-01T00:00:00Z", projectId: "project_1", actor: "test", type: "UsageSampleRecorded", payload: { storyId: "story_1", commit: "abc", label: "baseline", metric: 10, source: "measured", sampleSize: 2 } },
    { schemaVersion: 1, eventId: "evt_p", occurredAt: "2026-11-01T00:00:01Z", projectId: "project_1", actor: "test", type: "UsageSampleRecorded", payload: { storyId: "story_1", commit: "abc", label: "plugin", metric: 8, source: "measured", sampleSize: 2 } },
    { schemaVersion: 1, eventId: "evt_unpaired", occurredAt: "2026-11-01T00:00:02Z", projectId: "project_1", actor: "test", type: "UsageSampleRecorded", payload: { storyId: "story_2", commit: "def", label: "plugin", metric: 4, source: "estimated", sampleSize: 1 } }
  ];
  const comparisons = projectUsageComparisons(samples);
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0]?.delta, -2);
  assert.equal(comparisons[0]?.smallSample, true);
  assert.deepEqual(comparisons[0]?.sources, ["measured", "measured"]);
});
