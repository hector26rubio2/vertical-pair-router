import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {inspectImportBoundaries} from './lib/import-boundaries.mts';
const staged = process.argv.includes('--staged');
const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
const paths = [...new Set(execFileSync('git', args, {encoding: 'utf8', windowsHide: true}).split('\0'))]
  .filter(path => /^(tools|packages)\//u.test(path) && /\.(?:[cm]?[jt]sx?)$/u.test(path)
    && !/(?:^|\/)(?:dist|node_modules|generated)\//u.test(path));
const findings = [];
for (const path of paths) {
  const source = staged ? execFileSync('git', ['show', ':' + path], {encoding: 'utf8', windowsHide: true}) : await readFile(path, 'utf8');
  findings.push(...inspectImportBoundaries(path, source));
}
console.log(JSON.stringify({passed: findings.length === 0, findings}, null, 2));
process.exitCode = findings.length ? 1 : 0;
