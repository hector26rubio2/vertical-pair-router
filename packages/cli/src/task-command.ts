import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { BacklogService, type PlannedSlice, type WorkflowKind } from '@vpr/backlog';
import { parseProjectProfile } from '@vpr/config';
import type { EntityId } from '@vpr/contracts';
import { createSafeProcessRunner } from '@vpr/quality';
import { resolveExecutable } from '@vpr/runtime';
import { SqliteStorage } from '@vpr/storage-sqlite';
import type { CliIo } from './cli.js';

export async function runTaskCommand(args: readonly string[], io: CliIo): Promise<number> {
  const flag = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const project = flag('--project'), db = flag('--db');
  if (!project || !db) { io.stderr('Task requires --project and --db\n'); return 2; }
  const root = resolve(project);
  const profile = parseProjectProfile(JSON.parse(await readFile(join(root, '.vpr', 'profile.json'), 'utf8')));
  const storage = new SqliteStorage(resolve(db));
  await storage.initialize();
  const nextId = (prefix: string): EntityId => `${prefix}_${randomUUID()}` as EntityId;
  const now = (): string => new Date().toISOString();
  const service = new BacklogService({ projectId: profile.projectId, storage, actor: 'vpr-cli', confirmation: 'required', now, nextId });
  try {
    if (args[0] === 'list') {
      io.stdout(JSON.stringify({ stories: await service.listStories(), tasks: await service.listTasks(), runs: await service.listRuns() }) + '\n');
      return 0;
    }
    if (args[0] === 'plan') {
      const inputPath = flag('--input');
      const storyId = flag('--story-id');
      if (!inputPath || !storyId) { io.stderr('Plan requires --input and --story-id\n'); return 2; }
      const input = JSON.parse(await readFile(resolve(inputPath), 'utf8')) as { workflow: WorkflowKind; slices: PlannedSlice[] };
      if (!['feature', 'bugfix-simple', 'bugfix-complex', 'refactor', 'documentation', 'infrastructure', 'research'].includes(input.workflow) || !Array.isArray(input.slices)) throw new TypeError('Invalid task plan');
      if (!args.includes('--apply')) {
        io.stdout(JSON.stringify({ applied: false, storyId, plan: input }) + '\n'); return 0;
      }
      const tasks = await service.planTasks(storyId as EntityId, input.workflow, input.slices);
      io.stdout(JSON.stringify({ applied: true, tasks }) + '\n'); return 0;
    }
    if (args[0] === 'review') {
      const runId = flag('--run-id');
      const run = runId ? await service.getRun(runId as EntityId) : undefined;
      if (!run || run.state !== 'REVIEW') throw new Error('Review requires a Run in REVIEW');
      const reference = flag('--review-reference');
      if (!reference || !args.includes('--approve-review')) {
        io.stdout(JSON.stringify({ applied: false, run, required: '--approve-review --review-reference <review-file>' }) + '\n'); return 0;
      }
      const review = await readFile(resolve(reference), 'utf8');
      if (review.trim().length === 0) throw new Error('Review evidence must not be empty');
      await storage.appendEvent({ schemaVersion: 1, eventId: nextId('evt'), projectId: profile.projectId, taskId: run.taskId, runId: run.runId, actor: 'vpr-cli', type: 'ReviewApproved', occurredAt: now(), payload: { reference: resolve(reference), source: 'measured' } });
      const completed = await service.transitionRun(run.runId, 'COMPLETED');
      const task = await service.getTask(run.taskId);
      if (task?.status === 'READY') await service.transitionTask(task.taskId, 'RUNNING');
      if (task?.status === 'READY' || task?.status === 'RUNNING') await service.transitionTask(task.taskId, 'COMPLETED');
      io.stdout(JSON.stringify({ applied: true, run: completed }) + '\n'); return 0;
    }
    if (args[0] !== 'check') { io.stderr('Task actions: list, plan, check, review\n'); return 2; }
    const taskId = flag('--task-id');
    const task = taskId ? await service.getTask(taskId as EntityId) : undefined;
    if (!task) throw new RangeError('Unknown Task');
    if (task.requiredChecks.length === 0) throw new Error('Task has no required checks');
    const checks = await Promise.all(task.requiredChecks.map(async name => {
      const command = profile.checks[name];
      if (!command) throw new Error(`Check is absent from project profile: ${name}`);
      const program = await resolveExecutable(command.program);
      if (!program) throw new Error(`Check executable unavailable: ${command.program}`);
      return { name, program, args: command.args };
    }));
    if (!args.includes('--approve-checks')) {
      io.stdout(JSON.stringify({ applied: false, taskId, checks, cwd: root, timeoutMs: 60_000 }) + '\n'); return 0;
    }
    const run = await service.createRun(task.taskId);
    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
      await service.transitionRun(run.runId, 'ANALYZING');
      await service.transitionRun(run.runId, 'READY');
      await service.transitionRun(run.runId, 'RUNNING');
      await service.transitionRun(run.runId, 'VALIDATING');
      const runner = createSafeProcessRunner(checks.map(check => check.program));
      for (const check of checks) {
        const result = await runner({ ...check, cwd: root, timeoutMs: 60_000, maxOutputBytes: profile.policy.maxOutputBytes ?? 1_048_576, signal: controller.signal });
        // Persist metadata only: arbitrary repository output may contain source or secrets.
        await storage.appendEvent({ schemaVersion: 1, eventId: nextId('evt'), projectId: profile.projectId, storyId: task.storyId, taskId: task.taskId, runId: run.runId, actor: 'vpr-cli', type: 'EvidenceRecorded', occurredAt: now(), payload: { name: check.name, exitCode: result.exitCode, durationMs: result.durationMs, outputTruncated: result.outputTruncated, timedOut: result.timedOut, cancelled: result.cancelled, source: 'measured' } });
        if (result.exitCode !== 0 || result.outputTruncated || result.timedOut || result.cancelled) {
          const terminal = await service.transitionRun(run.runId, result.cancelled ? 'CANCELLED' : 'FAILED');
          io.stdout(JSON.stringify({ run: terminal, failedCheck: check.name }) + '\n'); return 1;
        }
      }
      const reviewed = await service.transitionRun(run.runId, 'REVIEW');
      io.stdout(JSON.stringify({ run: reviewed, nextAction: 'Review the Task diff and evidence before completion.' }) + '\n');
      return 0;
    } catch (error) {
      await service.transitionRun(run.runId, 'FAILED');
      throw error;
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
  } finally { await storage.close(); }
}
