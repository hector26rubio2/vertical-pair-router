import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateEvidence, type EvidenceRecord } from '@vpr/contracts';

export interface EvidenceCohort {
  readonly protocol: string | null;
  readonly acceptanceContractHash: string | null;
  readonly features: EvidenceRecord['features'];
}
const featureKeys = ['kind', 'role', 'designComplexity', 'executionComplexity', 'risk',
  'publicApi', 'persistence', 'transactions', 'security', 'money'] as const;

/** Similarity never relaxes the acceptance contract, protocol, risk or safety signals. */
export function isComparableEvidence(left: EvidenceCohort, right: EvidenceCohort): boolean {
  if (!left.protocol || !left.acceptanceContractHash) return false;
  if (left.protocol !== right.protocol || left.acceptanceContractHash !== right.acceptanceContractHash) return false;
  return featureKeys.every(key => left.features[key] !== null && left.features[key] === right.features[key]);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Append-only evidence. This uses its own versioned tables, without altering raw receipt files. */
export class EvidenceStore {
  readonly #path: string;
  #database: DatabaseSync | undefined;
  constructor(path: string) {this.#path = path;}
  async initialize(): Promise<void> {
    if (this.#database) return;
    if (this.#path !== ':memory:') await mkdir(dirname(this.#path), {recursive: true});
    const database = new DatabaseSync(this.#path);
    try {
      database.exec(`CREATE TABLE IF NOT EXISTS vpr_evidence_metadata (
        key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;`);
      const version = database.prepare("SELECT value FROM vpr_evidence_metadata WHERE key = 'schema_version'")
        .get() as {value: string} | undefined;
      if (version && version.value !== '1') throw new Error('Unsupported evidence schema version');
      database.exec(`
        INSERT OR IGNORE INTO vpr_evidence_metadata VALUES ('schema_version', '1');
        CREATE TABLE IF NOT EXISTS vpr_evidence (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, protocol TEXT,
          acceptance_hash TEXT, content_json TEXT NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS vpr_evidence_cohort ON vpr_evidence(protocol, acceptance_hash);
        CREATE INDEX IF NOT EXISTS vpr_evidence_run ON vpr_evidence(run_id);
      `);
      this.#database = database;
    } catch (error) {database.close(); throw error;}
  }
  #db(): DatabaseSync {
    if (!this.#database) throw new Error('EvidenceStore must be initialized');
    return this.#database;
  }
  insert(record: EvidenceRecord): boolean {
    const validation = validateEvidence(record);
    if (!validation.valid) throw new TypeError('Invalid evidence: ' + validation.errors.join('; '));
    const content = stable(record);
    const existing = this.#db().prepare('SELECT content_json FROM vpr_evidence WHERE id = ?')
      .get(record.id) as {content_json: string} | undefined;
    if (existing) {
      if (existing.content_json !== content) throw new Error('Evidence IDs are immutable: ' + record.id);
      return false;
    }
    this.#db().prepare('INSERT INTO vpr_evidence VALUES (?, ?, ?, ?, ?)')
      .run(record.id, record.runId, record.protocol, record.acceptanceContractHash, content);
    return true;
  }
  import(records: readonly EvidenceRecord[]): {inserted: number; unchanged: number} {
    let inserted = 0, unchanged = 0;
    this.#db().exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) this.insert(record) ? inserted++ : unchanged++;
      this.#db().exec('COMMIT');
    } catch (error) {this.#db().exec('ROLLBACK'); throw error;}
    return {inserted, unchanged};
  }
  all(): EvidenceRecord[] {
    return this.#rows(this.#db().prepare('SELECT content_json FROM vpr_evidence ORDER BY id').all());
  }
  similar(cohort: EvidenceCohort): EvidenceRecord[] {
    if (!cohort.protocol || !cohort.acceptanceContractHash) return [];
    return this.#rows(this.#db().prepare(
      'SELECT content_json FROM vpr_evidence WHERE protocol = ? AND acceptance_hash = ? ORDER BY id',
    ).all(cohort.protocol, cohort.acceptanceContractHash)).filter(row => isComparableEvidence(cohort, row));
  }
  #rows(rows: unknown[]): EvidenceRecord[] {
    return rows.map(row => {
      const value: unknown = JSON.parse((row as {content_json: string}).content_json);
      const validation = validateEvidence(value);
      if (!validation.valid || !validation.value) throw new Error('Corrupt evidence row');
      return validation.value;
    });
  }
  close(): void {this.#database?.close(); this.#database = undefined;}
}
