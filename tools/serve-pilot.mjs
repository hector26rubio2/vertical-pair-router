import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const at = process.argv.indexOf('--project');
if (at < 0 || !process.argv[at + 1]) throw new Error('Use --project <inventory-pilot-project>');
const project = resolve(process.argv[at + 1]);
const { InventoryStore } = await import(pathToFileURL(join(project, 'src/store.mjs')).href);
const { createInventoryServer } = await import(pathToFileURL(join(project, 'src/server.mjs')).href);
await mkdir(join(project, '.vpr'), { recursive: true });
const store = new InventoryStore(join(project, '.vpr/inventory.sqlite'));
const server = createInventoryServer(store);
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
console.log(JSON.stringify({ project, url: `http://127.0.0.1:${server.address().port}`, stock: '/stock/apple', reservations: 'POST /reservations', stop: 'Ctrl+C' }));
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.close(() => { store.close(); });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
