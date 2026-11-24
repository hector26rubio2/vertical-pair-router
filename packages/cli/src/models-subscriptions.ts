import { resolve } from "node:path";
import type { CliIo } from "./cli.js";
import { flagValue, moduleDirectory, readFirstJson } from "./models-shared.js";
import { detectSubscriptionPlan } from "./subscription-detection.js";

export async function runModelSubscriptions(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const local = moduleDirectory();
  const catalog = await readFirstJson<{
    expiresAt: string;
    plans: { id: string }[];
  }>([
    resolve(local, "../data/subscriptions.json"),
    resolve(local, "../../../docs/research/subscription-catalog.json"),
  ]);
  if (!catalog || !Array.isArray(catalog.plans))
    throw new Error("Subscription catalog unavailable");
  const explicitPlan = flagValue(args, "--plan");
  const detectedPlan = args.includes("--detect")
    ? await detectSubscriptionPlan(flagValue(args, "--provider") ?? "")
    : null;
  const planId = explicitPlan ?? detectedPlan;
  io.stdout(
    JSON.stringify({
      ...catalog,
      selectedPlan: catalog.plans.find((plan) => plan.id === planId) ?? null,
      selectedPlanId: planId ?? null,
      selectedPlanSource: explicitPlan
        ? "user_reported"
        : detectedPlan
          ? "provider_reported"
          : "unavailable",
      expired: Date.parse(catalog.expiresAt) < Date.now(),
      actualAccountPlanDetected: !!detectedPlan,
      decisionInferenceTokens: 0,
      subscriptionQuotaDelta: null,
    }) + "\n",
  );
  return 0;
}
