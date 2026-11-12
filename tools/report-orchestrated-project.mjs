import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { officialCostBreakdown } from './lib/official-cost-breakdown.mjs';

const at = process.argv.indexOf('--report');
if (at < 0 || !process.argv[at + 1]) throw new Error('--report required');
const path = resolve(process.argv[at + 1]);
const report = JSON.parse(await readFile(path, 'utf8'));
const catalog = JSON.parse(await readFile('docs/research/model-price-catalog.json', 'utf8'));
const rangeSum = values => values.every(Boolean) ? { min: values.reduce((sum, value) => sum + value.min, 0), max: values.reduce((sum, value) => sum + value.max, 0) } : null;
const counterKeys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'];
const costKeys = ['inputUsd', 'outputUsd', 'cacheReadUsd', 'cacheWriteUsd', 'totalUsd'];
const rows = [];
for (const row of report.rows) {
  const attempts = [{ receipt: row.receipt, checks: row.checks }, ...(row.repairAttempts ?? [])];
  const latest = attempts.at(-1);
  const models = new Map();
  for (const attempt of attempts) for (const model of attempt.receipt.models) {
    const role = row.arm === 'sonnet-solo' ? 'ejecutor único' : row.coordinatorModel === row.executorModel && row.coordinatorModel
      ? 'roles combinados: modelo compartido' : model.model === (row.executorModel ?? 'claude-haiku-5-5') ? 'ejecutor' : 'orquestador y revisión';
    const cost = officialCostBreakdown(model, attempt.receipt.requests, catalog);
    const old = models.get(model.model);
    if (old) {
      for (const key of counterKeys) old[key] += model[key];
      for (const key of costKeys) old.cost[key] = rangeSum([old.cost[key], cost?.[key]]);
    } else models.set(model.model, { model: model.model, role, ...Object.fromEntries(counterKeys.map(key => [key, model[key]])), cost: Object.fromEntries(costKeys.map(key => [key, cost?.[key] ?? null])) });
  }
  const grouped = [...models.values()];
  const totals = Object.fromEntries(counterKeys.map(key => [key, grouped.reduce((sum, model) => sum + model[key], 0)]));
  const costs = Object.fromEntries(costKeys.map(key => [key, rangeSum(grouped.map(model => model.cost[key]))]));
  const unchanged = [];
  for (const file of ['package.json', 'package-lock.json', 'FEATURE.txt', 'test/base.test.mjs']) {
    const digest = content => createHash('sha256').update(content).digest('hex');
    unchanged.push(digest(await readFile(join(row.cwd, file))) === digest(await readFile(join('tests/fixtures/inventory-pilot', file))));
  }
  const latestChecksPassed = latest.checks?.own.exitCode === 0 && latest.checks?.acceptance.exitCode === 0;
  const observedReads = attempts.flatMap(attempt => attempt.receipt.tools).filter(tool => tool.name === 'Read' && tool.endMs !== null);
  const complete = attempts.every(attempt => attempt.receipt.completeAccounting && attempt.receipt.terminalReceipt?.success);
  const modelIntegrity = row.arm !== 'sonnet-solo' || grouped.every(model => model.model === 'claude-sonnet-5-5');
  rows.push({ arm: row.arm, coordinatorModel: row.coordinatorModel ?? (row.arm === 'sonnet-solo' ? null : 'claude-sonnet-5-5'),
    executorModel: row.executorModel ?? (row.arm === 'sonnet-solo' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5'),
    accepted: latestChecksPassed && complete && modelIntegrity && row.delegationVerified && unchanged.every(Boolean),
    retries: attempts.length - 1, models: grouped, totals, costs,
    timings: { modelSessionsWallMs: attempts.reduce((sum, attempt) => sum + attempt.receipt.timings.wallMs, 0),
      localChecksMs: attempts.reduce((sum, attempt) => sum + (attempt.checks?.own.durationMs ?? 0) + (attempt.checks?.acceptance.durationMs ?? 0), 0),
      apiTimeProviderReportedMs: attempts.reduce((sum, attempt) => sum + (attempt.receipt.terminalReceipt?.providerApiMs ?? 0), 0),
      foregroundWorkerSpanMs: row.receipt.timings.childForegroundSpanMs,
      mainOutsideWorkerSpanMs: row.receipt.timings.mainOutsideChildSpanMs,
      shutdownMs: attempts.reduce((sum, attempt) => sum + (attempt.receipt.timings.shutdownMs ?? 0), 0),
      observedFileReadCalls: observedReads.length,
      observedFileReadSpansMs: observedReads.reduce((sum, tool) => sum + tool.endMs - tool.startMs, 0),
      permissionDenials: attempts.reduce((sum, attempt) => sum + attempt.receipt.terminalReceipt.permissionDenials.length, 0) },
    finalChecks: latest.checks, originalAttemptChecks: row.checks });
}
const baseline = rows.find(row => row.arm === 'sonnet-solo');
const delegated = rows.find(row => row.arm !== 'sonnet-solo');
const comparable = baseline?.accepted && delegated?.accepted && report.rows[0].baseTree === report.rows[1].baseTree;
const comparisons = rows.filter(row => row.arm !== 'sonnet-solo').map(row => ({
  arm: row.arm, comparable: !!baseline?.accepted && row.accepted && report.rows.find(source => source.arm === row.arm)?.baseTree === report.rows.find(source => source.arm === baseline.arm)?.baseTree,
  extraTokensPercent: baseline?.accepted && row.accepted ? 100 * (row.totals.totalTokens / baseline.totals.totalTokens - 1) : null,
  savedReferencePercent: baseline?.accepted && row.accepted && row.costs.totalUsd && baseline.costs.totalUsd ? {
    min: 100 * (1 - row.costs.totalUsd.max / baseline.costs.totalUsd.min),
    max: 100 * (1 - row.costs.totalUsd.min / baseline.costs.totalUsd.max)
  } : null
}));
const summary = { sourceReport: path, at: new Date().toISOString(), sourcePrice: 'https://platform.claude.com/docs/es/about-claude/pricing',
  task: { id: 'P01', title: 'Desarrollar reservas HTTP idempotentes con persistencia SQLite',
    level: 'medio', levelSource: 'Clasificación manual del piloto por validación, transacciones, concurrencia y persistencia; no dificultad universal del modelo',
    activities: ['Implementar transacción y persistencia de reservas', 'Implementar HTTP y validación', 'Añadir pruebas propias', 'Revisar cambios'],
    externalAcceptance: ['Reserva y repetición sin doble descuento', 'Conflicto al reutilizar clave con otros datos', 'Validación sin mutación', 'Producto inexistente y stock insuficiente sin consumir clave', 'Peticiones simultáneas', 'Persistencia tras cerrar y reabrir SQLite'] },
  countsSource: 'Native result.modelUsage, whole tree by model. Session result.usage is NOT added. Independent repair sessions ARE added.',
  sameAcceptanceHash: report.acceptanceHash, comparable, repetitions: report.repetitions, fixedOrder: report.fixedOrder, cacheOrderConfound: report.cacheOrderConfound,
  warning: 'Controlled strategy trial, not proof of automatic optimal routing or general savings. Development chat and diagnostics outside these arms are excluded.',
  rows, comparisons, comparison: comparable ? {
    extraTokensPercent: 100 * (delegated.totals.totalTokens / baseline.totals.totalTokens - 1),
    savedReferenceUsd: { min: baseline.costs.totalUsd.min - delegated.costs.totalUsd.max, max: baseline.costs.totalUsd.max - delegated.costs.totalUsd.min },
    savedReferencePercent: { min: 100 * (1 - delegated.costs.totalUsd.max / baseline.costs.totalUsd.min), max: 100 * (1 - delegated.costs.totalUsd.min / baseline.costs.totalUsd.max) }
  } : null,
  totalThisComparison: { tokens: rows.reduce((sum, row) => sum + row.totals.totalTokens, 0), officialReferenceUsd: rangeSum(rows.map(row => row.costs.totalUsd)) } };
const target = join(dirname(path), 'summary.json');
await writeFile(target, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ target, ...summary }, null, 2));
