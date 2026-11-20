import {readFile, writeFile, mkdir, realpath} from 'node:fs/promises';
import {resolve, dirname, join, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {EvidenceStore} from '@vpr/storage-sqlite';
import {migrateLegacyReport} from './legacy-import.js';
import {priceEvidenceCalls} from './call-pricing.js';
import {analyzeEvidence} from './evidence-analysis.js';
import {renderEvidenceReport} from './evidence-report.js';
import {renderScenarioDetails} from './scenario-detail.js';
import {proposeCampaign} from './campaign-plan.js';

async function canonicalTarget(path: string): Promise<string> {
  let cursor = resolve(path); const missing: string[] = [];
  for (;;) {
    try {return resolve(await realpath(cursor), ...missing.reverse());}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (dirname(cursor) === cursor) throw error;
      missing.push(basename(cursor)); cursor = dirname(cursor);
    }
  }
}
export async function writeExperimentReport(options: {
  readonly source: string; readonly output: string;
  readonly claudeCatalog: string; readonly openaiCatalog: string;
  readonly asOf: string; readonly seed?: number;
}) {
  const source = await realpath(options.source), output = await canonicalTarget(options.output);
  const normalized = output.replaceAll('\\', '/').toLowerCase();
  if (output === dirname(source) || normalized.includes('/.vpr/benchmarks/')) throw new Error('Report output must be new and outside frozen benchmarks');
  const raw = await readFile(source);
  if (raw.byteLength > 64 * 1024 * 1024) throw new Error('Report source exceeds 64 MiB');
  const sourceHash = createHash('sha256').update(raw).digest('hex');
  const report: unknown = JSON.parse(raw.toString('utf8'));
  const claude = JSON.parse(await readFile(options.claudeCatalog, 'utf8')) as Parameters<typeof proposeCampaign>[0]['claude'];
  const openai = JSON.parse(await readFile(options.openaiCatalog, 'utf8')) as Parameters<typeof proposeCampaign>[0]['openai'];
  const records = priceEvidenceCalls(migrateLegacyReport(report, {path: source, sha256: sourceHash}), claude, options.asOf);
  const analysis = analyzeEvidence(records);
  const taskIds = [...new Set(records.filter(r => /^T|^W|^P/u.test(r.taskId)).map(r => r.taskId))];
  const campaign = proposeCampaign({claude, openai, asOf: options.asOf, seed: options.seed ?? 20261119,
    repetitions: 3, legacyTaskIds: taskIds});
  // Refuse an existing output. No historical report or receipt is replaced.
  await mkdir(dirname(output), {recursive: true}); await mkdir(output);
  const store = new EvidenceStore(join(output, 'evidence.sqlite')); await store.initialize();
  try {store.import(records);} finally {store.close();}
  const json = (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  await json('analysis.json', analysis); await json('campaign.json', campaign); await json('evidence.json', records);
  await json('price-catalogs.json', {claude, openai, basis: 'Dated API reference, not subscription charges'});
  await json('manifest.json', {source, sourceHash, asOf: options.asOf, evidenceRecords: records.length,
    decisionInferenceTokens: 0, sourceModified: false, paidExecutionsPerformed: false});
  await writeFile(join(output, 'informe.html'), renderEvidenceReport(analysis), {flag: 'wx'});
  await mkdir(join(output, 'detail'));
  await writeFile(join(output, 'detail/informe.html'), renderScenarioDetails(report), {flag: 'wx'});
  const currentHash = createHash('sha256').update(await readFile(source)).digest('hex');
  if (currentHash !== sourceHash) throw new Error('Source changed concurrently; generated report must not be used');
  return {output, sourceHash, runs: analysis.runs, calls: analysis.calls,
    recommendations: analysis.decisions.filter(d => d.recommendation).length,
    campaignCells: campaign.blocks.reduce((sum, b) => sum + b.cells.length, 0),
    estimatedCampaignMaxUsd: campaign.totalMaxUsd, inferenceTokens: 0};
}
