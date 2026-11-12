import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runCli } from '../packages/cli/dist/index.js';
import { resolveExecutable } from '../packages/runtime/dist/index.js';
import { BacklogService, createStoryDraftFromGrill } from '../packages/backlog/dist/index.js';
import { SqliteStorage } from '../packages/storage-sqlite/dist/index.js';
import { createContextPack } from '../packages/knowledge/dist/index.js';
import { runMeasuredClaude } from './lib/run-measured-claude.mjs';
import { officialCostBreakdown } from './lib/official-cost-breakdown.mjs';

if (!process.argv.includes('--approve-provider')) throw new Error('--approve-provider required: real native account usage');
const root = resolve('.');
const flag = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const coordinatorModel = flag('--coordinator-model') ?? 'claude-sonnet-5-5';
const executorModel = flag('--executor-model') ?? 'claude-haiku-5-5';
if (![coordinatorModel, executorModel].every(model => /^claude-[a-z0-9-]+$/u.test(model))) throw new Error('Use full Claude model IDs');
const family = model => model.replace(/^claude-/u, '').replace(/-\d.*$/u, '');
const delegatedArm = `${family(coordinatorModel)}-orchestrator-${family(executorModel)}-executor`;
const executable = await resolveExecutable('claude');
if (!executable) throw new Error('Native Claude Code unavailable');
const resume = flag('--resume');
const directory = resume ? resolve(resume) : join(root, '.tmp', 'delegation-pilot-' + Date.now());
if (dirname(directory) !== join(root, '.tmp') || !directory.split(/[\\/]/u).at(-1).startsWith('delegation-pilot-')) throw new Error('Resume must be an isolated delegation pilot inside .tmp');
await mkdir(directory, { recursive: true });
const reportPath = join(directory, 'report.json');
const feature = await readFile(join(root, 'tests/fixtures/inventory-pilot/FEATURE.txt'), 'utf8');
const acceptance = join(root, 'tools/lib/inventory-acceptance.mjs');
const acceptanceHash = createHash('sha256').update(await readFile(acceptance)).digest('hex');
const prices = JSON.parse(await readFile(join(root, 'docs/research/model-price-catalog.json'), 'utf8'));
const report = resume ? JSON.parse(await readFile(reportPath, 'utf8')) : { schemaVersion: 2, at: new Date().toISOString(), directory, acceptanceHash,
  scenario: 'Native Sonnet solo versus configurable native coordinator and executor models',
  strategySelection: 'Controlled experimental assignment requested by owner; not an adaptive routing victory',
  repetitions: 1, fixedOrder: true, cacheOrderConfound: true, meteringInferenceTokens: 0,
  rows: [] };
