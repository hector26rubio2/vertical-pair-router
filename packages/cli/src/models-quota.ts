import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  measureSubscriptionQuota,
  type SubscriptionSnapshot,
} from "@vpr/observability";
import type { CliIo } from "./cli.js";
import { flagValue } from "./models-shared.js";

export async function runModelQuota(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const input = flagValue(args, "--input");
  if (!input) {
    io.stderr("Usage: vpr models quota --input <before-after.json>\n");
    return 2;
  }
  const content = await readFile(resolve(input), "utf8");
  if (Buffer.byteLength(content) > 65536)
    throw new Error("Quota input exceeds 64 KiB");
  const snapshots = JSON.parse(content) as {
    before: SubscriptionSnapshot;
    after: SubscriptionSnapshot;
    isolated: boolean;
  };
  if (
    !snapshots.before ||
    !snapshots.after ||
    typeof snapshots.isolated !== "boolean" ||
    ![snapshots.before.source, snapshots.after.source].every((source) =>
      ["provider_reported", "user_reported"].includes(source),
    )
  )
    throw new TypeError("Invalid quota snapshots");
  io.stdout(JSON.stringify(measureSubscriptionQuota(snapshots)) + "\n");
  return 0;
}
