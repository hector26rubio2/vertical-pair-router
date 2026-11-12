import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const output = resolve('dist', 'npm');
await mkdir(join(output, 'bin'), { recursive: true });
await build({ entryPoints: ['packages/cli/src/bin.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: join(output, 'bin', 'vpr.mjs'), external: ['node:*'] });
for (const directory of ['.claude-plugin', 'hooks', 'skills']) {
  await cp(resolve(directory), join(output, 'plugin', directory), { recursive: true });
}
for (const file of ['README.md', 'THIRD-PARTY-NOTICES.md']) await cp(resolve(file), join(output, file));
await mkdir(join(output, '.claude-plugin'), { recursive: true });
await writeFile(join(output, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'vpr-local', description: 'Registro local de Vertical Pair Router distribuido desde GitHub', owner: { name: 'Vertical Pair Router contributors' }, plugins: [{ name: 'vertical-pair-router', source: './plugin', description: 'Flujos locales con evidencias y límites' }] }, null, 2) + '\n');
const source = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(join(output, 'package.json'), JSON.stringify({ name: source.name, version: source.version, type: 'module', description: 'Vertical Pair Router: CLI y plugin local de Claude Code', bin: { vpr: './bin/vpr.mjs' }, engines: { node: '>=24.15 <27' }, files: ['bin', 'plugin', '.claude-plugin', 'README.md', 'THIRD-PARTY-NOTICES.md'] }, null, 2) + '\n');
console.log('Paquete local preparado en ' + output);
