import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  createStoryDraftFromGrill,
  type BacklogService
} from "@vpr/backlog";
import type { EntityId, StorageAdapter } from "@vpr/contracts";
import {
  applyGlossaryProposal,
  proposeGlossaryTerm,
  resolveGlossaryPath,
  type GlossaryProposal,
  type GlossaryTerm
} from "@vpr/knowledge";
import { projectUsage, projectUsageComparisons } from "@vpr/observability";

export interface DashboardServerOptions {
  readonly root: string;
  readonly projectId: EntityId;
  readonly glossaryPath: string;
  readonly backlog: BacklogService;
  readonly storage: StorageAdapter;
}

export interface DashboardServer {
  readonly url: string;
  readonly token: string;
  readonly csrfToken: string;
  close(): Promise<void>;
}

export async function createDashboardServer(
  options: DashboardServerOptions
): Promise<DashboardServer> {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const proposals = new Map<string, GlossaryProposal>();
  let expectedOrigin = "";
  let expectedHost = "";
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      if (request.headers.host !== expectedHost) return json(response, 421, { error: "invalid-host" });
      if (request.url === "/") return html(response, dashboardHtml());
      if (request.url === "/app.js") return javascript(response, dashboardScript());
      if (request.url === "/style.css") return css(response, dashboardCss());
      if (!request.url?.startsWith("/api/")) return json(response, 404, { error: "not-found" });
      if (request.headers.authorization !== `Bearer ${token}`) {
        return json(response, 401, { error: "unauthorized" });
      }
      if (request.method !== "GET") {
        if (
          request.headers.origin !== expectedOrigin ||
          request.headers["x-vpr-csrf"] !== csrfToken
        ) {
          return json(response, 403, { error: "csrf-or-origin" });
        }
      }
      if (request.method === "GET" && request.url === "/api/snapshot") {
        const events = await options.storage.readEvents(options.projectId);
        const glossaryTarget = await resolveGlossaryPath(options.root, options.glossaryPath);
        const stories = await options.backlog.listStories();
        const tasks = await options.backlog.listTasks();
        return json(response, 200, {
          stories,
          tasks,
          usage: projectUsage(events),
          comparisons: projectUsageComparisons(events),
          glossary: parseGlossary(await readFile(glossaryTarget, "utf8"), stories, tasks)
        });
      }
      if (request.method === "POST" && request.url === "/api/stories") {
        const body = await readJsonBody(request);
        const input = parseStoryBody(body);
        const proposal = await options.backlog.previewStory(createStoryDraftFromGrill({
          projectId: options.projectId,
          ...input.story
        }));
        const record = input.apply
          ? await options.backlog.commitStory(proposal, { confirmed: true })
          : undefined;
        return json(response, 200, {
          action: proposal.action,
          applied: input.apply && proposal.action === "create",
          ...(record === undefined ? {} : { record })
        });
      }
      if (request.method === "POST" && request.url === "/api/glossary/proposals") {
        const body = await readJsonBody(request);
        const { term, storyId } = parseGlossaryBody(body);
        const proposal = await proposeGlossaryTerm(options.root, options.glossaryPath, term, storyId);
        const proposalId = randomUUID();
        proposals.set(proposalId, proposal);
        return json(response, 200, { proposalId, action: proposal.action, diff: proposal.diff, storyId });
      }
      if (request.method === "POST" && request.url === "/api/glossary/apply") {
        const body = await readJsonBody(request);
        const proposalId = isRecord(body) && typeof body.proposalId === "string" ? body.proposalId : "";
        const proposal = proposals.get(proposalId);
        if (proposal === undefined) return json(response, 404, { error: "unknown-proposal" });
        const resolution = await applyGlossaryProposal(proposal);
        proposals.delete(proposalId);
        return json(response, 200, resolution);
      }
      return json(response, 404, { error: "not-found" });
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "request-failed" });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Dashboard did not bind a TCP port");
  expectedHost = `127.0.0.1:${address.port}`;
  expectedOrigin = `http://${expectedHost}`;
  return {
    url: `${expectedOrigin}/#token=${encodeURIComponent(token)}&csrf=${encodeURIComponent(csrfToken)}`,
    token,
    csrfToken,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 65_536) throw new RangeError("Request body exceeds 65536 bytes");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseStoryBody(value: unknown): {
  readonly apply: boolean;
  readonly story: Omit<Parameters<typeof createStoryDraftFromGrill>[0], "projectId">;
} {
  if (!isRecord(value) || typeof value.apply !== "boolean" || !isRecord(value.story)) {
    throw new TypeError("Story request requires apply and story");
  }
  const story = value.story;
  for (const field of ["title", "need", "desiredOutcome"] as const) {
    if (typeof story[field] !== "string") throw new TypeError(`Story ${field} must be a string`);
  }
  for (const field of ["acceptanceCriteria", "exclusions", "openQuestions", "attachments"] as const) {
    if (!Array.isArray(story[field]) || !story[field].every((item) => typeof item === "string")) {
      throw new TypeError(`Story ${field} must be a string array`);
    }
  }
  return { apply: value.apply, story: story as unknown as Omit<Parameters<typeof createStoryDraftFromGrill>[0], "projectId"> };
}

