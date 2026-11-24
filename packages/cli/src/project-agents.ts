import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import type { ProjectProfileV1 } from "@vpr/config";
import { allowedProjectPath } from "@vpr/runtime";
export interface ProjectAgentReceipt {
  readonly name: string;
  readonly state: "created" | "preserved" | "unavailable";
  readonly path: string;
}
async function definitions(
  root: string,
  directory: string,
  depth = 0,
): Promise<Map<string, string>> {
  if (depth > 5) throw Error("Agent directory nesting exceeds five levels");
  const found = new Map<string, string>();
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  if (entries.length > 200) throw Error("Agent directory exceeds 200 entries");
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error("Review agent symbolic links before generation");
    if (!(await allowedProjectPath(root, path, [".claude/agents"])))
      throw Error("Agent directory escapes project");
    if (entry.isDirectory())
      for (const [name, file] of await definitions(root, path, depth + 1)) found.set(name, file);
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const content = await readFile(path, "utf8");
    if (Buffer.byteLength(content) > 65536) throw Error("Existing agent exceeds 64 KiB");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
    if (!match) continue;
    const doc = parseDocument(match[1]!, { uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) throw Error("Review invalid agent frontmatter");
    const value = doc.toJS({ maxAliasCount: 0 }) as { name?: unknown } | null;
    if (typeof value?.name === "string") found.set(value.name, path);
  }
  return found;
}
export async function provisionProjectAgents(
  root: string,
  profile: ProjectProfileV1,
): Promise<ProjectAgentReceipt[]> {
  const models = profile.orchestration?.models.filter((m) => m.provider === "claude") ?? [];
  if (!profile.policy.allowedProviders?.includes("claude") || !models.length) return [];
  const light = models.find((m) => m.tier === "light" && m.roles.includes("inventory"));
  const reviewer = models.find((m) => m.tier === "standard" && m.roles.includes("review"));
  const coder = models.find(
    (m) =>
      m.roles.includes("coding") && (profile.orchestration?.allowLightCoding || m.tier !== "light"),
  );
  const roles = [
    {
      name: "Explore",
      model: light,
      description: "Read-only code and supplied Graphify context exploration",
      tools: "Read, Glob, Grep",
      prompt:
        "Read the supplied graph/context pack first. Return file citations. Do not modify files.",
    },
    {
      name: "vpr-review",
      model: reviewer,
      description: "Fresh review of authorized diffs and acceptance evidence",
      tools: "Read, Glob, Grep",
      prompt:
        "Review independently. Cite file, line and severity for each finding. Missing checks are N/D, never green.",
    },
    {
      name: "vpr-implement",
      model: coder,
      description: "Implement one bounded Task from a validated VPR handoff",
      tools: "Read, Glob, Grep, Write, Edit",
      prompt:
        "Validate the handoff and immutable contracts. Modify only allowed files. Return ESCALAR before leaving scope. Ask the coordinator to run checks.",
    },
  ];
  const directory = join(root, ".claude/agents");
  if (!(await allowedProjectPath(root, directory, [".claude/agents"])))
    throw Error("Agent directory escapes project");
  const existing = await definitions(root, directory),
    receipts: ProjectAgentReceipt[] = [];
  for (const role of roles) {
    const path = join(directory, role.name + ".md");
    if (existing.has(role.name)) {
      receipts.push({ name: role.name, path: existing.get(role.name)!, state: "preserved" });
      continue;
    }
    if (!role.model) {
      receipts.push({ name: role.name, path, state: "unavailable" });
      continue;
    }
    if (!(await allowedProjectPath(root, path, [".claude/agents"])))
      throw Error("Agent path escapes project");
    const content = [
      "---",
      "name: " + role.name,
      "description: " + JSON.stringify(role.description),
      "model: " + JSON.stringify(role.model.model),
      "tools: " + role.tools,
      "maxTurns: 12",
      "---",
      "<!-- Created by VPR; existing definitions are preserved. -->",
      role.prompt,
      "Exclude .tmp/, dist/, node_modules/ and .git/ from searches. Do not read credentials or app settings.",
      "Use project acceptance criteria. Do not delegate to other providers or create nested agents.",
      "When VPR is loaded its context guard protects Haiku at 90000 tokens; do not bypass guard blocks.",
      "",
    ].join("\n");
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(path, content, { flag: "wx" });
      receipts.push({ name: role.name, path, state: "created" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      receipts.push({ name: role.name, path, state: "preserved" });
    }
  }
  return receipts;
}
