import {inferOperation} from '@vpr/observability';
export {inferOperation} from '@vpr/observability';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateEvidence, type EvidenceRecord, type EvidenceOperation, type WorkFeatures } from '@vpr/contracts';
import type { EvidenceStore } from '@vpr/storage-sqlite';

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const hash = (value: unknown): string | null => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
const level = (value: unknown): WorkFeatures['designComplexity'] =>
  value === 'simple' || value === 'normal' || value === 'complex' ? value : null;

function features(task: Json): WorkFeatures {
  const supplied = obj(task.features);
  return {
    kind: text(task.kind) ?? 'unknown', role: text(task.executionRole) ?? 'unknown',
    designComplexity: level(supplied.designComplexity), executionComplexity: level(supplied.executionComplexity),
    risk: supplied.risk === 'low' || supplied.risk === 'medium' || supplied.risk === 'high' ? supplied.risk : null,
    files: null, modules: null, publicApi: bool(supplied.publicApi), persistence: bool(supplied.persistence),
    transactions: bool(supplied.transactions), security: bool(supplied.security), money: bool(supplied.money),
    invariants: number(supplied.invariants), existingTests: number(supplied.existingTests),
    expectedDiffLines: number(supplied.expectedDiffLines), dependencies: null,
  };
}
function emptyRecord(source: EvidenceRecord['source'], row: Json, task: Json, runId: string): EvidenceRecord {
  return {
    schemaVersion: 1, id: runId, granularity: 'run', runId, storyId: null, callId: null,
    taskId: text(row.taskId) ?? 'unknown', protocol: text(row.protocol), acceptanceContractHash: hash(row.acceptanceHash),
    recipe: text(row.arm) ?? 'unknown', phase: null, operation: 'desconocida',
    model: null, provider: null, modelIdentity: 'unknown', features: features(task),
    tokens: {input: null, output: null, cacheRead: null, cacheWrite: null, cacheWrite5m: null,
      cacheWrite1h: null, contextMax: null},
    cost: {inputUsd: null, outputUsd: null, cacheReadUsd: null, cacheWriteUsd: null,
      totalMinUsd: null, totalMaxUsd: null, complete: null},
    accepted: null, engineeringQuality: null, checks: {external: null, regression: null, build: null},
    review: {fresh: null, citationsVerified: null, critical: null, high: null, medium: null, low: null},
    wallMs: null, checksMs: null, calls: null, turns: null, tools: null,
    files: {readCount: null, readBytes: null, readTokens: null, writtenCount: null, writtenBytes: null},
    cacheCondition: 'unknown', promptPrefixHash: null, handoffHash: null, failureReason: null,
    triageEscalated: null, escalationRequired: null, shadowRecipe: null, source, unavailable: {},
  };
}
function withMissingReasons(record: EvidenceRecord, special: Record<string, string> = {}): EvidenceRecord {
  const unavailable: Record<string, string> = {...record.unavailable};
  function walk(value: unknown, path: string) {
    if (value === null) unavailable[path] = special[path] ?? 'Legacy receipt does not establish this measurement';
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, item] of Object.entries(value)) if (key !== 'unavailable') walk(item, path ? path + '.' + key : key);
    }
  }
  walk(record, '');
  const result = {...record, unavailable};
  const validation = validateEvidence(result);
  if (!validation.valid) throw new TypeError('Invalid legacy evidence: ' + validation.errors.join('; '));
  return result;
}
function runRecord(base: EvidenceRecord, row: Json): EvidenceRecord {
  const receipt = obj(row.receipt), totals = obj(receipt.totals), cost = obj(row.totalCost);
  const codex = list(row.models).some(model => obj(model).provider === 'codex');
  const external = obj(obj(row.checks).external);
  return withMissingReasons({...base,
    tokens: {...base.tokens, input: number(totals.inputTokens), output: number(totals.outputTokens),
      cacheRead: number(totals.cacheReadTokens), cacheWrite: codex ? null : number(totals.cacheWriteTokens)},
    cost: {...base.cost, totalMinUsd: number(cost.min), totalMaxUsd: number(cost.max),
      complete: bool(row.completeModelAccounting ?? receipt.completeAccounting)},
    accepted: text(row.status) === 'accepted' ? true : row.status ? false : null,
    checks: {...base.checks, external: typeof external.exitCode === 'number' ? external.exitCode === 0 : null},
    wallMs: number(obj(receipt.timings).wallMs),
    checksMs: number(row.localChecksTotalMs),
  }, codex ? {'tokens.cacheWrite': 'Codex legacy aggregate has an implicit zero without a cache-write receipt'} : {});
}
function callRecord(base: EvidenceRecord, request: Json, index: number): EvidenceRecord {
  const input = number(request.inputTokens), read = number(request.cacheReadTokens), write = number(request.cacheWriteTokens);
  const context = input !== null && read !== null && write !== null ? input + read + write : null;
  const phase = text(request.phase);
  return withMissingReasons({...base, id: base.runId + ':call:' + index, granularity: 'call',
    callId: text(request.id) ?? String(index), model: text(request.model),
    source: {...base.source, pointer: base.source.pointer + '/receipt/requests/' + index},
    phase, operation: inferOperation(phase ? {phase} : {}),
    tokens: {input, output: number(request.outputTokens), cacheRead: read, cacheWrite: write,
      cacheWrite5m: number(request.cacheWrite5mTokens), cacheWrite1h: number(request.cacheWrite1hTokens), contextMax: context},
    calls: 1,
  });
}
/** Pure, non-mutating migration. Never infers calls or manual complexity from an aggregate. */
export function migrateLegacyReport(value: unknown, source: {readonly path: string; readonly sha256: string}): EvidenceRecord[] {
  const report = obj(value), tasks = list(report.tasks).map(obj);
  return list(report.rows).flatMap((item, index) => {
    const row = obj(item), task = tasks.find(task => task.id === row.taskId) ?? {};
    const runId = createHash('sha256').update(source.sha256 + ':' + index).digest('hex');
    const base = emptyRecord({...source, pointer: '/rows/' + index}, row, task, runId);
    return [runRecord(base, row), ...list(obj(row.receipt).requests).map((request, i) => callRecord(base, obj(request), i))];
  });
}
export async function importLegacyFile(path: string, store: EvidenceStore) {
  const raw = await readFile(path), sha256 = createHash('sha256').update(raw).digest('hex');
  const records = migrateLegacyReport(JSON.parse(raw.toString('utf8')) as unknown, {path, sha256});
  return {sha256, records: records.length, ...store.import(records)};
}
