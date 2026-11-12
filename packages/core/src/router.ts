import type {
  AdapterDescriptor,
  EffectivePolicy,
  RouteRequest,
  RouteResult
} from "@vpr/contracts";

type Stage = RouteResult["pipeline"][number]["stage"];

export class AdapterCatalog {
  readonly #adapters = new Map<string, AdapterDescriptor>();

  public register(adapter: AdapterDescriptor): AdapterDescriptor {
    validateAdapter(adapter);
    if (this.#adapters.has(adapter.id)) throw new TypeError(`Duplicate adapter id: ${adapter.id}`);
    this.#adapters.set(adapter.id, adapter);
    return adapter;
  }

  public get(id: string): AdapterDescriptor {
    const adapter = this.#adapters.get(id);
    if (adapter === undefined) throw new RangeError(`Unknown adapter: ${id}`);
    return adapter;
  }

  public list(): readonly AdapterDescriptor[] {
    return [...this.#adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function routeRequest(
  request: RouteRequest,
  policy: EffectivePolicy,
  adapterInput: readonly AdapterDescriptor[]
): RouteResult {
  const adapters = [...adapterInput].sort((a, b) => a.id.localeCompare(b.id));
  adapters.forEach(validateAdapter);
  const pipeline: RouteResult["pipeline"][number][] = [];
  let eligible = adapters;

  eligible = stage("policy", eligible, pipeline, (adapter) =>
    policy.allowedProviders.includes(adapter.provider)
      ? null
      : `provider ${adapter.provider} is disallowed by effective policy`
  );
  eligible = stage("capability", eligible, pipeline, (adapter) => {
    if (adapter.availability !== "available") {
      return `adapter availability is ${adapter.availability}`;
    }
    if (!adapter.operatingSystems.includes(request.operatingSystem)) {
      return `operating system ${request.operatingSystem} is unsupported`;
    }
    const missing = request.requiredCapabilities.filter(
      (capability) => !adapter.capabilities.includes(capability)
    );
    return missing.length === 0 ? null : `missing capabilities: ${missing.join(", ")}`;
  });
  eligible = stage("privacy", eligible, pipeline, (adapter) =>
    request.sensitivity === "local-only" && adapter.transmittedData.length > 0
      ? `would transmit: ${adapter.transmittedData.join(", ")}`
      : null
  );
  eligible = stage("quality", eligible, pipeline, (adapter) =>
    request.requiredQuality === "high" && adapter.quality !== "high"
      ? "high quality route required"
      : null
  );

  if (eligible.length === 0) {
    pipeline.push(summaryStage("cost-latency", [], []));
    return unavailable(request, pipeline, "No eligible adapter remains after deterministic filters.");
  }

  const preferred = request.preferredProvider === null
    ? []
    : eligible.filter((adapter) => adapter.provider === request.preferredProvider);
  let fallbackMessage = "";
  if (request.preferredProvider !== null && preferred.length === 0) {
    if (!request.fallbackOptIn) {
      pipeline.push(summaryStage("cost-latency", eligible, []));
      return {
        ...unavailable(request, pipeline, `Preferred provider ${request.preferredProvider} is unavailable; fallback requires explicit opt-in.`),
        status: "approval-required"
      };
    }
    fallbackMessage = ` Fallback provider changed from ${request.preferredProvider}`;
  } else if (preferred.length > 0) {
    eligible = preferred;
  }

  const ranked = [...eligible].sort((a, b) => {
    const difference = score(a, request.optimizeFor) - score(b, request.optimizeFor);
    return difference === 0 ? a.id.localeCompare(b.id) : difference;
  });
  const selected = ranked[0]!;
  pipeline.push(summaryStage(
    "cost-latency",
    ranked,
    ranked.slice(1).map((adapter) => ({ adapterId: adapter.id, reason: "ranked lower by deterministic preference" }))
  ));
  const transmitted = selected.transmittedData.length === 0
    ? "no data leaves the local host"
    : `transmitted data: ${selected.transmittedData.join(", ")}`;
  const cost = selected.cost.source === "unavailable"
    ? "cost unavailable"
    : `cost ${selected.cost.source}`;
  return {
    requestId: request.requestId,
    status: "routed",
    adapterId: selected.id,
    provider: selected.provider,
    pipeline,
    cost: selected.cost,
    latency: selected.latency,
    explanation: `Selected ${selected.id}.${fallbackMessage} to ${selected.provider}; ${transmitted}; ${cost}.`
  };
}

function stage(
  name: Stage,
  candidates: readonly AdapterDescriptor[],
  pipeline: RouteResult["pipeline"][number][],
  rejectReason: (adapter: AdapterDescriptor) => string | null
): AdapterDescriptor[] {
  const eligible: AdapterDescriptor[] = [];
  const rejected: { adapterId: string; reason: string }[] = [];
  for (const adapter of candidates) {
    const reason = rejectReason(adapter);
    if (reason === null) eligible.push(adapter);
    else rejected.push({ adapterId: adapter.id, reason });
  }
  pipeline.push(summaryStage(name, eligible, rejected));
  return eligible;
}

function summaryStage(
  name: Stage,
  eligible: readonly AdapterDescriptor[],
  rejected: readonly { readonly adapterId: string; readonly reason: string }[]
): RouteResult["pipeline"][number] {
  return { stage: name, eligibleAdapterIds: eligible.map((adapter) => adapter.id), rejected };
}

function score(adapter: AdapterDescriptor, preference: RouteRequest["optimizeFor"]): number {
  const cost = adapter.cost.source === "unavailable"
    ? Number.MAX_SAFE_INTEGER / 4
    : adapter.cost.estimatedUsd ?? Number.MAX_SAFE_INTEGER / 4;
  const latency = adapter.latency.source === "unavailable"
    ? Number.MAX_SAFE_INTEGER / 4
    : adapter.latency.estimatedMs ?? Number.MAX_SAFE_INTEGER / 4;
  if (preference === "cost") return cost;
  if (preference === "latency") return latency;
  return cost * 1_000 + latency / 1_000;
}

function unavailable(
  request: RouteRequest,
  pipeline: RouteResult["pipeline"],
  explanation: string
): RouteResult {
  return {
    requestId: request.requestId,
    status: "unavailable",
    pipeline,
    cost: { source: "unavailable" },
    latency: { source: "unavailable" },
    explanation
  };
}

function validateAdapter(adapter: AdapterDescriptor): void {
  if (adapter.id.trim().length === 0 || adapter.provider.trim().length === 0) {
    throw new TypeError("Adapter id and provider are required");
  }
  if ((adapter.credentialHandling as string) === "extract-host-credentials") {
    throw new TypeError("Adapters may not extract host credentials");
  }
  if (
    adapter.authentication === "secret-resolver" &&
    adapter.credentialHandling !== "secret-resolver-only"
  ) {
    throw new TypeError("Direct provider authentication must use SecretResolver only");
  }
  if (
    adapter.authentication === "host-session" &&
    adapter.credentialHandling !== "host-managed"
  ) {
    throw new TypeError("Host-session authentication must remain host-managed");
  }
  if (adapter.authentication === "none" && adapter.credentialHandling !== "none") {
    throw new TypeError("Unauthenticated adapters cannot declare credential access");
  }
}
