import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { estimateApiReferenceCost } from '@vpr/observability';
const args = process.argv.slice(2);
const at = args.indexOf('--report');
if (at < 0 || !args[at + 1]) throw new Error('--report requires measured model-cases JSON');
const reportPath = resolve(args[at + 1]);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const prices = JSON.parse(await readFile('docs/research/model-price-catalog.json', 'utf8'));
const rows = report.rows.map(row => ({ taskId: row.taskId, model: row.observedModels?.[0] ?? null,
  effort: row.requestedEffort, checksPassed: row.checksPassed, totalTokens: row.totalTokens,
  cost: estimateApiReferenceCost({ ...row, observedModel: row.observedModels?.[0],
    modelConfirmed: row.modelVerification === 'confirmed' && row.observedModels.length === 1,
    now: new Date().toISOString() }, prices) }));
const comparison = { sourceReport: reportPath, basis: prices.basis, inferenceUsedForCalculation: false, rows };
const output = join(dirname(reportPath), 'model-cost-reference-' + Date.now() + '.json');
await writeFile(output, JSON.stringify(comparison, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: output, ...comparison }, null, 2));
