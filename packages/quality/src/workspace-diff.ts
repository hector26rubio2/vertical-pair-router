import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ProcessRunner } from "@vpr/contracts";

export interface WorkspaceDiff {
  readonly snapshotHash: string;
  readonly capturedAt: string;
  readonly stagedDiff: string;
  readonly unstagedDiff: string;
  readonly untracked: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly content: string;
  }[];
}

export async function captureWorkspaceDiff(input: {
  readonly root: string;
  readonly gitProgram: string;
  readonly processRunner: ProcessRunner;
  readonly capturedAt: string;
  readonly maxOutputBytes: number;
  readonly maxUntrackedBytes: number;
}): Promise<WorkspaceDiff> {
  const root = await realpath(resolve(input.root));
  const stagedDiff = await git(input, root, ["diff", "--cached", "--no-ext-diff", "--binary", "--"]);
  const unstagedDiff = await git(input, root, ["diff", "--no-ext-diff", "--binary", "--"]);
  const untrackedRaw = await git(input, root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = untrackedRaw.split("\0").filter(Boolean).sort();
  const untracked: WorkspaceDiff["untracked"][number][] = [];
  let total = 0;
  for (const path of paths) {
    if (isAbsolute(path)) throw new RangeError(`Git returned an absolute untracked path: ${path}`);
    const target = await realpath(resolve(root, path));
    assertInside(root, target);
    const metadata = await stat(target);
    if (!metadata.isFile()) continue;
    total += metadata.size;
    if (total > input.maxUntrackedBytes) {
      throw new RangeError(`Untracked diff exceeds ${input.maxUntrackedBytes} bytes`);
    }
    const body = await readFile(target);
    untracked.push({
      path: relative(root, target).split(sep).join("/"),
      sha256: sha256(body),
      sizeBytes: metadata.size,
      content: body.toString("utf8")
    });
  }
  const snapshotHash = sha256(JSON.stringify({
    stagedDiff,
    unstagedDiff,
    untracked: untracked.map(({ path, sha256, sizeBytes }) => ({ path, sha256, sizeBytes }))
  }));
  return { snapshotHash, capturedAt: input.capturedAt, stagedDiff, unstagedDiff, untracked };
}

async function git(
  input: Parameters<typeof captureWorkspaceDiff>[0],
  root: string,
  args: readonly string[]
): Promise<string> {
  const result = await input.processRunner({
    program: input.gitProgram,
    args,
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes: input.maxOutputBytes
  });
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.cancelled ||
    result.outputTruncated
  ) {
    throw new Error(`Git diff capture failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new RangeError(`Diff path resolves outside project root: ${target}`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
