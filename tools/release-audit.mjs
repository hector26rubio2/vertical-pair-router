import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function distributable(path) {
  return !/(^|\/)(node_modules|dist|\.git|\.vpr|coverage|results)(\/|$)|(^|\/)\.env(?:\.|$)|\.(sqlite(?:-wal|-shm)?|log|bak|tmp|pem|key)$/iu.test(path);
}

export async function auditRelease(root) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const files = [];
  for (const path of tracked.filter(distributable)) {
    const bytes = await readFile(join(root, path));
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const components = [];
  const store = join(root, 'node_modules', '.pnpm');
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const modules = join(store, entry.name, 'node_modules');
    for (const child of await readdir(modules, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const candidates = child.name.startsWith('@')
        ? (await readdir(join(modules, child.name))).map(name => join(child.name, name))
        : [child.name];
      for (const candidate of candidates) {
        const metadata = JSON.parse(await readFile(join(modules, candidate, 'package.json'), 'utf8'));
        components.push({ type: 'library', name: metadata.name, version: metadata.version,
          'bom-ref': `pkg:npm/${metadata.name}@${metadata.version}`,
          licenses: metadata.license ? [{ license: { id: metadata.license } }] : [], scope: 'optional' });
      }
    }
  }
  const unique = [...new Map(components.map(item => [item['bom-ref'], item])).values()].sort((a,b) => a.name.localeCompare(b.name));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = await readFile(join(root, 'pnpm-lock.yaml'));
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    lockfileSha256: createHash('sha256').update(lock).digest('hex'),
    files, excluded: tracked.filter(path => !distributable(path)),
    releaseBlockers: files.some(file => file.path === 'LICENSE') ? [] : ['LICENSE_MISSING'],
    sbom: { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
      metadata: { component: { type: 'application', name: pkg.name, version: pkg.version } }, components: unique }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = await auditRelease(root);
  const out = process.argv.indexOf('--out');
  if (out >= 0) {
    if (!process.argv[out + 1]) throw new Error('--out requires a new file path');
    const target = resolve(process.argv[out + 1]);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  } else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (process.argv.includes('--release') && report.releaseBlockers.length) process.exitCode = 1;
}