if (report.acceptanceHash !== acceptanceHash) throw new Error('External acceptance changed; do not mix experiments');
report.scenario = 'Native Sonnet solo versus configurable native coordinator and executor models';
let saving = Promise.resolve();
const save = () => { const content = JSON.stringify(report, null, 2) + '\n'; saving = saving.then(() => writeFile(reportPath, content)); return saving; };
async function command(program, args, cwd, env = {}) {
  const start = performance.now();
  const child = spawn(program, args, { cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => child.kill(), 20000);
  const exitCode = await new Promise((done, reject) => {
    child.once('error', reject);
    child.stdout.on('data', data => { if (stdout.length < 1000000) stdout += data; });
    child.stderr.on('data', data => { if (stderr.length < 2000) stderr += data; });
    child.once('close', done);
  }).finally(() => clearTimeout(timer));
  return { exitCode, stdout, stderr, durationMs: Math.round(performance.now() - start) };
}
async function git(args, cwd) {
  const result = await command('git', args, cwd);
  if (result.exitCode !== 0) throw new Error('Pilot Git failed');
  return result.stdout.trim();
}
async function check(cwd, external) {
  const result = await command(process.execPath, ['--test', '--test-isolation=none', '--test-timeout=10000', '--test-reporter=tap', external ? acceptance : 'test/*.test.mjs'], cwd, { VPR_PILOT_PROJECT: cwd });
  const number = name => Number(result.stdout.match(new RegExp('# ' + name + ' (\\d+)'))?.[1] ?? 0);
  return { exitCode: result.exitCode, passed: number('pass'), failed: number('fail'), cancelled: number('cancelled'), durationMs: result.durationMs };
}
const implementationPrompt = `Implement FEATURE.txt. Edit only src/ and new test/ files, preserving test/base.test.mjs and package/specification files. No dependencies, commits, network, subprocesses or delegation. Read src/store.mjs and src/server.mjs directly. Add behavioral tests; every HTTP server and SQLite handle must close using idempotent context.after cleanup. A local deterministic harness has already observed six failing acceptance tests and runs the same external tests plus your tests after you finish. You have file tools only; do not claim unexecuted tests passed. Finish with a short summary, no pasted source.\n`;
for (const arm of ['sonnet-solo', delegatedArm]) {
  const previous = report.rows.find(row => row.arm === arm);
  if (previous) {
    if (previous.status !== 'accepted' && previous.statusAfterRepair !== 'accepted') throw new Error('Existing incomplete arm must be inspected; will not overwrite or rerun it');
    if (arm !== 'sonnet-solo' && ((previous.coordinatorModel ?? 'claude-sonnet-5-5') !== coordinatorModel || (previous.executorModel ?? 'claude-haiku-5-5') !== executorModel)) throw new Error('Existing arm uses different model versions');
    continue;
  }
  const cwd = join(directory, arm);
  await cp(join(root, 'tests/fixtures/inventory-pilot'), cwd, { recursive: true });
  await git(['init', '--initial-branch=main'], cwd);
  await git(['add', '.'], cwd);
  await git(['-c', 'user.name=VPR local pilot', '-c', 'user.email=pilot@localhost', '-c', 'core.hooksPath=', 'commit', '-m', 'Identical inventory project'], cwd);
  const row = { arm, cwd, baseTree: await git(['rev-parse', 'HEAD^{tree}'], cwd), status: 'preflight',
    coordinatorModel: arm === 'sonnet-solo' ? null : coordinatorModel, executorModel: arm === 'sonnet-solo' ? 'claude-sonnet-5-5' : executorModel };
  report.rows.push(row);
  await save();
  row.preflight = { existing: await check(cwd, false), acceptance: await check(cwd, true) };
  if (row.preflight.existing.exitCode !== 0 || row.preflight.acceptance.failed !== 6) throw new Error('Preflight failed');
  const delegated = arm !== 'sonnet-solo';
  let storage, backlog, run, profile;
  if (delegated) {
    await runCli(['init', '--project', cwd, '--apply'], { stdout() {}, stderr(value) { throw new Error(value); } });
    profile = JSON.parse(await readFile(join(cwd, '.vpr/profile.json'), 'utf8'));
    profile.policy.allowedProviders = ['local', 'claude'];
    profile.checks = { test: { program: process.execPath, args: ['--test', '--test-timeout=10000', 'test/*.test.mjs'] } };
    await writeFile(join(cwd, '.vpr/profile.json'), JSON.stringify(profile, null, 2) + '\n');
    storage = new SqliteStorage(join(cwd, '.vpr/local.sqlite')); await storage.initialize();
    backlog = new BacklogService({ projectId: profile.projectId, storage, actor: 'vpr-delegation-pilot', confirmation: 'required', now: () => new Date().toISOString(), nextId: prefix => `${prefix}_${randomUUID()}` });
    const draft = createStoryDraftFromGrill({ projectId: profile.projectId, title: 'Idempotent stock reservations', need: 'Reserve stock once', desiredOutcome: 'Durable correct HTTP API', acceptanceCriteria: feature.split('\n').filter(Boolean), openQuestions: [], exclusions: [], attachments: ['FEATURE.txt'] });
    const story = await backlog.commitStory(await backlog.previewStory(draft), { confirmed: true });
    const [task] = await backlog.planTasks(story.story.storyId, 'feature', [{ outcome: draft.desiredOutcome, acceptanceCriteria: draft.acceptanceCriteria, demoPath: 'POST /reservations', allowedPaths: ['src/', 'test/'], requiredChecks: ['test'], risk: 'medium', changesPublicApi: true, dependsOn: [] }]);
    run = await backlog.createRun(task.taskId);
    for (const state of ['ANALYZING', 'READY', 'RUNNING']) await backlog.transitionRun(run.runId, state);
    row.taskId = task.taskId; row.runId = run.runId;
    const context = await createContextPack({ root: cwd, storyId: story.story.storyId, taskId: task.taskId, commit: await git(['rev-parse', 'HEAD'], cwd), createdAt: new Date().toISOString(), files: ['src/store.mjs', 'src/server.mjs', 'FEATURE.txt'].map(path => ({ path })), pending: [], maxTotalBytes: 12000 });
    await writeFile(join(cwd, '.vpr/context.json'), JSON.stringify(context, null, 2) + '\n');
  }
  const agents = delegated ? {
    'vpr-orchestrator': { description: 'Coordinates one inventory implementation', model: coordinatorModel, effort: 'medium', tools: ['Read', 'Agent(vpr-executor)'],
      prompt: 'You coordinate this bounded coding task. Read only relevant files. Delegate all implementation and tests to exactly ONE foreground vpr-executor using Agent. Pass concise requirements and file paths. Do not set a per-call model override, do not edit code yourself, and do not spawn another worker. After it returns, inspect changed source with Read and report concrete concerns or completion without claiming tests ran. The external local harness runs the tests. No further implementation loops in this controlled trial.' },
    'vpr-executor': { description: 'Implements the inventory feature', model: executorModel, effort: 'medium', maxTurns: 16, tools: ['Read', 'Write', 'Edit'], prompt: implementationPrompt }
  } : { 'vpr-baseline': { description: 'Implements alone without delegation', model: 'claude-sonnet-5-5', effort: 'medium', tools: ['Read', 'Write', 'Edit'], prompt: implementationPrompt } };
  const args = ['--print', '--model', delegated ? coordinatorModel : 'claude-sonnet-5-5', '--effort', 'medium', '--max-turns', '18', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--no-session-persistence', '--prompt-suggestions', 'false', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--add-dir', cwd,
    '--tools', 'Read,Edit,Write,Agent', '--allowedTools', 'Read,Edit,Write,Agent(vpr-executor)',
    '--agents', JSON.stringify(agents), '--agent', delegated ? 'vpr-orchestrator' : 'vpr-baseline'];
  if (delegated) args.push('--plugin-dir', join(root, 'dist/npm/plugin'));
  row.status = 'running'; await save();
  console.log(JSON.stringify({ phase: 'running', arm, reportPath }));
  const prompt = `Working directory: ${cwd}. ${delegated ? 'Coordinate via the configured vpr-executor. The initialized VPR context references are in .vpr/context.json. ' : ''}${implementationPrompt}\nFeature:\n${feature}`;
  // The main request says no delegation only for the solo executor. The coordinator
  // receives its own explicit mandate; remove that executor-only prohibition.
  const correctedPrompt = delegated ? prompt.replace('or delegation.', 'or delegation by the executor.') : prompt;
  row.receipt = await runMeasuredClaude({ executable, cwd, args, prompt: correctedPrompt,
    onSnapshot(value) { row.receipt = value; void save(); } });
  row.status = 'validating'; await save();
  row.checks = { own: await check(cwd, false), acceptance: await check(cwd, true) };
  row.acceptanceUnchanged = acceptanceHash === createHash('sha256').update(await readFile(acceptance)).digest('hex');
  row.changedPaths = (await git(['ls-files', '--modified', '--others', '--exclude-standard'], cwd)).split('\n').filter(Boolean).map(value => value.replaceAll('\\', '/'));
  row.allowedChanges = row.changedPaths.every(path => (path.startsWith('src/') || path.startsWith('test/')) && path !== 'test/base.test.mjs');
  const calls = row.receipt.tools.filter(tool => tool.name === 'Agent' && !tool.parentToolUseId);
  row.delegationVerified = delegated ? calls.length === 1 && calls[0].targetAgent === 'vpr-executor' && calls[0].failed === false && calls[0].endMs !== null &&
    !row.receipt.tools.some(tool => !tool.parentToolUseId && ['Edit', 'Write'].includes(tool.name)) &&
    row.receipt.models.some(model => model.model === executorModel && model.totalTokens > 0) &&
    row.receipt.models.every(model => [executorModel, coordinatorModel].includes(model.model)) : calls.length === 0;
  row.models = row.receipt.models.map(model => ({ ...model,
    role: delegated ? coordinatorModel === executorModel ? 'combined-roles-same-model' : model.model === executorModel ? 'executor' : 'orchestrator-reviewer' : 'sole-executor-reviewer',
    cost: officialCostBreakdown(model, row.receipt.requests, prices) }));
  row.totalCost = row.models.length && row.models.every(model => model.cost) ? {
    min: row.models.reduce((sum, model) => sum + model.cost.totalUsd.min, 0), max: row.models.reduce((sum, model) => sum + model.cost.totalUsd.max, 0)
  } : null;
  row.checksPassed = row.checks.own.exitCode === 0 && row.checks.acceptance.exitCode === 0 && row.allowedChanges && row.acceptanceUnchanged;
  row.comparable = row.checksPassed && row.delegationVerified && row.receipt.completeAccounting && row.receipt.terminalReceipt?.success === true;
  row.status = row.comparable ? 'accepted' : 'incomplete';
  await save();
  if (storage) {
    for (const model of row.models) await storage.appendEvent({ schemaVersion: 1, eventId: `evt_${randomUUID()}`, projectId: profile.projectId, taskId: run.taskId, runId: run.runId, actor: 'vpr-delegation-pilot', type: 'AgentUsageObserved', occurredAt: new Date().toISOString(), payload: { provider: 'claude', agentId: model.role, role: model.role, scope: 'model-whole-tree', model: model.model, inputTokens: model.inputTokens, outputTokens: model.outputTokens, cacheReadTokens: model.cacheReadTokens, cacheWriteTokens: model.cacheWriteTokens, source: 'provider_reported' } });
    await backlog.transitionRun(run.runId, 'VALIDATING');
    await backlog.transitionRun(run.runId, row.comparable ? 'REVIEW' : row.receipt.stopped === 'deadline' ? 'CANCELLED' : 'FAILED');
    await storage.close();
  }
  console.log(JSON.stringify({ phase: 'measured', arm, status: row.status, delegationVerified: row.delegationVerified,
    totals: row.receipt.totals, models: row.models, timings: row.receipt.timings, checks: row.checks, cost: row.totalCost }));
}
await saving;
console.log(JSON.stringify({ reportPath, directory }));
