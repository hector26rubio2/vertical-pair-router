import { createServer } from 'node:http';

export function createInventoryServer(store) {
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url?.startsWith('/stock/')) {
      const sku = decodeURIComponent(request.url.slice('/stock/'.length));
      const quantity = store.stock(sku);
      response.writeHead(quantity === null ? 404 : 200);
      response.end(JSON.stringify({ sku, quantity }));
      return;
    }
    response.writeHead(request.method === 'POST' && request.url === '/reservations' ? 501 : 404);
    response.end(JSON.stringify({ error: 'not-implemented' }));
  });
}
