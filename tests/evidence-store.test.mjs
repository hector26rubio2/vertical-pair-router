import test from 'node:test';
import assert from 'node:assert/strict';
import {EvidenceStore} from '@vpr/storage-sqlite';
import {validateEvidence} from '@vpr/contracts';

import {fixture} from './fixtures/evidence.mjs';

test('evidence is immutable, validated, idempotent and round-trips null provenance', async () => {
  const store = new EvidenceStore(':memory:'); await store.initialize();
  try {
    const row = fixture(); assert.equal(validateEvidence(row).valid, true);
    assert.equal(store.insert(row), true); assert.equal(store.insert(row), false);
    assert.throws(() => store.insert({...row, wallMs: 2000}), /immutable/);
    assert.throws(() => store.insert({...row, tokens: {...row.tokens, input: -1}}), /Invalid evidence/);
    assert.deepEqual(store.all(), [row]);
  } finally {store.close();}
});
test('similarity can join different tasks but never protocols, contracts, roles or unknown safety signals', async () => {
  const store = new EvidenceStore(':memory:'); await store.initialize();
  try {
    const row = fixture();
    store.insert(row); store.insert({...row, id: 'other-task', taskId: 'task-2'});
    store.insert({...row, id: 'other-protocol', protocol: 'old'});
    store.insert({...row, id: 'other-contract', acceptanceContractHash: 'c'.repeat(64)});
    store.insert({...row, id: 'other-role', features: {...row.features, role: 'review'}});
    assert.deepEqual(store.similar(row).map(r => r.id), ['call-1', 'other-task']);
    assert.equal(store.similar({...row, protocol: null}).length, 0);
    assert.equal(store.similar({...row, features: {...row.features, security: null}}).length, 0);
  } finally {store.close();}
});
test('batch import rolls back every inserted receipt when one is invalid', async () => {
  const store = new EvidenceStore(':memory:'); await store.initialize();
  try {
    store.insert(fixture());
    assert.throws(() => store.import([fixture('good'), {...fixture('bad'), wallMs: -1}]), /Invalid evidence/);
    assert.deepEqual(store.all().map(row => row.id), ['call-1']);
  } finally {store.close();}
});
