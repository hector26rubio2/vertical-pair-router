import {validateEvidence, type EvidenceRecord, type Handoff} from '@vpr/contracts';
import {freezeHandoff, validateFrozenHandoff, randomizeCells, scheduleStories,
  allocateSharedDesign, type FrozenHandoff, type ExperimentStory} from './protocol.js';

type Limits = Handoff['limits'];
type Phase = 'triage' | 'design' | 'implement' | 'repair' | 'review';
export const escalationReasons = ['security', 'public-api', 'cross-module', 'invariant-ambiguity', 'risk-high'] as const;
export interface PhaseInput {
  readonly phase: Phase; readonly model: string; readonly taskId: string;
  readonly cellId: string; readonly limits: Limits; readonly designer?: string;
  readonly frozenPlan?: FrozenHandoff; readonly story?: ExperimentStory;
  readonly cacheCondition?: string; readonly repaired?: boolean;
}
export interface PhaseOutput {
  readonly status: 'passed' | 'failed' | 'escalate' | 'cancelled';
  readonly record: EvidenceRecord | null;
  readonly handoff?: Handoff;
  readonly stories?: readonly ExperimentStory[];
  readonly escalate?: boolean;
  readonly escalationReason?: typeof escalationReasons[number];
  readonly reason?: string;
}
export interface CampaignPorts {
  readonly mode: 'simulation' | 'native';
  phase(input: PhaseInput & {readonly signal: AbortSignal;
    readonly onReceipt: (record: EvidenceRecord) => Promise<void>}): Promise<PhaseOutput>;
  persist(record: EvidenceRecord): Promise<void>;
}
interface Control {readonly nativeApproval?: 'explicitly-approved'; readonly signal?: AbortSignal}
function authorize(ports: CampaignPorts, control: Control) {
  if (ports.mode === 'native' && control.nativeApproval !== 'explicitly-approved') {
    throw new Error('Native campaign requires explicit owner approval');
  }
  control.signal?.throwIfAborted();
}
async function phase(input: PhaseInput, ports: CampaignPorts, control: Control): Promise<PhaseOutput> {
  if (!Number.isSafeInteger(input.limits.wallMs) || input.limits.wallMs < 1 || input.limits.wallMs > 300_000
    || !Number.isSafeInteger(input.limits.turns) || input.limits.turns < 1) throw new Error('Invalid phase limits');
  if (input.frozenPlan) validateFrozenHandoff(input.frozenPlan);
  const controller = new AbortController();
  const signal = control.signal ? AbortSignal.any([controller.signal, control.signal]) : controller.signal;
  let last: EvidenceRecord | null = null;
  const save = async (record: EvidenceRecord) => {
    if (!validateEvidence(record).valid) throw new Error('Invalid phase receipt');
    await ports.persist(record); last = record;
  };
  const timer = setTimeout(() => controller.abort(new Error('tiempo_agotado')), input.limits.wallMs);
  let rejectAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(signal.reason);
    signal.addEventListener('abort', rejectAbort, {once: true});
  });
  try {
    signal.throwIfAborted();
    const output = await Promise.race([ports.phase({...input, signal, onReceipt: save}), cancelled]);
    if (output.record) await save(output.record);
    if (output.record?.turns !== null && output.record?.turns !== undefined && output.record.turns > input.limits.turns) {
      return {...output, status: 'failed', reason: 'turnos_agotados'};
    }
    if (input.model.toLowerCase().includes('haiku') && (output.record?.tokens.contextMax ?? 0) >= 90_000) {
      return {...output, status: 'failed', reason: 'context_guard_violation'};
    }
    return output;
  } catch (error) {
    return {status: signal.aborted ? 'cancelled' : 'failed', record: last,
      reason: error instanceof Error ? error.message : 'Unknown phase failure'};
  } finally {
    clearTimeout(timer);
    if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
  }
}
function costs(outputs: readonly PhaseOutput[]) {
  const complete = outputs.every(p => p.record?.cost.complete === true
    && p.record.cost.totalMinUsd !== null && p.record.cost.totalMaxUsd !== null && p.status !== 'cancelled');
  const observed = outputs.flatMap(p => p.record?.cost.totalMinUsd !== null && p.record?.cost.totalMinUsd !== undefined
    && p.record.cost.totalMaxUsd !== null ? [p.record.cost] : []);
  return {complete, min: complete ? outputs.reduce((sum, p) => sum + p.record!.cost.totalMinUsd!, 0) : null,
    max: complete ? outputs.reduce((sum, p) => sum + p.record!.cost.totalMaxUsd!, 0) : null,
    observedMin: observed.length ? observed.reduce((sum, cost) => sum + cost.totalMinUsd!, 0) : null,
    observedMax: observed.length ? observed.reduce((sum, cost) => sum + cost.totalMaxUsd!, 0) : null};
}
type ReviewedResult = Awaited<ReturnType<typeof reviewedExecution>>;
const unavailableCost = () => ({complete: false, min: null, max: null, observedMin: null, observedMax: null});
function quality(review: PhaseOutput): boolean {
  const r = review.record;
  return review.status === 'passed' && r?.engineeringQuality === true && r.review.fresh === true
    && r.review.citationsVerified === true && r.review.critical === 0 && r.review.high === 0 && r.review.medium === 0;
}
async function reviewedExecution(input: Omit<PhaseInput, 'phase' | 'model'> & {readonly executor: string; readonly reviewer: string},
  ports: CampaignPorts, control: Control) {
  const implemented = await phase({...input, phase: 'implement', model: input.executor}, ports, control);
  const outputs = [implemented];
  if (implemented.status === 'cancelled' || implemented.status === 'escalate') {
    return {accepted: false, phases: outputs, cost: costs(outputs), escalation: implemented.status === 'escalate'};
  }
  let review = await phase({...input, phase: 'review', model: input.reviewer, repaired: false}, ports, control);
  outputs.push(review);
  if (!quality(review) || implemented.status !== 'passed') {
    const repair = await phase({...input, phase: 'repair', model: input.executor}, ports, control);
    outputs.push(repair);
    if (repair.status === 'passed') {
      review = await phase({...input, phase: 'review', model: input.reviewer, repaired: true}, ports, control);
      outputs.push(review);
    }
  }
  const sessions = outputs.map(output => output.record?.runId).filter((id): id is string => !!id);
  const fresh = sessions.length === outputs.length && new Set(sessions).size === sessions.length;
  const implementedLast = outputs.findLast(output => output.record?.phase === 'repair') ?? implemented;
  const checks = implementedLast.record?.checks;
  return {accepted: fresh && quality(review) && implementedLast.status === 'passed'
    && checks?.external === true && checks.regression === true && checks.build === true,
    phases: outputs, cost: costs(outputs), escalation: outputs.some(output => output.status === 'escalate')};
}
export interface FactorialCampaignSpec {
  readonly taskId: string; readonly designers: readonly string[]; readonly executors: readonly string[];
  readonly reviewer: string; readonly repetitions: number; readonly seed: number;
  readonly cacheConditions: readonly ('cold-requested' | 'warm-requested')[]; readonly limits: Limits;
}
export async function runFactorialCampaign(spec: FactorialCampaignSpec, ports: CampaignPorts, control: Control = {}) {
  authorize(ports, control);
  if (!Number.isSafeInteger(spec.repetitions) || spec.repetitions < 3 || spec.repetitions > 20
    || !spec.designers.length || !spec.executors.length || !spec.cacheConditions.length
    || new Set(spec.designers).size !== spec.designers.length
    || new Set(spec.executors).size !== spec.executors.length) throw new Error('Invalid factorial campaign');
  const designs = new Map<string, {output: PhaseOutput; frozen: FrozenHandoff | null}>();
  for (const designer of spec.designers) {
    const output = await phase({phase: 'design', model: designer, taskId: spec.taskId,
      cellId: spec.taskId + ':design:' + designer, limits: spec.limits}, ports, control);
    let frozen: FrozenHandoff | null = null;
    if (output.status === 'passed' && output.handoff) {
      try {frozen = freezeHandoff(output.handoff);} catch { /* Invalid plans remain disqualified; receipts remain. */ }
    }
    designs.set(designer, {output, frozen});
  }
  const cells = spec.designers.flatMap(designer => spec.executors.flatMap(executor => spec.cacheConditions.flatMap(cacheCondition =>
    Array.from({length: spec.repetitions}, (_, repeat) => ({designer, executor, cacheCondition, repeat: repeat + 1})))));
  const trials: (ReviewedResult & {designer: string; executor: string; cacheCondition: string; repeat: number;
    cellId: string; order: number; handoffHash: string | null})[] = [];
  for (const [order, cell] of randomizeCells(cells, spec.seed).entries()) {
    const plan = designs.get(cell.designer)!;
    const cellId = `${spec.taskId}:${cell.designer}:${cell.executor}:${cell.cacheCondition}:${cell.repeat}`;
    const result = plan.frozen ? await reviewedExecution({taskId: spec.taskId, cellId, designer: cell.designer,
      executor: cell.executor, reviewer: spec.reviewer, frozenPlan: plan.frozen,
      cacheCondition: cell.cacheCondition, limits: spec.limits}, ports, control)
      : {accepted: false, phases: [], cost: unavailableCost(), escalation: true};
    trials.push({...cell, cellId, order, handoffHash: plan.frozen?.sha256 ?? null, ...result});
  }
  const designAllocations = [...designs].map(([designer, design]) => {
    const cost = costs([design.output]);
    const consumers = trials.filter(trial => trial.designer === designer && trial.phases[0]?.record)
      .map(trial => trial.phases[0]!.record!.id);
    return {designer, ...allocateSharedDesign(cost.complete ? {min: cost.min!, max: cost.max!} : null, consumers)};
  });
  const total = costs([...designs.values()].map(value => value.output).concat(trials.flatMap(trial => trial.phases)));
  return {status: ports.mode, protocol: 'frozen-factorial-v1', seed: spec.seed, trials, designAllocations,
    completeAccounting: total.complete, cost: total};
}
export interface HierarchicalPorts extends CampaignPorts {
  materializeTasks(stories: readonly ExperimentStory[]): Promise<readonly (ExperimentStory & {readonly taskId: string})[]>;
  routeStory(story: ExperimentStory): Promise<{readonly executorId: string; readonly shadow: unknown}>;
}
export async function runHierarchicalTrial(spec: {readonly taskId: string; readonly triager: string; readonly designer: string;
  readonly advancedDesigner: string; readonly reviewer: string; readonly limits: Limits}, ports: HierarchicalPorts, control: Control = {}) {
  authorize(ports, control);
  const triage = await phase({phase: 'triage', model: spec.triager, taskId: spec.taskId, cellId: spec.taskId + ':triage', limits: spec.limits}, ports, control);
  if (triage.status !== 'passed') throw new Error('Triage failed; receipts preserved');
  if (triage.escalate && (!triage.escalationReason || !escalationReasons.includes(triage.escalationReason))) {
    throw new Error('Escalation requires a fixed reason');
  }
  const designer = triage.escalate ? spec.advancedDesigner : spec.designer;
  const design = await phase({phase: 'design', model: designer, taskId: spec.taskId, cellId: spec.taskId + ':design', limits: spec.limits}, ports, control);
  if (design.status !== 'passed' || !design.handoff || !design.stories?.length) throw new Error('Design requires a handoff and stories');
  const frozenPlan = freezeHandoff(design.handoff);
  const tasks = await ports.materializeTasks(design.stories), assignments = [];
  for (const task of tasks) {
    const route = await ports.routeStory(task);
    assignments.push({...task, model: route.executorId, shadow: route.shadow});
  }
  const runs: (ReviewedResult & {storyId: string})[] = [];
  for (const wave of scheduleStories(assignments)) {
    control.signal?.throwIfAborted();
    const blocked = wave.filter(story => runs.some(run => story.dependencies.includes(run.storyId) && !run.accepted));
    for (const story of blocked) runs.push({storyId: story.id, accepted: false, phases: [], cost: unavailableCost(), escalation: true});
    const results = await Promise.all(wave.filter(story => !blocked.includes(story)).map(async story => ({storyId: story.id,
      ...await reviewedExecution({taskId: spec.taskId, cellId: spec.taskId + ':' + story.id, executor: story.model,
        reviewer: spec.reviewer, designer, story, frozenPlan, limits: spec.limits}, ports, control)})));
    runs.push(...results);
  }
  return {status: ports.mode, protocol: 'hierarchical-v1', designer, escalationReason: triage.escalationReason ?? null,
    assignments, runs, accepted: runs.every(run => run.accepted),
    escalatedStories: runs.filter(run => run.escalation).length,
    returnedToDesigner: runs.filter(run => run.escalation).map(run => run.storyId),
    cost: costs([triage, design, ...runs.flatMap(run => run.phases)])};
}
