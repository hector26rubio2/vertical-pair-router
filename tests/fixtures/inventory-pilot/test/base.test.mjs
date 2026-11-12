import assert from 'node:assert/strict';
import test from 'node:test';
import { InventoryStore } from '../src/store.mjs';
import { createInventoryServer } from '../src/server.mjs';

test('existing stock endpoint is preserved', async context => {
  const store = new InventoryStore();
  const server = createInventoryServer(store);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  context.after(async () => { await new Promise(done => server.close(done)); store.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/stock/apple`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sku: 'apple', quantity: 10 });
});
