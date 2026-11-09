import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ContentChangedError,
  GlossaryConflictError,
  SensitivePathError,
  applyGlossaryProposal,
  createAdr,
  createContextPack,
  createHandoff,
  proposeGlossaryTerm,
  rejectGlossaryProposal,
  resolveGlossaryPath,
  validateContextPack
} from "./index.js";

async function fixture(context: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vpr-knowledge-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
  return root;
}

test("resolves exactly one glossary inside the project", async (context) => {
  const root = await fixture(context);

  assert.equal(await resolveGlossaryPath(root, "docs/GLOSSARY.md"), join(root, "docs", "GLOSSARY.md"));
  await assert.rejects(resolveGlossaryPath(root, "../GLOSSARY.md"), /outside project root/);

  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "GLOSSARY.md"), "# Legacy\n");
  await assert.rejects(
    resolveGlossaryPath(root, "docs/GLOSSARY.md"),
    GlossaryConflictError
  );
});

test("previews and applies a glossary term only while the reviewed base is current", async (context) => {
  const root = await fixture(context);
  const target = join(root, "GLOSSARY.md");
  await writeFile(target, "# Glosario\n");
  const term = {
    canonicalTerm: "Context Pack",
    definition: "Referencias verificables para reanudar una tarea.",
    avoid: ["volcado de contexto"],
    links: ["ADR-0003"],
    source: "plan-fase-5",
    recordedAt: "2026-11-09",
    owner: "VPR"
  } as const;

  const proposal = await proposeGlossaryTerm(root, "GLOSSARY.md", term, "story_005");
  assert.equal(proposal.action, "append");
  assert.equal(proposal.storyId, "story_005");
  assert.match(proposal.diff, /^\+## Context Pack/m);
  assert.equal(await readFile(target, "utf8"), "# Glosario\n");
  const accepted = await applyGlossaryProposal(proposal, "2026-11-09T12:00:00.000Z");
  assert.equal(accepted.outcome, "accepted");
  assert.match(await readFile(target, "utf8"), /Evitar: volcado de contexto/);

  const stale = await proposeGlossaryTerm(root, "GLOSSARY.md", {
    ...term,
    canonicalTerm: "Handoff",
    definition: "Transferencia entre sesiones."
  }, "story_005");
  assert.equal(rejectGlossaryProposal(stale, "2026-11-09T12:01:00.000Z").outcome, "rejected");
  await writeFile(target, "# Cambio concurrente\n");
  await assert.rejects(applyGlossaryProposal(stale), ContentChangedError);
});

test("matches glossary headings exactly instead of replacing a longer term", async (context) => {
  const root = await fixture(context);
  await writeFile(join(root, "GLOSSARY.md"), "# Glosario\n\n## Context Pack\n\nExisting.\n");
  const proposal = await proposeGlossaryTerm(root, "GLOSSARY.md", {
    canonicalTerm: "Context",
    definition: "Entradas mínimas autorizadas.",
    avoid: [],
    links: [],
    source: "story_005",
    recordedAt: "2026-11-09",
    owner: "VPR"
  }, "story_005");

  assert.equal(proposal.action, "append");
  assert.match(proposal.content, /## Context Pack\n\nExisting\./);
  assert.match(proposal.content, /## Context\n\nEntradas mínimas/);
});

test("creates only complete durable ADRs", () => {
  const adr = createAdr({
    id: "ADR-0007",
    title: "Context packs by reference",
    status: "ACCEPTED",
    date: "2026-11-09",
    context: "Sessions need bounded resumable context.",
    decision: "Persist paths, hashes and line references, not source content.",
    alternatives: ["Copy full source into every pack."],
    consequences: ["A pack can become stale and must be revalidated."]
  });
  assert.match(adr, /^# ADR-0007:/);
  assert.match(adr, /## Alternatives/);
  assert.throws(
    () => createAdr({
      id: "ADR-0008",
      title: "Incomplete",
      status: "ACCEPTED",
      date: "2026-11-09",
      context: "x",
      decision: "",
      alternatives: [],
      consequences: []
    }),
    /decision/
  );
});

test("context packs contain bounded references and detect stale files", async (context) => {
  const root = await fixture(context);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "route.ts"), "export const route = 'local';\n");
  const pack = await createContextPack({
    root,
    storyId: "story_005",
    taskId: "task_005",
    commit: "abc1234",
    createdAt: "2026-11-09T12:00:00.000Z",
    files: [{ path: "src/route.ts", lines: [1, 1] }],
    pending: ["Run provider-backed smoke when authorized."],
    maxTotalBytes: 1024
  });

  assert.equal(pack.files[0]?.path, "src/route.ts");
  assert.equal(pack.files[0]?.sizeBytes, 30);
  assert.match(pack.files[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(pack).includes("export const route"), false);
  assert.deepEqual(await validateContextPack(root, pack), { valid: true, stale: [] });

  await writeFile(join(root, "src", "route.ts"), "export const route = 'changed';\n");
  const validation = await validateContextPack(root, pack);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.stale, ["src/route.ts"]);
});

test("context packs reject sensitive and oversized sources", async (context) => {
  const root = await fixture(context);
  await writeFile(join(root, ".env"), "TOKEN=secret\n");
  await writeFile(join(root, "large.txt"), "x".repeat(20));

  await assert.rejects(
    createContextPack({
      root,
      storyId: "story_005",
      taskId: "task_005",
      commit: "abc",
      createdAt: "2026-11-09T12:00:00.000Z",
      files: [{ path: ".env" }],
      pending: [],
      maxTotalBytes: 100
    }),
    SensitivePathError
  );
  await assert.rejects(
    createContextPack({
      root,
      storyId: "story_005",
      taskId: "task_005",
      commit: "abc",
      createdAt: "2026-11-09T12:00:00.000Z",
      files: [{ path: "large.txt" }],
      pending: [],
      maxTotalBytes: 10
    }),
    /size limit/
  );
});

test("handoffs point to evidence and omit source bodies", () => {
  const handoff = createHandoff({
    contextPackPath: ".vpr/context/story_005-task_005.json",
    commit: "abc1234",
    gitStatus: "clean",
    checks: [{ name: "pnpm check", status: "passed", evidence: "39/39" }],
    nextAction: "Continue Phase 6."
  });
  assert.match(handoff, /context pack/i);
  assert.match(handoff, /pnpm check: passed \(39\/39\)/);
  assert.equal(handoff.includes("sourceBodies"), false);
});
