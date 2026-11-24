import { parseProjectProfile } from "./profile-policy.js";
import type { ProjectProfileV1 } from "./project-profile.js";

export interface SetupSelection {
  readonly technologies?: readonly string[];
  readonly integrations?: readonly string[];
}

export interface OrchestrationAnswers {
  readonly technologies: readonly string[];
  readonly integrations: {
    readonly husky: boolean;
    readonly graphify: boolean;
    readonly archify: boolean;
  };
  readonly provider: string;
  readonly planId?: string | null;
  readonly planSource: "user_reported" | "provider_reported";
  readonly model: string;
  readonly light: string;
  readonly standard: string;
  readonly high: string;
  readonly allowLightCoding: boolean;
  readonly objective: string;
}

const knownIntegrations = ["husky", "graphify", "archify", "none"];
const knownProviders = ["claude", "codex", "copilot"];

export function assertOrchestratorProvider(provider: string): void {
  if (!knownProviders.includes(provider)) throw new TypeError("Unknown orchestrator provider");
}

export function applySetupSelection(
  base: ProjectProfileV1,
  selection: SetupSelection,
): ProjectProfileV1 {
  const selected = selection.integrations;
  if (selected && selected.some((value) => !knownIntegrations.includes(value)))
    throw new TypeError("Integrations: husky,graphify,archify or none");
  if (selected !== undefined && selected.length === 0)
    throw new TypeError("--integrations needs a value");
  const previous = base.setup;
  return parseProjectProfile({
    ...base,
    setup: {
      technologies:
        selection.technologies === undefined
          ? (previous?.technologies ?? [])
          : selection.technologies,
      integrations: selected
        ? {
            husky: selected.includes("husky"),
            graphify: selected.includes("graphify"),
            archify: selected.includes("archify"),
          }
        : (previous?.integrations ?? { husky: false, graphify: false, archify: false }),
    },
  });
}

export function proposeOrchestrationProfile(
  base: ProjectProfileV1,
  answers: OrchestrationAnswers,
): ProjectProfileV1 {
  const { provider, planId, planSource, model, light, standard, high, objective } = answers;
  assertOrchestratorProvider(provider);
  if (objective !== "reference-cost") throw new TypeError("Routing objective must be reference-cost; tokens and subscription-quota are not ranked yet");
  return parseProjectProfile({
    ...base,
    setup: { technologies: answers.technologies, integrations: answers.integrations },
    ...(planId ? { subscriptions: [{ provider, planId, source: planSource }] } : {}),
    policy: { ...base.policy, allowedProviders: ["local", provider] },
    orchestration: {
      orchestratorId: "coordinator",
      maxWorkers: 2,
      allowLightCoding: answers.allowLightCoding,
      objective,
      models: [
        { id: "coordinator", provider, model, tier: "standard", roles: ["orchestrator"] },
        { id: "light-worker", provider, model: light, tier: "light", roles: ["inventory", "coding"] },
        {
          id: "standard-worker",
          provider,
          model: standard,
          tier: "standard",
          roles: ["coding", "review"],
        },
        { id: "high-worker", provider, model: high, tier: "high", roles: ["coding", "review"] },
      ],
    },
  });
}
