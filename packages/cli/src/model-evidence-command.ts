import type { CliIo } from "./cli.js";
import { runModelPlan } from "./models-plan.js";
import { runModelPrices } from "./models-prices.js";
import { modelQueryUsage, runModelQuery } from "./models-query.js";
import { runModelQuota } from "./models-quota.js";
import { runModelStatus } from "./models-status.js";
import { runModelSubscriptions } from "./models-subscriptions.js";

const subcommands: Record<
  string,
  (args: readonly string[], io: CliIo) => Promise<number>
> = {
  prices: runModelPrices,
  status: runModelStatus,
  plan: runModelPlan,
  quota: runModelQuota,
  subscriptions: runModelSubscriptions,
  query: runModelQuery,
};

export async function runModelEvidenceCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const run = Object.hasOwn(subcommands, args[0] ?? "")
    ? subcommands[args[0] as string]
    : undefined;
  if (run) return run(args, io);
  io.stderr(modelQueryUsage);
  return 2;
}
