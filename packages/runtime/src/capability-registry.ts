import type { Capability, ProcessRunner } from "@vpr/contracts";

import { probeCapability, type CapabilityProbe } from "./probe-capability.js";

export class CapabilityRegistry {
  readonly #probes: ReadonlyMap<string, CapabilityProbe>;
  readonly #processRunner: ProcessRunner;
  readonly #now: () => Date;
  readonly #cache = new Map<string, Capability>();

  public constructor(
    probes: readonly CapabilityProbe[],
    processRunner: ProcessRunner,
    now: () => Date = () => new Date()
  ) {
    this.#probes = new Map(probes.map((probe) => [probe.id, probe]));
    this.#processRunner = processRunner;
    this.#now = now;
  }

  public async get(id: string, refresh = false): Promise<Capability> {
    const probe = this.#probes.get(id);
    if (probe === undefined) {
      throw new Error(`Unknown capability: ${id}`);
    }
    const cached = this.#cache.get(id);
    if (!refresh && cached !== undefined && !isExpired(cached, this.#now())) {
      return cached;
    }
    const capability = await probeCapability(probe, this.#processRunner, this.#now);
    this.#cache.set(id, capability);
    return capability;
  }

  public listCached(): readonly Capability[] {
    return [...this.#cache.values()];
  }
}

function isExpired(capability: Capability, now: Date): boolean {
  return capability.expiresAt === undefined || Date.parse(capability.expiresAt) <= now.getTime();
}

