import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ContextFileInput {
  readonly path: string;
  readonly lines?: readonly [number, number];
}

export interface ContextPackInput {
  readonly root: string;
  readonly storyId: string;
  readonly taskId: string;
  readonly commit: string;
  readonly createdAt: string;
  readonly files: readonly ContextFileInput[];
  readonly pending: readonly string[];
  readonly maxTotalBytes: number;
  readonly maxFiles?: number;
  readonly hashCache?: ContentHashCache;
}

export interface ContextPack {
  readonly schemaVersion: 1;
  readonly storyId: string;
  readonly taskId: string;
  readonly commit: string;
  readonly createdAt: string;
  readonly files: readonly {
    readonly path: string;
    readonly lines?: readonly [number, number];
    readonly sha256: string;
    readonly sizeBytes: number;
  }[];
  readonly pending: readonly string[];
  readonly totalBytes: number;
}

export interface ContextPackValidation {
  readonly valid: boolean;
  readonly stale: readonly string[];
}

export class SensitivePathError extends Error {
  public constructor(path: string) {
    super(`Sensitive path cannot be added to a context pack: ${path}`);
    this.name = "SensitivePathError";
  }
}

interface CacheEntry {
  readonly size: number;
  readonly mtimeMs: number;
  readonly sha256: string;
}

export class ContentHashCache {
  readonly #entries = new Map<string, CacheEntry>();

  public async hash(path: string): Promise<{ sha256: string; sizeBytes: number }> {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new TypeError(`Context source is not a file: ${path}`);
    const cached = this.#entries.get(path);
    if (cached?.size === metadata.size && cached.mtimeMs === metadata.mtimeMs) {
      return { sha256: cached.sha256, sizeBytes: cached.size };
    }
    const content = await readFile(path);
    const sha256 = createHash("sha256").update(content).digest("hex");
    this.#entries.set(path, { size: metadata.size, mtimeMs: metadata.mtimeMs, sha256 });
    return { sha256, sizeBytes: metadata.size };
  }

  public invalidate(path?: string): void {
    if (path === undefined) this.#entries.clear();
    else this.#entries.delete(path);
  }
}

export async function createContextPack(input: ContextPackInput): Promise<ContextPack> {
  if (input.maxTotalBytes <= 0) throw new RangeError("maxTotalBytes must be positive");
  const maxFiles = input.maxFiles ?? 50;
  if (input.files.length > maxFiles) throw new RangeError(`Context pack file limit exceeded: ${maxFiles}`);
  const root = await realpath(resolve(input.root));
  const cache = input.hashCache ?? new ContentHashCache();
  const files: ContextPack["files"][number][] = [];
  let totalBytes = 0;

  for (const source of input.files) {
    assertSafeRelative(source.path);
    const lexical = resolve(root, source.path);
    assertInside(root, lexical);
    const target = await realpath(lexical);
    assertInside(root, target);
    const normalized = relative(root, target).split(sep).join("/");
    assertNotSensitive(normalized);
    validateLines(source.lines);
    const hashed = await cache.hash(target);
    totalBytes += hashed.sizeBytes;
    if (totalBytes > input.maxTotalBytes) {
      throw new RangeError(`Context pack size limit exceeded: ${input.maxTotalBytes} bytes`);
    }
    files.push({
      path: normalized,
      ...(source.lines === undefined ? {} : { lines: source.lines }),
      ...hashed
    });
  }

  return {
    schemaVersion: 1,
    storyId: input.storyId,
    taskId: input.taskId,
    commit: input.commit,
    createdAt: input.createdAt,
    files,
    pending: [...input.pending],
    totalBytes
  };
}

export async function validateContextPack(
  rootInput: string,
  pack: ContextPack
): Promise<ContextPackValidation> {
  const root = await realpath(resolve(rootInput));
  const cache = new ContentHashCache();
  const stale: string[] = [];
  for (const source of pack.files) {
    try {
      assertSafeRelative(source.path);
      assertNotSensitive(source.path);
      const target = await realpath(resolve(root, source.path));
      assertInside(root, target);
      const current = await cache.hash(target);
      if (current.sha256 !== source.sha256 || current.sizeBytes !== source.sizeBytes) {
        stale.push(source.path);
      }
    } catch {
      stale.push(source.path);
    }
  }
  return { valid: stale.length === 0, stale };
}

function assertSafeRelative(path: string): void {
  if (path.trim().length === 0 || isAbsolute(path)) {
    throw new RangeError(`Context path must be project-relative: ${path}`);
  }
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new RangeError(`Context path resolves outside project root: ${target}`);
}

function assertNotSensitive(path: string): void {
  const parts = path.toLowerCase().split(/[\\/]/u);
  const name = parts.at(-1) ?? "";
  const sensitive =
    parts.includes(".git") ||
    parts.includes("logs") ||
    parts.includes("credentials") ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /\.(?:pem|key|p12|pfx|sqlite|sqlite3|db)$/u.test(name) ||
    /(?:credential|secret|token)/u.test(name);
  if (sensitive) throw new SensitivePathError(path);
}

function validateLines(lines: ContextFileInput["lines"]): void {
  if (lines === undefined) return;
  if (!Number.isInteger(lines[0]) || !Number.isInteger(lines[1]) || lines[0] < 1 || lines[1] < lines[0]) {
    throw new RangeError(`Invalid line range: ${lines.join("-")}`);
  }
}
