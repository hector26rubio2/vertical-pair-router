import type { EffectivePolicy, PolicyLayer, PolicyRules } from "@vpr/contracts";

const defaultMaxOutputBytes = 1_048_576;

export function evaluatePolicy(layers: readonly PolicyLayer[]): EffectivePolicy {
  const booleanRule = (
    rule: "allowShell" | "allowNetworkTelemetry"
  ): { value: boolean; sources: string[] } => {
    const entries = layers.filter((layer) => layer.rules[rule] !== undefined);
    return {
      value: entries.length > 0 && entries.every((layer) => layer.rules[rule] === true),
      sources: entries.map((layer) => layer.id)
    };
  };

  const shell = booleanRule("allowShell");
  const telemetry = booleanRule("allowNetworkTelemetry");
  const providerLayers = layers.filter(
    (layer) => layer.rules.allowedProviders !== undefined
  );
  const providerSets = providerLayers.map(
    (layer) => new Set(layer.rules.allowedProviders)
  );
  const firstProviders = providerLayers[0]?.rules.allowedProviders ?? ["local"];
  const allowedProviders = [...new Set(firstProviders)].filter((provider) =>
    providerSets.every((set) => set.has(provider))
  );
  const outputLayers = layers.filter((layer) => layer.rules.maxOutputBytes !== undefined);
  const maxOutputBytes = outputLayers.reduce((current, layer) => {
    const candidate = layer.rules.maxOutputBytes;
    if (candidate === undefined || !Number.isSafeInteger(candidate) || candidate <= 0) {
      throw new TypeError(`Invalid maxOutputBytes in policy layer ${layer.id}`);
    }
    return Math.min(current, candidate);
  }, defaultMaxOutputBytes);

  const explanation: EffectivePolicy["explanation"] = [
    explain("allowShell", shell.value, shell.sources),
    explain("allowNetworkTelemetry", telemetry.value, telemetry.sources),
    explain(
      "allowedProviders",
      allowedProviders,
      providerLayers.map((layer) => layer.id)
    ),
    explain(
      "maxOutputBytes",
      maxOutputBytes,
      outputLayers.map((layer) => layer.id)
    )
  ];

  return {
    allowShell: shell.value,
    allowNetworkTelemetry: telemetry.value,
    allowedProviders,
    maxOutputBytes,
    explanation
  };
}

function explain(
  rule: keyof PolicyRules,
  value: unknown,
  sources: readonly string[]
): EffectivePolicy["explanation"][number] {
  return { rule, value, sources };
}

