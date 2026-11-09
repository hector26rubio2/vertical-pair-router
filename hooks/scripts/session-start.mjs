import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const INPUT_LIMIT = 64 * 1024;
const PROFILE_LIMIT = 64 * 1024;
const SAFE_SOURCE = new Set(["startup", "resume", "clear", "compact", "fork"]);

try {
  const raw = await readBoundedStdin(INPUT_LIMIT);
  const input = JSON.parse(raw);
  if (!isRecord(input) || input.hook_event_name !== "SessionStart") {
    throw new Error("Expected SessionStart hook input");
  }
  if (typeof input.cwd !== "string" || !isAbsolute(input.cwd)) {
    throw new Error("Expected an absolute hook cwd");
  }

  const root = resolve(input.cwd);
  const profilePath = resolve(join(root, ".vpr", "profile.json"));
  if (!isInside(root, profilePath)) throw new Error("Profile path escaped project root");
  const profile = await readProfile(profilePath);
  const source = SAFE_SOURCE.has(input.source) ? input.source : "unknown";
  const facts = [
    `VPR session source: ${source}.`,
    profileFact(profile),
    "VPR external telemetry is disabled by default.",
    "A quality check is not passed unless current CLI evidence records its observed result."
  ];

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: facts.join(" ")
      }
    })
  );
} catch (error) {
  process.stderr.write(
    `VPR SessionStart hook failed: ${error instanceof Error ? error.message : "unknown error"}\n`
  );
  process.exitCode = 1;
}

async function readBoundedStdin(limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error(`input exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readProfile(path) {
  try {
    const metadata = await stat(path);
    if (metadata.size > PROFILE_LIMIT) return { status: "too-large" };
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) return { status: "invalid" };
    const projectId =
      typeof parsed.projectId === "string" && /^project_[A-Za-z0-9_-]+$/u.test(parsed.projectId)
        ? parsed.projectId
        : null;
    const checks = isRecord(parsed.checks)
      ? Object.keys(parsed.checks).filter((name) => /^[A-Za-z0-9_-]{1,40}$/u.test(name)).sort()
      : [];
    return { status: "ready", projectId, checks };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { status: "absent" };
    return { status: "invalid" };
  }
}

function profileFact(profile) {
  if (profile.status === "ready") {
    const id = profile.projectId ?? "unidentified project";
    const checks = profile.checks.length > 0 ? profile.checks.join(", ") : "none configured";
    return `VPR profile: schema v1, ${id}; configured checks: ${checks}.`;
  }
  if (profile.status === "absent") return "VPR profile: absent; run vpr init preview before applying one.";
  if (profile.status === "too-large") return "VPR profile: ignored because it exceeds the local size limit.";
  return "VPR profile: invalid or unreadable; no profile policy was loaded.";
}

function isInside(root, target) {
  const child = relative(root, target);
  return child.length > 0 && !child.startsWith("..") && !isAbsolute(child);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

