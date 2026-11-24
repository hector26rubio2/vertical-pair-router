import { inspectCodexAccount, inspectProvider } from "@vpr/runtime";
import type { CliIo } from "./cli.js";
import { flagValue } from "./models-shared.js";

export async function runModelStatus(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const provider = flagValue(args, "--provider");
  if (!provider || !["claude", "codex", "copilot"].includes(provider)) {
    io.stderr("Usage: vpr models status --provider <claude|codex|copilot>\n");
    return 2;
  }
  io.stdout(
    JSON.stringify(
      provider === "codex"
        ? await inspectCodexAccount()
        : await inspectProvider(provider as "claude" | "copilot", []),
    ) + "\n",
  );
  return 0;
}
