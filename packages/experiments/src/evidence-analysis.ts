import {validateEvidence, type EvidenceRecord} from '@vpr/contracts';
import {canonicalJson} from '@vpr/core';
import {analyzeFactorialEffects, analyzeExplorationPairs, type ControlledPair} from './controlled-effects.js';

const sumKnown = (values: readonly (number | null)[]) => {
  const known = values.filter((n): n is number => n !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b), i = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2 : null;
};
function groups<T>(rows: readonly T[], key: (row: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const row of rows) {const id = key(row), group = map.get(id) ?? []; group.push(row); map.set(id, group);}
  return [...map.values()];
}
function cohort(row: EvidenceRecord) {
  const f = row.features;
  return {task: row.taskId, protocol: row.protocol, contract: row.acceptanceContractHash,
    snapshot: row.snapshotHash ?? null,
    design: f.designComplexity, execution: f.executionComplexity, role: f.role, risk: f.risk,
    publicApi: f.publicApi, persistence: f.persistence, transactions: f.transactions,
    security: f.security, money: f.money, operation: row.operation, cache: row.cacheCondition};
}
function summarize(rows: readonly EvidenceRecord[]) {
  const first = rows[0]!, accepted = rows.filter(row => row.accepted === true && row.engineeringQuality === true);
  const qualityMeasured = rows.filter(row => row.engineeringQuality !== null && row.accepted !== null).length;
  const acceptance = qualityMeasured === rows.length ? accepted.length / rows.length : null;
  const costs = rows.map(row => row.cost.totalMaxUsd);
  const complete = rows.every(row => row.cost.complete === true && row.cost.totalMaxUsd !== null);
  const spent = sumKnown(costs), minSpent = sumKnown(rows.map(row => row.cost.totalMinUsd));
  const times = accepted.map(row => row.wallMs !== null && row.checksMs !== null ? row.wallMs + row.checksMs : null);
  const contextKnown = Object.values(cohort(first)).every(value => value !== null);
  const ready = rows.length >= 3 && acceptance !== null && acceptance >= .8 && complete && contextKnown
    && rows.every(row => row.modelIdentity === 'confirmed');
  return {...cohort(first), recipe: first.recipe, n: rows.length, contractAccepted: rows.filter(row => row.accepted === true).length,
    qualityAccepted: accepted.length, qualityMeasured, acceptance,
    observedCostMin: minSpent, observedCostMax: spent, completeCost: complete,
    costPerAccepted: complete && accepted.length ? spent! / accepted.length : null,
    costPerAcceptedMin: complete && accepted.length && minSpent !== null ? minSpent / accepted.length : null,
    medianAttemptCost: complete ? median(costs as number[]) : null,
    attemptCostRange: complete ? [Math.min(...costs as number[]), Math.max(...costs as number[])] : null,
    medianAcceptedWallMs: times.length && times.every(n => n !== null) ? median(times as number[]) : null,
    ready, evidenceIds: rows.map(row => row.id),
    missing: [rows.length < 3 ? `Faltan ${3 - rows.length} ejecuciones independientes` : null,
      !contextKnown ? 'Faltan etiquetas, protocolo o contrato verificables' : null,
      !complete ? 'Contabilidad incompleta' : null,
      acceptance === null ? 'Evaluación de ingeniería incompleta: aceptación N/D' : acceptance < .8 ? 'Aceptación de ingeniería inferior al 80 %' : null,
      rows.some(row => row.modelIdentity !== 'confirmed') ? 'Identidad del modelo sin confirmar' : null].filter(Boolean),
  };
}
export function analyzeEvidence(records: readonly EvidenceRecord[], controls: {
  readonly factorials?: Parameters<typeof analyzeFactorialEffects>[0]; readonly explorationPairs?: readonly ControlledPair[];
} = {}) {
  for (const row of records) if (!validateEvidence(row).valid) throw new TypeError('Invalid evidence record');
  const identities = new Map<string, EvidenceRecord>();
  for (const row of records) {
    const existing = identities.get(row.id);
    if (existing && canonicalJson(existing) !== canonicalJson(row)) throw new Error('Conflicting immutable evidence ID');
    identities.set(row.id, row);
  }
  const unique = [...identities.values()];
  const runs = unique.filter(row => row.granularity === 'run'), calls = unique.filter(row => row.granularity === 'call');
  const cells = groups(runs, row => canonicalJson({...cohort(row), recipe: row.recipe,
    unknownContractIsolation: row.protocol && row.acceptanceContractHash ? null : row.runId}))
    .map(rows => summarize([...new Map(rows.map(row => [row.runId, row])).values()]));
  // Cohorts, not outcomes, define a comparison. Different quality/cost must not split the candidates.
  const decisionGroups = new Map<string, typeof cells>();
  for (const cell of cells) {
    const {task, protocol, contract, snapshot, design, execution, role, risk, publicApi, persistence,
      transactions, security, money, operation, cache} = cell;
    const key = canonicalJson({task, protocol, contract, snapshot, design, execution, role, risk,
      publicApi, persistence, transactions, security, money, operation, cache});
    const group = decisionGroups.get(key) ?? []; group.push(cell); decisionGroups.set(key, group);
  }
  const table = [...decisionGroups.values()].map(group => {
    const ranked = group.filter(cell => cell.ready).sort((a, b) => a.costPerAccepted! - b.costPerAccepted!);
    return {task: group[0]!.task, design: group[0]!.design, execution: group[0]!.execution,
      operation: group[0]!.operation, protocol: group[0]!.protocol, contract: group[0]!.contract, snapshot: group[0]!.snapshot,
      status: ranked.length ? 'candidata experimental' : 'sin decisión', recommendation: ranked[0]?.recipe ?? null,
      alternative: ranked[1]?.recipe ?? null, confidence: ranked.length ? 'exploratoria; sin intervalo estadístico' : 'insuficiente',
      candidates: group.map(c => ({recipe: c.recipe, n: c.n, acceptance: c.acceptance, qualityMeasured: c.qualityMeasured,
        qualityAccepted: c.qualityAccepted, costPerAccepted: c.costPerAccepted, costPerAcceptedMin: c.costPerAcceptedMin})),
      evidenceIds: ranked[0]?.evidenceIds ?? [], missing: group.flatMap(cell => cell.missing)};
  });
  const pareto = cells.map(cell => ({...cell, dominated: cells.some(other => other !== cell
    && other.task === cell.task && other.protocol === cell.protocol && other.contract === cell.contract
    && other.snapshot === cell.snapshot && other.role === cell.role && other.risk === cell.risk
    && other.publicApi === cell.publicApi && other.persistence === cell.persistence && other.transactions === cell.transactions
    && other.security === cell.security && other.money === cell.money && other.operation === cell.operation
    && other.design === cell.design && other.execution === cell.execution && other.cache === cell.cache
    && other.costPerAccepted !== null && cell.costPerAccepted !== null
    && other.acceptance !== null && cell.acceptance !== null && other.acceptance >= cell.acceptance && other.costPerAccepted <= cell.costPerAccepted
    && (other.acceptance > cell.acceptance || other.costPerAccepted < cell.costPerAccepted))}));
  const operations = groups(calls, row => canonicalJson([row.protocol, row.operation, row.model])).map(rows => ({
    protocol: rows[0]!.protocol, operation: rows[0]!.operation, model: rows[0]!.model, calls: rows.length,
    input: sumKnown(rows.map(r => r.tokens.input)), output: sumKnown(rows.map(r => r.tokens.output)),
    cacheRead: sumKnown(rows.map(r => r.tokens.cacheRead)), cacheWrite: sumKnown(rows.map(r => r.tokens.cacheWrite)),
    cacheWrite5m: rows.every(r => r.tokens.cacheWrite5m !== null) ? sumKnown(rows.map(r => r.tokens.cacheWrite5m)) : null,
    cacheWrite1h: rows.every(r => r.tokens.cacheWrite1h !== null) ? sumKnown(rows.map(r => r.tokens.cacheWrite1h)) : null,
    usd: rows.every(r => r.cost.totalMaxUsd !== null) ? sumKnown(rows.map(r => r.cost.totalMaxUsd)) : null,
    completeCost: rows.every(r => r.cost.totalMaxUsd !== null),
  }));
  const cache = groups(calls, row => canonicalJson([row.protocol, row.cacheCondition, row.model])).map(rows => {
    const complete = rows.every(r => r.tokens.input !== null && r.tokens.cacheRead !== null && r.tokens.cacheWrite !== null);
    const read = sumKnown(rows.map(r => r.tokens.cacheRead));
    const total = sumKnown(rows.flatMap(r => [r.tokens.input, r.tokens.cacheRead, r.tokens.cacheWrite]));
    const contexts = rows.flatMap(r => r.tokens.contextMax === null ? [] : [r.tokens.contextMax]);
    return {protocol: rows[0]!.protocol, condition: rows[0]!.cacheCondition, model: rows[0]!.model,
      hitRatio: complete && total ? read! / total : null,
      observedContextMax: contexts.length ? Math.max(...contexts) : null,
      contextCoverage: contexts.length + '/' + rows.length,
      switchCausalCost: null, reason: 'Sin control pareado; caché escrita observada no prueba costo causal del cambio'};
  });
  const failures = groups(runs.filter(r => r.accepted !== true), r => canonicalJson([r.protocol, r.recipe, r.failureReason]))
    .map(rows => ({protocol: rows[0]!.protocol, recipe: rows[0]!.recipe, reason: rows[0]!.failureReason, count: rows.length}));
  const handoffs = groups(runs, r => canonicalJson([r.protocol, r.handoffHash])).map(rows => ({
    protocol: rows[0]!.protocol, hash: rows[0]!.handoffHash, runs: rows.length,
    accepted: rows.filter(r => r.engineeringQuality === true && r.accepted === true).length,
  }));
  const triage = runs.filter(r => r.triageEscalated !== null && r.escalationRequired !== null);
  const shadows = runs.filter(r => r.shadowRecipe !== null);
  const confusion = shadows.map(row => {
    const decision = table.find(d => d.task === row.taskId && d.protocol === row.protocol && d.contract === row.acceptanceContractHash);
    return {id: row.id, predicted: row.shadowRecipe, observed: decision?.recommendation ?? null,
      match: decision?.recommendation ? decision.recommendation === row.shadowRecipe : null};
  });
  return {schemaVersion: 1, runs: runs.length, calls: calls.length, cells, decisions: table, pareto,
    observedCostMin: sumKnown(runs.map(r => r.cost.totalMinUsd)), observedCostMax: sumKnown(runs.map(r => r.cost.totalMaxUsd)),
    completeCost: runs.every(r => r.cost.complete === true && r.cost.totalMinUsd !== null && r.cost.totalMaxUsd !== null), operations, cache, failures, handoffs,
    triage: {measured: triage.length, correct: triage.filter(r => r.triageEscalated === r.escalationRequired).length,
      accuracy: triage.length ? triage.filter(r => r.triageEscalated === r.escalationRequired).length / triage.length : null},
    shadow: {measured: shadows.length, confusion},
    designerEffect: analyzeFactorialEffects(controls.factorials ?? []),
    explorationAB: analyzeExplorationPairs(controls.explorationPairs ?? []),
    proposedPolicy: {mode: 'shadow', rules: table.filter(d => d.recommendation).map(d => ({...d, enforce: false}))},
  };
}
export type EvidenceAnalysis = ReturnType<typeof analyzeEvidence>;