function parseGlossaryBody(value: unknown): { readonly term: GlossaryTerm; readonly storyId: string } {
  if (!isRecord(value) || !isRecord(value.term) || typeof value.storyId !== "string") {
    throw new TypeError("Glossary request requires term and storyId");
  }
  const term = value.term;
  for (const field of ["canonicalTerm", "definition", "source", "recordedAt", "owner"] as const) {
    if (typeof term[field] !== "string") throw new TypeError(`Glossary ${field} must be a string`);
  }
  for (const field of ["aliases", "avoid", "links"] as const) {
    if (field === "aliases" && term[field] === undefined) continue;
    if (!Array.isArray(term[field]) || !term[field].every((item) => typeof item === "string")) {
      throw new TypeError(`Glossary ${field} must be a string array`);
    }
  }
  return { term: term as unknown as GlossaryTerm, storyId: value.storyId };
}

function parseGlossary(
  content: string,
  stories: readonly unknown[],
  tasks: readonly unknown[]
): readonly {
  term: string;
  aliases: readonly string[];
  definition: string;
  status: "canonical";
  source: string;
  references: readonly string[];
  usedBy: readonly string[];
}[] {
  return content.split(/^## /mu).slice(1).map((section) => {
    const lines = section.split(/\r?\n/u);
    const term = lines[0]?.trim() ?? "";
    const definition = lines.slice(1).find((line) => line.trim().length > 0 && !line.startsWith("- "))?.trim() ?? "";
    const source = lines.find((line) => line.startsWith("- Fuente: "))?.slice(10).trim() ?? "unavailable";
    const aliases = metadataList(lines, "Alias");
    const references = metadataList(lines, "Enlaces");
    const needle = [term, ...aliases].map((value) => value.toLocaleLowerCase("es"));
    const usedBy = [...stories, ...tasks].flatMap((record) => {
      const serialized = JSON.stringify(record).toLocaleLowerCase("es");
      if (!needle.some((value) => serialized.includes(value))) return [];
      if (!isRecord(record)) return [];
      const story = isRecord(record.story) ? record.story : undefined;
      const task = isRecord(record.task) ? record.task : undefined;
      const id = story?.storyId ?? task?.taskId;
      return typeof id === "string" ? [id] : [];
    });
    return { term, aliases, definition, status: "canonical", source, references, usedBy };
  });
}

