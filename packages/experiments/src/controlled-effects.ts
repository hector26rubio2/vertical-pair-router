import {validateEvidence, type EvidenceRecord} from '@vpr/contracts';
import type {runFactorialCampaign} from './campaign-runner.js';
type FactorialResult = Awaited<ReturnType<typeof runFactorialCampaign>>;
const groupBy = <T>(rows: readonly T[], key: (row: T) => string) => {
  const map = new Map<string, T[]>();
  for (const row of rows) {const id = key(row), group = map.get(id) ?? []; group.push(row); map.set(id, group);}
  return [...map.values()];
};
export function analyzeFactorialEffects(campaigns: readonly FactorialResult[]) {
  const rows = campaigns.flatMap((campaign, campaignIndex) => campaign.trials.map(trial => ({...trial,
    campaign: campaignIndex, mode: campaign.status,
    allocation: campaign.designAllocations.find(a => a.designer === trial.designer)?.allocatedPerConsumer ?? null})));
  for (const row of rows) for (const phase of row.phases) {
    if (phase.record && !validateEvidence(phase.record).valid) throw new Error('Invalid factorial receipt');
  }
  const summarize = (group: typeof rows) => {
    const accepted = group.filter(r => r.accepted), complete = group.every(r => r.cost.complete && r.allocation !== null);
    return {designer: group[0]!.designer, executor: group[0]!.executor, cache: group[0]!.cacheCondition,
      n: group.length, accepted: accepted.length, acceptance: accepted.length / group.length,
      native: group.every(r => r.mode === 'native'),
      qualityQualified: group.length >= 3 && accepted.length / group.length >= .8 && complete && group.every(r => r.mode === 'native'),
      costPerAccepted: complete && accepted.length
        ? group.reduce((sum, r) => sum + r.cost.max! + r.allocation!.max, 0) / accepted.length : null,
      planHashes: [...new Set(group.map(r => r.handoffHash))],
      evidenceIds: group.flatMap(r => r.phases.flatMap(p => p.record ? [p.record.id] : []))};
  };
  const executorEffects = groupBy(rows, r => JSON.stringify([r.campaign, r.designer, r.handoffHash, r.cacheCondition]))
    .map(group => ({fixedDesigner: group[0]!.designer, frozenPlanHash: group[0]!.handoffHash,
      candidates: groupBy(group, r => r.executor).map(summarize)}));
  const designerEffects = groupBy(rows, r => JSON.stringify([r.campaign, r.executor, r.cacheCondition]))
    .map(group => ({fixedExecutor: group[0]!.executor, candidates: groupBy(group, r => r.designer).map(summarize)}));
  return {status: rows.length ? 'available' : 'N/D', executorEffects, designerEffects,
    reason: rows.length ? 'Efectos descriptivos por factor controlado; no equivalen a una garantía estadística'
      : 'Requiere planes congelados y ejecutores fijos; los datos legados no aíslan el diseñador'};
}
export interface ControlledPair {readonly id: string; readonly mode: 'native' | 'simulation';
  readonly a: EvidenceRecord; readonly b: EvidenceRecord}
export function analyzeExplorationPairs(pairs: readonly ControlledPair[]) {
  const results = pairs.map(pair => {
    if (!validateEvidence(pair.a).valid || !validateEvidence(pair.b).valid) throw new Error('Invalid A/B receipt');
    const a = pair.a, b = pair.b;
    const comparable = pair.mode === 'native' && a.taskId === b.taskId && a.protocol !== null && a.protocol === b.protocol
      && a.acceptanceContractHash !== null && a.acceptanceContractHash === b.acceptanceContractHash
      && a.snapshotHash != null && a.snapshotHash === b.snapshotHash && a.handoffHash !== null && a.handoffHash === b.handoffHash
      && a.accepted === true && b.accepted === true && a.engineeringQuality === true && b.engineeringQuality === true
      && a.cost.complete === true && b.cost.complete === true
      && a.cost.totalMaxUsd !== null && b.cost.totalMaxUsd !== null;
    return {id: pair.id, comparable, mode: pair.mode, evidenceIds: [a.id, b.id],
      savingUsd: comparable ? b.cost.totalMaxUsd! - a.cost.totalMaxUsd! : null,
      savingPercent: comparable && b.cost.totalMaxUsd! > 0 ? 100 * (b.cost.totalMaxUsd! - a.cost.totalMaxUsd!) / b.cost.totalMaxUsd! : null,
      reason: comparable ? 'Mismo contrato, instantánea y plan; A/B con calidad verificada'
        : 'Falta control pareado, calidad, identidad experimental nativa o contabilidad completa'};
  });
  const qualified = results.filter(r => r.comparable);
  return {pairs: results, n: qualified.length, saving: qualified.length >= 3
    ? qualified.reduce((sum, r) => sum + r.savingUsd!, 0) / qualified.length : null,
    reason: qualified.length >= 3 ? 'Diferencia media observada de pares completos; revisar rango y repetir'
      : 'Requiere al menos tres pares A/B con revisión y snapshots equivalentes'};
}
