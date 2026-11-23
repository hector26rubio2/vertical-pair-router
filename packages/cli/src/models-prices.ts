import { resolve } from "node:path";
import type { CliIo } from "./cli.js";
import { flagValue, moduleDirectory, readFirstJson } from "./models-shared.js";

const priceCatalogs: Record<string, { packaged: string; source: string }> = {
  claude: { packaged: "model-prices.json", source: "model-price-catalog.json" },
  codex: {
    packaged: "openai-model-prices.json",
    source: "openai-model-price-catalog.json",
  },
  copilot: {
    packaged: "copilot-model-prices.json",
    source: "copilot-model-price-catalog.json",
  },
};

export async function runModelPrices(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const provider = flagValue(args, "--provider");
  const selected = provider ? priceCatalogs[provider] : undefined;
  if (!selected) {
    io.stderr("Usage: vpr models prices --provider <claude|codex|copilot>\n");
    return 2;
  }
  const local = moduleDirectory();
  const catalog = await readFirstJson<{ expiresAt: string; cards: unknown[] }>([
    resolve(local, "../data", selected.packaged),
    resolve(local, "../../../docs/research", selected.source),
  ]);
  if (
    !catalog ||
    !Array.isArray(catalog.cards) ||
    !Number.isFinite(Date.parse(catalog.expiresAt))
  )
    throw new TypeError("Price catalog unavailable");
  io.stdout(
    JSON.stringify({
      provider,
      catalog,
      expired: Date.parse(catalog.expiresAt) < Date.now(),
      inferenceTokens: 0,
      accountAvailabilityVerified: false,
      actualAccountCharge: null,
    }) + "\n",
  );
  return 0;
}
