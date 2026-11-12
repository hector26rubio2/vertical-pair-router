import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = process.env.VPR_PILOT_PROJECT;
if (!root) throw new Error('VPR_PILOT_PROJECT required');
const { InventoryStore } = await import(pathToFileURL(join(root, 'src/store.mjs')).href);
const { createInventoryServer } = await import(pathToFileURL(join(root, 'src/server.mjs')).href);
async function setup(context, path) {
  const store = new InventoryStore(path);
  const server = createInventoryServer(store);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise(done => server.close(done));
    store.close();
  };
  context.after(close);
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { store, close, reserve: (key, body) => fetch(origin + '/reservations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { 'Idempotency-Key': key }) },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }) };
}
test('first reserve and idempotent replay decrement once', async context => {
  const { store, reserve } = await setup(context);
  const first = await reserve('one', { sku: 'apple', quantity: 3 });
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { sku: 'apple', quantity: 3, key: 'one', replayed: false });
  const again = await reserve('one', { sku: 'apple', quantity: 3 });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { sku: 'apple', quantity: 3, key: 'one', replayed: true });
  assert.equal(store.stock('apple'), 7);
});
test('a key cannot be reused for a different payload', async context => {
  const { store, reserve } = await setup(context);
  assert.equal((await reserve('one', { sku: 'apple', quantity: 2 })).status, 201);
  assert.equal((await reserve('one', { sku: 'apple', quantity: 3 })).status, 409);
  assert.equal(store.stock('apple'), 8);
});
test('invalid requests do not mutate stock', async context => {
  const { store, reserve } = await setup(context);
  for (const quantity of [0, -1, 1.5, '3', 9007199254740992]) assert.equal((await reserve('invalid', { sku: 'apple', quantity })).status, 400);
  assert.equal((await reserve(undefined, { sku: 'apple', quantity: 1 })).status, 400);
  assert.equal((await reserve('x'.repeat(129), { sku: 'apple', quantity: 1 })).status, 400);
  assert.equal((await reserve('bad-json', '{')).status, 400);
  assert.equal(store.stock('apple'), 10);
});
test('unknown stock and insufficient stock preserve data and key', async context => {
  const { store, reserve } = await setup(context);
  assert.equal((await reserve('retry', { sku: 'missing', quantity: 1 })).status, 404);
  assert.equal((await reserve('retry', { sku: 'apple', quantity: 11 })).status, 409);
  assert.equal(store.stock('apple'), 10);
  assert.equal((await reserve('retry', { sku: 'apple', quantity: 10 })).status, 201);
  assert.equal(store.stock('apple'), 0);
});
test('simultaneous identical requests decrement once', async context => {
  const { store, reserve } = await setup(context);
  const responses = await Promise.all([reserve('parallel', { sku: 'apple', quantity: 4 }), reserve('parallel', { sku: 'apple', quantity: 4 })]);
  assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]);
  assert.equal(store.stock('apple'), 6);
});
test('reservation and stock survive SQLite reopen', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'vpr-pilot-db-'));
  const path = join(directory, 'inventory.sqlite');
  let first, second;
  try {
    first = await setup(context, path);
    assert.equal((await first.reserve('durable', { sku: 'apple', quantity: 2 })).status, 201);
    await first.close();
    second = await setup(context, path);
    assert.equal((await second.reserve('durable', { sku: 'apple', quantity: 2 })).status, 200);
    assert.equal(second.store.stock('apple'), 8);
  } finally {
    await first?.close();
    await second?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
