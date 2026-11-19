import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('runtime and security copies have the same hash as their single source after build', async () => {
  for (const [source, copies] of [
    ['packages/observability/src/native-session-meter.mjs', ['packages/observability/dist/native-session-meter.mjs']],
    ['packages/runtime/src/usage-ledger.mjs', ['packages/runtime/dist/usage-ledger.mjs', 'hooks/lib/usage-ledger.mjs']],
    ['packages/quality/src/staged-security.mjs', ['packages/quality/dist/staged-security.mjs', 'hooks/lib/staged-security.mjs']],
  ]) {
    const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
    const expected = await hash(source);
    for (const copy of copies) assert.equal(await hash(copy), expected, copy);
  }
});
