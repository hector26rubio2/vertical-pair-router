import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface GlossaryTerm {
  readonly canonicalTerm: string;
  readonly definition: string;
  readonly aliases?: readonly string[];
  readonly avoid: readonly string[];
  readonly links: readonly string[];
  readonly source: string;
  readonly recordedAt: string;
  readonly owner: string;
}

export interface GlossaryProposal {
  readonly action: "append" | "replace" | "none";
  readonly target: string;
  readonly beforeHash: string | null;
  readonly content: string;
  readonly diff: string;
  readonly storyId: string;
}

export interface GlossaryProposalResolution {
  readonly storyId: string;
  readonly outcome: "accepted" | "rejected";
  readonly target: string;
  readonly resolvedAt: string;
}

export class GlossaryConflictError extends Error {
  public constructor(paths: readonly string[]) {
    super(`Multiple authoritative glossaries detected: ${paths.join(", ")}`);
    this.name = "GlossaryConflictError";
  }
}

export class ContentChangedError extends Error {
  public constructor(target: string) {
    super(`Content changed after preview: ${target}`);
    this.name = "ContentChangedError";
  }
}

export async function resolveGlossaryPath(
  rootInput: string,
  configuredPath: string
): Promise<string> {
  const root = resolve(rootInput);
  if (configuredPath.trim().length === 0 || isAbsolute(configuredPath)) {
    throw new TypeError("Glossary path must be a non-empty project-relative path");
  }
  const target = resolve(root, configuredPath);
  assertInside(root, target);

  const candidates = [
    join(root, "GLOSSARY.md"),
    join(root, "docs", "GLOSSARY.md"),
    join(root, "knowledge", "GLOSSARY.md")
  ];
  const existing: string[] = [];
  for (const candidate of new Set(candidates)) {
    if (candidate !== target && (await exists(candidate))) existing.push(candidate);
  }
  if (existing.length > 0) {
    throw new GlossaryConflictError([target, ...existing]);
  }
  return target;
}

export async function proposeGlossaryTerm(
  root: string,
  configuredPath: string,
  term: GlossaryTerm,
  storyId: string
): Promise<GlossaryProposal> {
  validateTerm(term);
  if (storyId.trim().length === 0) throw new TypeError("storyId is required");
  const target = await resolveGlossaryPath(root, configuredPath);
  const before = await readOptional(target);
  const block = renderTerm(term);
  const heading = `## ${term.canonicalTerm}`;
  const current = before === null ? null : extractSection(before, heading);
  if (current !== null && before !== null) {
    if (current === block.trimEnd()) {
      return {
        action: "none",
        target,
        beforeHash: sha256(before),
        content: before,
        diff: "",
        storyId
      };
    }
    const content = before.replace(current, block.trimEnd());
    return {
      action: "replace",
      target,
      beforeHash: sha256(before),
      content,
      diff: renderDiff(current, block.trimEnd()),
      storyId
    };
  }

  const prefix = before === null ? "# Glosario\n" : before.trimEnd();
  const content = `${prefix}\n\n${block}`;
  return {
    action: "append",
    target,
    beforeHash: before === null ? null : sha256(before),
    content,
    diff: block
      .trimEnd()
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n"),
    storyId
  };
}

export async function applyGlossaryProposal(
  proposal: GlossaryProposal,
  resolvedAt = new Date().toISOString()
): Promise<GlossaryProposalResolution> {
  const current = await readOptional(proposal.target);
  const hash = current === null ? null : sha256(current);
  if (hash !== proposal.beforeHash) throw new ContentChangedError(proposal.target);
  if (proposal.action === "none") {
    return { storyId: proposal.storyId, outcome: "accepted", target: proposal.target, resolvedAt };
  }

  await mkdir(dirname(proposal.target), { recursive: true });
  const temporary = `${proposal.target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, proposal.content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, proposal.target);
  } finally {
    await rm(temporary, { force: true });
  }
  return { storyId: proposal.storyId, outcome: "accepted", target: proposal.target, resolvedAt };
}

export function rejectGlossaryProposal(
  proposal: GlossaryProposal,
  resolvedAt = new Date().toISOString()
): GlossaryProposalResolution {
  return { storyId: proposal.storyId, outcome: "rejected", target: proposal.target, resolvedAt };
}

function validateTerm(term: GlossaryTerm): void {
  const required = [
    ["canonicalTerm", term.canonicalTerm],
    ["definition", term.definition],
    ["source", term.source],
    ["recordedAt", term.recordedAt],
    ["owner", term.owner]
  ] as const;
  for (const [name, value] of required) {
    if (value.trim().length === 0) throw new TypeError(`${name} is required`);
  }
  if (/\r|\n|^#/.test(term.canonicalTerm)) {
    throw new TypeError("canonicalTerm must be a single Markdown-safe line");
  }
}

function renderTerm(term: GlossaryTerm): string {
  const lines = [
    `## ${term.canonicalTerm}`,
    "",
    term.definition.trim(),
    "",
    `- Alias: ${term.aliases?.join(", ") || "ninguno"}`,
    `- Evitar: ${term.avoid.join(", ") || "ninguno"}`,
    `- Enlaces: ${term.links.join(", ") || "ninguno"}`,
    `- Fuente: ${term.source}`,
    `- Fecha: ${term.recordedAt}`,
    `- Owner: ${term.owner}`,
    ""
  ];
  return lines.join("\n");
}

function extractSection(content: string, heading: string): string | null {
  const pattern = new RegExp(`(?:^|\\n)${escapeRegExp(heading)}(?=\\r?$)`, "mu");
  const match = pattern.exec(content);
  if (match === null) return null;
  const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
  const next = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, next === -1 ? content.length : next).trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function renderDiff(before: string, after: string): string {
  return [
    ...before.split("\n").map((line) => `-${line}`),
    ...after.split("\n").map((line) => `+${line}`)
  ].join("\n");
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new RangeError(`Glossary path resolves outside project root: ${target}`);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
