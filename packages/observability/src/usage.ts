import type { DomainEvent, MeasurementSource } from "@vpr/contracts";

export interface UsageProjection {
  readonly runs: { readonly total: number; readonly completed: number; readonly failed: number };
  readonly checks: { readonly total: number; readonly passed: number; readonly failed: number };
  readonly retries: number;
  readonly interventions: number;
  readonly durationMs: { readonly value: number | null; readonly source: MeasurementSource };
  readonly tokens: { readonly value: number | null; readonly source: MeasurementSource };
  readonly costUsd: { readonly value: number | null; readonly source: MeasurementSource };
}

export function projectUsage(events: readonly DomainEvent[]): UsageProjection {
  let completed = 0;
  let failed = 0;
  let checks = 0;
  let passedChecks = 0;
  let retries = 0;
  let interventions = 0;
  let duration = 0;
  let durationObserved = false;
  let tokens = 0;
  let tokenSource: MeasurementSource = "unavailable";
  let cost = 0;
  let costSource: MeasurementSource = "unavailable";
  const runIds = new Set<string>();

  for (const event of events) {
    if (event.runId !== undefined) runIds.add(event.runId);
    if (event.type === "RunStateChanged" || event.type === "backlog.run.transitioned") {
      const state = (event.payload.to ?? (event.payload.run as { state?: string } | undefined)?.state) as string | undefined;
      if (state === "COMPLETED") completed += 1;
      if (state === "FAILED") failed += 1;
    }
    if (event.type === "EvidenceRecorded") {
      checks += 1;
      if (event.payload.exitCode === 0 && event.payload.outputTruncated !== true) passedChecks += 1;
      const value = event.payload.durationMs;
      if (typeof value === "number") {
        duration += value;
        durationObserved = true;
      }
    }
    if (event.type === "execution.retry") retries += 1;
    if (event.type === "execution.approval.requested") interventions += 1;
    if (event.type === "UsageObserved") {
      if (typeof event.payload.tokens === "number") {
        tokens += event.payload.tokens;
        tokenSource = measurement(event.payload.source);
      }
      if (typeof event.payload.costUsd === "number") {
        cost += event.payload.costUsd;
        costSource = measurement(event.payload.source);
      }
    }
  }
  return {
    runs: { total: runIds.size, completed, failed },
    checks: { total: checks, passed: passedChecks, failed: checks - passedChecks },
    retries,
    interventions,
    durationMs: { value: durationObserved ? duration : null, source: durationObserved ? "measured" : "unavailable" },
    tokens: { value: tokenSource === "unavailable" ? null : tokens, source: tokenSource },
    costUsd: { value: costSource === "unavailable" ? null : cost, source: costSource }
  };
}

export interface UsageSample {
  readonly storyId: string;
  readonly commit: string;
  readonly label: "baseline" | "plugin";
  readonly metric: number;
  readonly source: MeasurementSource;
  readonly sampleSize: number;
}

export function compareSamples(baseline: UsageSample, plugin: UsageSample): {
  readonly delta: number;
  readonly smallSample: boolean;
  readonly sources: readonly [MeasurementSource, MeasurementSource];
} {
  if (baseline.label !== "baseline" || plugin.label !== "plugin") {
    throw new TypeError("Comparison requires baseline and plugin labels");
  }
  if (baseline.storyId !== plugin.storyId || baseline.commit !== plugin.commit) {
    throw new TypeError("Usage comparison requires the same Story and commit");
  }
  return {
    delta: plugin.metric - baseline.metric,
    smallSample: baseline.sampleSize < 5 || plugin.sampleSize < 5,
    sources: [baseline.source, plugin.source]
  };
}

export interface UsageComparison {
  readonly storyId: string;
  readonly commit: string;
  readonly baseline: UsageSample;
  readonly plugin: UsageSample;
  readonly delta: number;
  readonly smallSample: boolean;
  readonly sources: readonly [MeasurementSource, MeasurementSource];
}

export function projectUsageComparisons(events: readonly DomainEvent[]): readonly UsageComparison[] {
  const groups = new Map<string, Partial<Record<UsageSample["label"], UsageSample>>>();
  for (const event of events) {
    if (event.type !== "UsageSampleRecorded") continue;
    const sample = parseUsageSample(event.payload);
    if (sample === undefined) continue;
    const key = `${sample.storyId}\u0000${sample.commit}`;
    const group = groups.get(key) ?? {};
    group[sample.label] = sample;
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => {
    if (group.baseline === undefined || group.plugin === undefined) return [];
    const comparison = compareSamples(group.baseline, group.plugin);
    return [{
      storyId: group.baseline.storyId,
      commit: group.baseline.commit,
      baseline: group.baseline,
      plugin: group.plugin,
      ...comparison
    }];
  });
}

export function retentionCandidates(
  events: readonly DomainEvent[],
  cutoffIso: string
): readonly DomainEvent[] {
  const cutoff = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoff)) throw new TypeError("Invalid retention cutoff");
  return events.filter((event) => Date.parse(event.occurredAt) < cutoff);
}

function measurement(value: unknown): MeasurementSource {
  return value === "measured" || value === "provider_reported" || value === "estimated"
    ? value
    : "unavailable";
}

function parseUsageSample(payload: Readonly<Record<string, unknown>>): UsageSample | undefined {
  const { storyId, commit, label, metric, source, sampleSize } = payload;
  if (
    typeof storyId !== "string" ||
    typeof commit !== "string" ||
    (label !== "baseline" && label !== "plugin") ||
    typeof metric !== "number" ||
    !Number.isFinite(metric) ||
    !Number.isSafeInteger(sampleSize) ||
    (sampleSize as number) < 1
  ) return undefined;
  const parsedSource = measurement(source);
  if (parsedSource === "unavailable") return undefined;
  return { storyId, commit, label, metric, source: parsedSource, sampleSize: sampleSize as number };
}
