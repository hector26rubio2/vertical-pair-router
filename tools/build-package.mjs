import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {runtimeSbom} from './runtime-sbom.mjs';
await import('./copy-runtime-assets.mjs');

const output = resolve('dist', 'npm');
await mkdir(join(output, 'bin'), { recursive: true });
await build({ entryPoints: ['packages/cli/src/bin.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: join(output, 'bin', 'vpr.mjs'), external: ['node:*','@microsoft/copilot-sdk'] });
for (const directory of ['.claude-plugin', 'hooks', 'skills']) {
  await cp(resolve(directory), join(output, 'plugin', directory), { recursive: true });
}
for (const file of ['README.md', 'THIRD-PARTY-NOTICES.md','CHANGELOG.md']) await cp(resolve(file), join(output, file));
await cp(resolve('LICENSE'),join(output,'LICENSE'));
await mkdir(join(output,'plugin/hooks/lib'),{recursive:true});
await cp(resolve('packages/runtime/src/usage-ledger.mjs'),join(output,'plugin/hooks/lib/usage-ledger.mjs'));
await cp(resolve('packages/quality/src/staged-security.mjs'),join(output,'plugin/hooks/lib/staged-security.mjs'));
await mkdir(join(output, 'data'), { recursive: true });
await cp(resolve('docs/research/model-capability-catalog.json'), join(output, 'data/model-capabilities.json'));
await cp(resolve('docs/research/model-price-catalog.json'), join(output, 'data/model-prices.json'));
await cp(resolve('docs/research/copilot-model-price-catalog.json'), join(output, 'data/copilot-model-prices.json'));
await cp(resolve('docs/research/openai-model-price-catalog.json'), join(output, 'data/openai-model-prices.json'));
await cp(resolve('docs/research/subscription-catalog.json'), join(output, 'data/subscriptions.json'));
await mkdir(join(output, '.claude-plugin'), { recursive: true });
await writeFile(join(output, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'vpr-local', description: 'Registro local de Vertical Pair Router distribuido desde GitHub', owner: { name: 'Vertical Pair Router contributors' }, plugins: [{ name: 'vertical-pair-router', source: './plugin', description: 'Flujos locales con evidencias y límites' }] }, null, 2) + '\n');
const source = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(join(output,'SBOM.json'),JSON.stringify(await runtimeSbom(source),null,2)+'\n');
await mkdir(join(output,'examples'),{recursive:true});
await cp(resolve('examples/pilot-project'),join(output,'examples/pilot-project'),{recursive:true});
await writeFile(join(output, 'package.json'), JSON.stringify({ name: source.name, version: source.version, license:source.license, type: 'module', description: 'Vertical Pair Router: CLI y plugin local de Claude Code', bin: { vpr: './bin/vpr.mjs' }, engines: { node: '>=24.15 <27' }, dependencies:{'@microsoft/copilot-sdk':'2.0.1'}, files: ['bin', 'plugin', 'data', 'examples', '.claude-plugin', 'README.md', 'THIRD-PARTY-NOTICES.md','LICENSE','SBOM.json','CHANGELOG.md'] }, null, 2) + '\n');
// Claude may copy only this directory into its versioned plugin cache.
// Keep the runner, catalogs and exact runtime dependencies inside that boundary.
await mkdir(join(output,'plugin/bin'),{recursive:true});
await cp(join(output,'bin/vpr.mjs'),join(output,'plugin/bin/vpr.mjs'));
for(const directory of ['data','examples'])await cp(join(output,directory),join(output,'plugin',directory),{recursive:true});
for(const file of ['README.md','LICENSE','THIRD-PARTY-NOTICES.md','SBOM.json'])await cp(join(output,file),join(output,'plugin',file));
await cp(resolve('tools/plugin-runtime/package.json'),join(output,'plugin/package.json'));
await cp(resolve('tools/plugin-runtime/npm-shrinkwrap.json'),join(output,'plugin/npm-shrinkwrap.json'));
console.log('Paquete local preparado en ' + output);
