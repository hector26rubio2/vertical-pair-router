import { DatabaseSync } from 'node:sqlite';

export class InventoryStore {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS stock(sku TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK(quantity >= 0)) STRICT;');
    this.db.prepare('INSERT INTO stock(sku,quantity) VALUES (?,?) ON CONFLICT(sku) DO NOTHING').run('apple', 10);
  }
  stock(sku) {
    return this.db.prepare('SELECT quantity FROM stock WHERE sku=?').get(sku)?.quantity ?? null;
  }
  close() { this.db.close(); }
}
