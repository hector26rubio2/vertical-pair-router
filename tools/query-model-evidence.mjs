import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { retrieveCapabilities } from '@vpr/knowledge';
const args = process.argv.slice(2);
const at = args.indexOf('--query');
if (at < 0 || !args[at + 1]) throw new Error('--query requires task tags or text');
const catalog = JSON.parse(await readFile(resolve('docs/research/model-capability-catalog.json'), 'utf8'));
const directory = resolve('.vpr/benchmarks');
const observations = [];
const freshModels = new Set();
try {
  for (const file of await readdir(directory)) {
    if (!/^model-cases-\d+\.json$/u.test(file)) continue;
    const report = JSON.parse(await readFile(join(directory, file), 'utf8'));
    for (const [index, row] of report.rows.entries()) {
      if (row.modelVerification !== 'confirmed' || row.source !== 'provider_reported') continue;
      observations.push({ evidenceId: file + ':' + index, cardId: row.requestedModel,
        taskTags: [row.complexity, 'coding', row.taskId], modelConfirmed: true,
        qualityPassed: row.checksPassed, totalTokens: row.totalTokens,
        requestedEffort: row.requestedEffort });
      const age = Date.now() - Date.parse(report.at ?? '');
      if (Number.isFinite(age) && age >= 0 && age < 300000) freshModels.add(row.requestedModel);
    }
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const results = retrieveCapabilities({ queryTags: [args[at + 1]], allowedProviders: ['claude', 'codex', 'copilot'],
  verifiedCardIds: [...freshModels], cards: catalog.cards,
  observations, now: new Date().toISOString() });
console.log(JSON.stringify({ decisionInferenceTokens: 0, catalogCheckedAt: catalog.checkedAt, results }, null, 2));
