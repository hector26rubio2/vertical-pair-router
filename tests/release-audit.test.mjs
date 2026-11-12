import assert from 'node:assert/strict';
import test from 'node:test';
import { auditRelease, distributable } from '../tools/release-audit.mjs';

test('release inventory excludes local data and identifies installed dependencies', async () => {
  for (const path of ['.vpr/profile.json', '.env', '.env.production', 'x/events.sqlite-wal', 'x/private.key', 'evals/results/output.json']) {
    assert.equal(distributable(path), false, path);
  }
  assert.equal(distributable('examples/profiles/company-project.json'), true);
  const report = await auditRelease(process.cwd());
  assert.match(report.lockfileSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(report.sbom.components.map(item => item.name).sort(), ['@types/node', 'typescript', 'undici-types']);
  assert.ok(report.files.every(item => distributable(item.path)));
  assert.ok(report.releaseBlockers.includes('LICENSE_MISSING'));
});
