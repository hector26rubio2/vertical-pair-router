import assert from 'node:assert/strict';
import test from 'node:test';
import { auditRelease, distributable } from '../tools/release-audit.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('release inventory excludes local data and identifies installed dependencies', async () => {
  for (const path of ['.vpr/profile.json', '.env', '.env.production', 'x/events.sqlite-wal', 'x/private.key', 'evals/results/output.json']) {
    assert.equal(distributable(path), false, path);
  }
  assert.equal(distributable('examples/profiles/company-project.json'), true);
  const report = await auditRelease(process.cwd());
  assert.match(report.lockfileSha256, /^[a-f0-9]{64}$/u);
  for (const name of ['@types/node', 'husky', 'typescript', 'undici-types', 'esbuild']) assert.ok(report.sbom.components.some(item => item.name === name));
  assert.ok(report.files.every(item => distributable(item.path)));
});

test('release license gate remains closed until the approved license is included in tracked source',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-license-gate-'));context.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'node_modules','.pnpm'),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({name:'license-gate',version:'0.1.0'}));await writeFile(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9\n');
  const git=args=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
  git(['init']);git(['add','package.json','pnpm-lock.yaml']);git(['-c','user.name=VPR Fixture','-c','user.email=vpr@example.invalid','-c','core.hooksPath=.no-hooks','commit','-m','Fixture']);
  assert.deepEqual((await auditRelease(root)).releaseBlockers,['LICENSE_MISSING']);
  await writeFile(join(root,'LICENSE'),'MIT License\nCopyright (c) 2026 Vertical Pair Router contributors\n');
  assert.deepEqual((await auditRelease(root)).releaseBlockers,['LICENSE_MISSING']);
  git(['add','LICENSE']);assert.deepEqual((await auditRelease(root)).releaseBlockers,[]);
});
