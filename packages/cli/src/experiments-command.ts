import {access, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeExperimentReport} from '@vpr/experiments';
import {validateHandoff} from '@vpr/contracts';
import type {CliIo} from './cli.js';

async function catalog(packaged: string, source: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const path of [resolve(here, '../data', packaged), resolve(here, '../../../docs/research', source)]) {
    try {await access(path); return path;} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  }
  throw new Error('Reference price catalog not installed');
}
export async function runExperimentsCommand(args: readonly string[], io: CliIo): Promise<number> {
  const flag = (name: string) => {const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined;};
  if (args[0] === 'validate-handoff' && flag('--file')) {
    const value: unknown = JSON.parse(await readFile(resolve(flag('--file')!), 'utf8'));
    const result = validateHandoff(value); io.stdout(JSON.stringify({...result, inferenceTokens: 0}) + '\n');
    return result.valid ? 0 : 1;
  }
  if (args[0] === 'report' && flag('--source') && flag('--output')) {
    const result = await writeExperimentReport({source: resolve(flag('--source')!), output: resolve(flag('--output')!),
      claudeCatalog: flag('--claude-prices') ?? await catalog('model-prices.json', 'model-price-catalog.json'),
      openaiCatalog: flag('--openai-prices') ?? await catalog('openai-model-prices.json', 'openai-model-price-catalog.json'),
      asOf: flag('--as-of') ?? new Date().toISOString().slice(0, 10), seed: Number(flag('--seed') ?? 20261119)});
    io.stdout(JSON.stringify(result) + '\n'); return 0;
  }
  io.stderr('Usage: vpr experiments report --source <data.json> --output <new-directory> | validate-handoff --file <json>. Native runs require explicit owner approval.\n');
  return 2;
}