function metadataList(lines: readonly string[], label: string): readonly string[] {
  const prefix = `- ${label}: `;
  const value = lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim();
  return value === undefined || value.length === 0
    ? []
    : value.split(",").map((item) => item.trim().replace(/^`|`$/gu, "")).filter(Boolean);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
function html(response: ServerResponse, value: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(value);
}
function javascript(response: ServerResponse, value: string): void {
  response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
  response.end(value);
}
function css(response: ServerResponse, value: string): void {
  response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
  response.end(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dashboardHtml(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vertical Pair Router</title><link rel="stylesheet" href="/style.css"></head><body><header><p>LOCAL CONTROL PLANE</p><h1>Vertical Pair Router</h1><span id="status">Conectando…</span></header><main><section><h2>Runs y uso</h2><div id="metrics" class="grid"></div><h3>Baseline / plugin</h3><div id="comparisons"></div></section><section><h2>Backlog</h2><div id="stories"></div><details><summary>Proponer Story</summary><form id="story-form"><input name="title" required placeholder="Título"><textarea name="need" required placeholder="Necesidad"></textarea><textarea name="outcome" required placeholder="Resultado deseado"></textarea><input name="criterion" required placeholder="Criterio de aceptación"><button>Previsualizar</button></form><pre id="story-preview"></pre><button id="story-apply" hidden>Aprobar y crear</button></details></section><section><h2>Glosario</h2><input id="search" type="search" placeholder="Buscar término o alias"><div id="glossary"></div><details><summary>Proponer término</summary><form id="glossary-form"><input name="term" required placeholder="Término canónico"><textarea name="definition" required placeholder="Definición"></textarea><input name="source" required placeholder="Procedencia"><input name="storyId" required placeholder="Story de origen"><button>Previsualizar diff</button></form><pre id="glossary-preview"></pre><button id="glossary-apply" hidden>Aprobar cambio canónico</button></details></section></main><script src="/app.js" defer></script></body></html>`;
}
function dashboardScript(): string {
  return `const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('token');
const csrf = params.get('csrf');
const byId = (id) => document.getElementById(id);
const statusEl = byId('status');
const metricsEl = byId('metrics');
const comparisonsEl = byId('comparisons');
const storiesEl = byId('stories');
const glossaryEl = byId('glossary');
const searchEl = byId('search');
history.replaceState(null, '', location.pathname);
const authHeaders = { Authorization: 'Bearer ' + token };
const mutationHeaders = { ...authHeaders, 'Content-Type': 'application/json', 'X-VPR-CSRF': csrf };
let storyDraft;
let proposalId;
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: mutationHeaders, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'request-failed');
  return value;
}
fetch('/api/snapshot', { headers: authHeaders }).then((response) => {
  if (!response.ok) throw new Error('unauthorized');
  return response.json();
}).then((snapshot) => {
  statusEl.textContent = 'Local · datos verificados';
  metricsEl.innerHTML = [
    ['Runs', snapshot.usage.runs.total],
    ['Checks', snapshot.usage.checks.total],
    ['Duración', metric(snapshot.usage.durationMs)],
    ['Reintentos', snapshot.usage.retries],
    ['Intervenciones', snapshot.usage.interventions],
    ['Tokens', metric(snapshot.usage.tokens)],
    ['Costo', metric(snapshot.usage.costUsd)]
  ].map((item) => '<article><b>' + item[1] + '</b><span>' + item[0] + '</span></article>').join('');
  comparisonsEl.innerHTML = snapshot.comparisons.map((comparison) =>
    '<article><h3>' + esc(comparison.storyId) + '</h3><p>Δ ' + comparison.delta +
    ' · commit ' + esc(comparison.commit) + '</p><small>' + esc(comparison.sources.join(' / ')) +
    (comparison.smallSample ? ' · muestra pequeña' : '') + '</small></article>'
  ).join('') || '<p>Sin muestras equivalentes.</p>';
  storiesEl.innerHTML = snapshot.stories.map((record) =>
    '<article><h3>' + esc(record.story.title) + '</h3><p>' + esc(record.story.desiredOutcome) +
    '</p><small>' + record.story.status + ' · rev ' + record.revision + '</small></article>'
  ).join('') || '<p>Sin Stories.</p>';
  const drawGlossary = (query) => {
    glossaryEl.innerHTML = snapshot.glossary
      .filter((entry) => [entry.term, ...entry.aliases].some((value) => value.toLowerCase().includes(query)))
      .map((entry) => '<article><h3>' + esc(entry.term) + '</h3><p>' + esc(entry.definition) +
        '</p><small>' + esc(entry.status) + ' · ' + esc(entry.source) + '</small><p class="meta">Alias: ' +
        esc(entry.aliases.join(', ') || '—') + ' · Referencias: ' + esc(entry.references.join(', ') || '—') +
        ' · Uso: ' + esc(entry.usedBy.join(', ') || '—') + '</p></article>').join('');
  };
  drawGlossary('');
  searchEl.oninput = () => drawGlossary(searchEl.value.toLowerCase());
}).catch(() => { statusEl.textContent = 'No autorizado'; });
byId('story-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  storyDraft = {
    title: form.get('title'), need: form.get('need'), desiredOutcome: form.get('outcome'),
    acceptanceCriteria: [form.get('criterion')], exclusions: [], openQuestions: [], attachments: []
  };
  const value = await post('/api/stories', { apply: false, story: storyDraft });
  byId('story-preview').textContent = JSON.stringify(value, null, 2);
  byId('story-apply').hidden = value.action !== 'create';
};
byId('story-apply').onclick = async () => {
  byId('story-preview').textContent = JSON.stringify(await post('/api/stories', { apply: true, story: storyDraft }), null, 2);
  byId('story-apply').hidden = true;
};
byId('glossary-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const value = await post('/api/glossary/proposals', {
    storyId: form.get('storyId'),
    term: { canonicalTerm: form.get('term'), definition: form.get('definition'), aliases: [], avoid: [], links: [],
      source: form.get('source'), recordedAt: new Date().toISOString().slice(0, 10), owner: 'VPR' }
  });
  proposalId = value.proposalId;
  byId('glossary-preview').textContent = value.action + '\\n' + value.diff;
  byId('glossary-apply').hidden = false;
};
byId('glossary-apply').onclick = async () => {
  byId('glossary-preview').textContent = JSON.stringify(await post('/api/glossary/apply', { proposalId }), null, 2);
  byId('glossary-apply').hidden = true;
};
function metric(value) { return value.value == null ? 'unavailable' : value.value + ' · ' + value.source; }
function esc(value) { const element = document.createElement('div'); element.textContent = String(value); return element.innerHTML; }`;
}
function dashboardCss(): string {
  return `:root{color-scheme:dark;background:#07100d;color:#e9fff6;font:16px/1.5 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#173d30 0,transparent 38%),#07100d}header,main{max-width:1100px;margin:auto;padding:2rem}header p,small{color:#72d5aa;letter-spacing:.12em}h1{font-size:clamp(2.4rem,7vw,5.5rem);line-height:.95;margin:.4rem 0 1rem}section{margin:2.5rem 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}article,details{background:#0d1c17;border:1px solid #254f40;border-radius:14px;padding:1rem;margin:.7rem 0}.grid b{display:block;font-size:2rem}.grid span,.meta{color:#9dbbad}summary,button{cursor:pointer}form{display:grid;gap:.7rem;margin:1rem 0}input,textarea,button{width:100%;padding:.8rem;border-radius:10px;border:1px solid #376b58;background:#091511;color:inherit}button{background:#1d674c;font-weight:700}textarea{min-height:6rem;resize:vertical}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#b8e7d3}@media(max-width:600px){header,main{padding:1.2rem}}`;
}
