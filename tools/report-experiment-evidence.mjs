import {writeExperimentReport} from '@vpr/experiments';
const option = name => {const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined;};
const source = option('--source'), output = option('--output');
if (!source || !output) throw new Error('--source <data.json> --output <new-directory> required');
console.log(JSON.stringify(await writeExperimentReport({source, output,
  claudeCatalog: option('--claude-prices') ?? 'docs/research/model-price-catalog.json',
  openaiCatalog: option('--openai-prices') ?? 'docs/research/openai-model-price-catalog.json',
  asOf: option('--as-of') ?? '2026-11-19', seed: Number(option('--seed') ?? 20261119)})));
