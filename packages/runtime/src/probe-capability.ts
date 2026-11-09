import type {
  Capability,
  EntityId,
  Evidence,
  ProcessRunner
} from "@vpr/contracts";

import { redactSecrets } from "./execute-check.js";

export interface CapabilityProbe {
  readonly id: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly ttlMs: number;
}

export async function probeCapability(
  probe: CapabilityProbe,
  processRunner: ProcessRunner,
  now: () => Date = () => new Date()
): Promise<Capability> {
  if (!Number.isSafeInteger(probe.ttlMs) || probe.ttlMs <= 0) {
    throw new TypeError("Capability ttlMs must be a positive integer");
  }
  const checkedAt = now();
  const expiresAt = new Date(checkedAt.getTime() + probe.ttlMs).toISOString();
  try {
    const result = await processRunner({
      program: probe.program,
      args: probe.args,
      cwd: probe.cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1_024
    });
    const limitations = [
      ...(result.timedOut ? ["probe timed out"] : []),
      ...(result.cancelled ? ["probe was cancelled"] : []),
      ...(result.outputTruncated ? ["probe output was truncated"] : []),
      ...(result.exitCode !== 0 && !result.timedOut && !result.cancelled
        ? [`probe exited with code ${String(result.exitCode)}`]
        : [])
    ];
    const version = result.stdout.trim().split(/\r?\n/u)[0] || undefined;
    const state = result.exitCode === 0 && limitations.length === 0 ? "available" : "degraded";
    const evidence: Evidence = {
      evidenceId: evidenceId(probe.id),
      kind: "capability",
      name: probe.id,
      observedAt: checkedAt.toISOString(),
      ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
      durationMs: result.durationMs,
      summary: redactSecrets([result.stdout, result.stderr].filter(Boolean).join("\n")),
      outputTruncated: result.outputTruncated,
      source: "measured",
      reference: probe.program,
      ...(version === undefined ? {} : { toolVersion: version })
    };

    return {
      id: probe.id,
      state,
      checkedAt: checkedAt.toISOString(),
      ...(version === undefined ? {} : { version }),
      expiresAt,
      evidence: [evidence],
      limitations
    };
  } catch (error) {
    return {
      id: probe.id,
      state: "unavailable",
      checkedAt: checkedAt.toISOString(),
      expiresAt,
      evidence: [
        {
          evidenceId: evidenceId(probe.id),
          kind: "capability",
          name: probe.id,
          observedAt: checkedAt.toISOString(),
          summary: redactSecrets(error instanceof Error ? error.message : "probe failed"),
          outputTruncated: false,
          source: "measured",
          reference: probe.program
        }
      ],
      limitations: ["probe could not start"]
    };
  }
}

function evidenceId(capabilityId: string): EntityId {
  const safe = capabilityId.replace(/[^A-Za-z0-9_-]/gu, "-");
  return `evd_capability-${safe}` as EntityId;
}

