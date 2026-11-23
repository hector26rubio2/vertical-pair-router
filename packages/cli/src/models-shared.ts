import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function flagValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

export function moduleDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export async function readFirstJson<T>(
  paths: readonly string[],
): Promise<T | undefined> {
  for (const path of paths) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}
