import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseAgentUsage } from '../packages/observability/dist/index.js';
import { SqliteStorage } from '../packages/storage-sqlite/dist/index.js';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const provider = option('--provider') ?? 'codex';
if (!['codex', 'claude'].includes(provider)) throw new Error('Provider must be codex or claude');
if (!args.includes('--approve-provider')) throw new Error('Provider execution requires --approve-provider');
const root = resolve(option('--project') ?? '.');
const profile = JSON.parse(await readFile(resolve(root, '.vpr/profile.json'), 'utf8'));
const executable = option('--executable');
if (!executable) throw new Error('--executable requires the native CLI executable path');
const promptFile = option('--input');
if (!promptFile) throw new Error('--input requires a prompt file; its content is not persisted by VPR');
const taskText = await readFile(resolve(promptFile), 'utf8');
if (Buffer.byteLength(taskText) > 16384) throw new Error('Input exceeds 16 KiB');
const commandArgs = provider === 'codex'
  ? ['exec', '--json', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '--cd', root, '-']
  : ['--print', '--verbose', '--output-format', 'stream-json', '--forward-subagent-text', '--max-turns', '3', '--permission-mode', 'plan'];
const db = new SqliteStorage(resolve(root, '.vpr/local.sqlite'));
await db.initialize();
const runId = `run_${randomUUID()}`;
const started = performance.now();
const child = spawn(executable, commandArgs, { cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
const completion = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
const stop = () => child.kill();
process.once('SIGINT', stop);
const timeout = setTimeout(stop, 120000);
const rows = [];
let observedBytes = 0;
child.stdin.end(taskText);
try {
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    observedBytes += Buffer.byteLength(line);
    if (observedBytes > 4 * 1024 * 1024) { stop(); throw new Error('Provider output exceeded 4 MiB'); }
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const usage = parseAgentUsage(provider, event);
    if (!usage) continue;
    rows.push(usage);
    await db.appendEvent({ schemaVersion: 1, eventId: `evt_${randomUUID()}`, projectId: profile.projectId, runId, actor: 'vpr-agent-meter', occurredAt: new Date().toISOString(), type: 'AgentUsageObserved', payload: { ...usage } });
  }
  const exitCode = await completion;
  console.log(JSON.stringify({ runId, provider, exitCode, durationMs: Math.round(performance.now() - started), observations: rows, costUsd: null, costSource: 'unavailable' }));
  process.exitCode = exitCode === 0 ? 0 : 1;
} finally {
  clearTimeout(timeout);
  process.removeListener('SIGINT', stop);
  await db.close();
}
