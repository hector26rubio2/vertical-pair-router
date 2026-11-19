import type { AgentModel, AgentRoutingPolicy, AgentRouteInput } from './agent-routing.js';

export type WorkflowKind = 'team-conflict' | 'feature' | 'requirements' | 'bug-analysis' | 'bugfix' | 'init' | 'refactor' | 'project-analysis' | 'improvement';
export interface WorkflowCase {
  readonly caseId: string;
  readonly taskKind: WorkflowKind;
  readonly executionRole?: 'coding' | 'review' | 'inventory';
  readonly taskSignature: string;
  readonly complexity: AgentRouteInput['complexity'];
  readonly risk: AgentRouteInput['risk'];
  readonly plannerId: string | null;
  readonly technicalPlannerId?: string | null;
  readonly reviewerId?: string | null;
  readonly executorId: string;
  readonly accepted: boolean;
  readonly modelConfirmed: boolean;
  readonly completeAccounting: boolean;
  /** Entire workflow, including review, failed attempts and retries. */
  readonly usdMax: number;
  readonly pricesExpireAt: string;
}
export interface WorkflowRequest {
  readonly kind: WorkflowKind;
  readonly executionRole?: 'coding' | 'review' | 'inventory';
  readonly taskSignature: string;
  readonly complexity: AgentRouteInput['complexity'];
  readonly risk: AgentRouteInput['risk'];
  readonly hasAcceptanceChecks: boolean;
  readonly needsPlanning: boolean;
  readonly currentModelId: string;
  readonly preferredExecutorId: string;
  /** Explicit alternatives to compare; does not authorize another provider. */
  readonly executorModelIds?: readonly string[];
  readonly providerCapacity?: readonly { readonly provider:string; readonly state:'available'|'limit-reached'|'unknown'; readonly observedAt:string; readonly source:'provider_reported' }[];
  readonly requireKnownCapacity?: boolean;
  readonly plannerId: string;
  readonly advancedPlannerId: string;
  /** Optional candidate, never an automatic extra model call without evidence. */
  readonly technicalPlannerId?: string;
  readonly reviewerId?: string;
  readonly planningMode?: 'auto' | 'two-stage' | 'three-stage';
  readonly allowedProviders: readonly string[];
  readonly verifiedModelIds: readonly string[];
  readonly history: readonly WorkflowCase[];
  readonly now: string;
}

/** Local rules and retrieval of whole-workflow cases. Does not call or dispatch a model. */
export function decideAgentWorkflow(policy: AgentRoutingPolicy, input: WorkflowRequest) {
  if (!['team-conflict','feature','requirements','bug-analysis','bugfix','init','refactor','project-analysis','improvement'].includes(input.kind) ||
      !['simple','normal','complex'].includes(input.complexity) || !['low','medium','high'].includes(input.risk) ||
      typeof input.hasAcceptanceChecks !== 'boolean' || typeof input.needsPlanning !== 'boolean' ||
      typeof input.taskSignature !== 'string' || input.taskSignature.length === 0 || input.taskSignature.length > 200 ||
      !Number.isFinite(Date.parse(input.now))) throw new TypeError('Invalid workflow task metadata');
  if(input.executorModelIds!==undefined&&(!Array.isArray(input.executorModelIds)||input.executorModelIds.length>20||!input.executorModelIds.every(id=>typeof id==='string')))throw new TypeError('Invalid executor alternatives');
  if((input.planningMode!==undefined&&!['auto','two-stage','three-stage'].includes(input.planningMode))||[input.technicalPlannerId,input.reviewerId].some(id=>id!==undefined&&(typeof id!=='string'||id.length===0)))throw new TypeError('Invalid planning recipe');
  const executionRole=input.executionRole??'coding';
  if(!['coding','review','inventory'].includes(executionRole))throw new TypeError('Invalid execution role');
  if (!Number.isInteger(policy.maxWorkers) || policy.maxWorkers < 1 || policy.maxWorkers > 2) throw new TypeError('Invalid worker bound');
  const rank = { light: 0, standard: 1, high: 2 };
  if(input.providerCapacity!==undefined&&(!Array.isArray(input.providerCapacity)||input.providerCapacity.some(item=>!item||typeof item.provider!=='string'||!['available','limit-reached','unknown'].includes(item.state)||item.source!=='provider_reported'||!Number.isFinite(Date.parse(item.observedAt)))))throw new TypeError('Invalid provider capacity');
  if(input.requireKnownCapacity!==undefined&&typeof input.requireKnownCapacity!=='boolean')throw new TypeError('Invalid capacity policy');
  const quotaChecks=[...new Set(policy.models.map(model=>model.provider))].map(provider=>{
    const recent=(input.providerCapacity??[]).filter(item=>item.provider===provider&&Date.parse(input.now)-Date.parse(item.observedAt)>=0&&Date.parse(input.now)-Date.parse(item.observedAt)<300_000);
    const latest=recent.sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
    return {provider,state:latest?.state??'unknown',source:latest?.source??'unavailable',observedAt:latest?.observedAt??null};
  });
  const eligible = policy.models.filter(model => input.allowedProviders.includes(model.provider) && input.verifiedModelIds.includes(model.id)&&
    quotaChecks.some(check=>check.provider===model.provider&&check.state!=='limit-reached'&&(!input.requireKnownCapacity||check.state==='available')));
  const byId = (id: string) => eligible.find(model => model.id === id);
  const seen = new Set<string>();
  const cases = input.history.filter(row => {
    if(!row||typeof row.caseId!=='string'||typeof row.accepted!=='boolean'||row.modelConfirmed!==true||row.completeAccounting!==true||
      typeof row.pricesExpireAt!=='string'||typeof row.executorId!=='string'||(row.plannerId!==null&&typeof row.plannerId!=='string'))return false;
    if (seen.has(row.caseId)) return false;
    seen.add(row.caseId);
    return (row.executionRole??'coding')===executionRole && row.taskKind === input.kind && row.taskSignature === input.taskSignature && row.complexity === input.complexity && row.risk === input.risk && row.modelConfirmed && row.completeAccounting &&
      Number.isFinite(row.usdMax) && row.usdMax >= 0 && Date.parse(row.pricesExpireAt) >= Date.parse(input.now);
  });
  const provenDirect = (id: string) => {
    const matched=cases.filter(row=>row.plannerId===null&&row.executorId===id&&(row.technicalPlannerId??null)===null&&(row.reviewerId??null)===(input.reviewerId??null));
    return matched.length>=3&&matched.filter(row=>row.accepted).length/matched.length>=.8;
  };
  const requiresAdvanced = input.complexity === 'complex' || input.risk === 'high';
  const requiredRank = requiresAdvanced ? 2 : input.complexity === 'normal' ? 1 : 0;
  const preferred = byId(input.preferredExecutorId);
  const current = byId(input.currentModelId);
  const executors=[...new Set([input.preferredExecutorId,...(input.executorModelIds??[])])].map(byId).filter((model):model is AgentModel=>!!model);
  const selectedPlanner = byId(requiresAdvanced ? input.advancedPlannerId : input.plannerId);
  const technicalPlanner=input.technicalPlannerId?byId(input.technicalPlannerId):undefined;
  const explicitReviewer=input.reviewerId?byId(input.reviewerId):undefined;
  const canPlan = (model: AgentModel | undefined) => !!model && rank[model.tier] >= (requiresAdvanced ? 2 : 1) &&
    (model.roles.includes('orchestrator') || model.roles.includes('review'));
  const canDirect = (model: AgentModel) => model.roles.includes(executionRole) &&
    (rank[model.tier] >= requiredRank || (input.risk!=='high'&&input.hasAcceptanceChecks&&provenDirect(model.id))) &&
    (model.tier !== 'light' || ((executionRole!=='coding'||(policy.allowLightCoding&&input.hasAcceptanceChecks)) && (input.risk === 'low'||provenDirect(model.id))));
  const canReview=(model:AgentModel|undefined)=>!!model&&model.roles.includes('review')&&(model.tier!=='light'||(input.risk==='low'&&input.hasAcceptanceChecks));
  const canRefine=(model:AgentModel|undefined)=>!!model&&rank[model.tier]>=1&&(model.roles.includes('orchestrator')||model.roles.includes('review'));
  type Candidate = { plannerId: string | null; technicalPlannerId:string|null; reviewerId:string|null; executorId: string; evidenceIds: string[]; evidenceTruncated: boolean; samples: number; qualityRate: number | null; usdPerAccepted: number | null };
  const candidates: Candidate[] = [];
  const add = (plannerId: string | null, executorId: string,technicalId:string|null=null) => {
    const reviewer=input.reviewerId?explicitReviewer:technicalId?byId(technicalId):plannerId?byId(plannerId):undefined;
    if((plannerId||input.reviewerId)&&!canReview(reviewer))return;
    const reviewerId=reviewer?.id??null;
    if (!candidates.some(row => row.plannerId === plannerId && row.executorId === executorId&&row.technicalPlannerId===technicalId&&row.reviewerId===reviewerId)) candidates.push({ plannerId,technicalPlannerId:technicalId,reviewerId,executorId, evidenceIds: [], evidenceTruncated: false, samples: 0, qualityRate: null, usdPerAccepted: null });
  };
  if (!input.needsPlanning&&input.planningMode!=='three-stage') {
    for(const executor of executors)if(canDirect(executor))add(null,executor.id);
    if (current && canDirect(current)) add(null,current.id);
  }
  // A light implementation worker may handle a harder task only behind a
  // capable planner/reviewer, with explicit opt-in and executable acceptance.
  if(canPlan(selectedPlanner))for(const executor of executors)if(executor.roles.includes(executionRole)&&
      (executor.tier!=='light'||executionRole!=='coding'||(policy.allowLightCoding&&input.hasAcceptanceChecks))){
        if(input.planningMode!=='three-stage')add(selectedPlanner!.id,executor.id);
        if(input.planningMode!=='two-stage'&&(requiresAdvanced||input.planningMode==='three-stage')&&canRefine(technicalPlanner)&&technicalPlanner!.id!==selectedPlanner!.id)add(selectedPlanner!.id,executor.id,technicalPlanner!.id);
      }
  for (const candidate of candidates) {
    const matched = cases.filter(row => row.plannerId === candidate.plannerId && row.executorId === candidate.executorId&&(row.technicalPlannerId??null)===candidate.technicalPlannerId&&(row.reviewerId===undefined?(row.technicalPlannerId??row.plannerId):row.reviewerId)===candidate.reviewerId);
    const successes = matched.filter(row => row.accepted).length;
    candidate.evidenceIds = matched.slice(0,5).map(row => row.caseId);
    candidate.evidenceTruncated = matched.length>5;
    candidate.samples = matched.length;
    candidate.qualityRate = matched.length ? successes / matched.length : null;
    candidate.usdPerAccepted = successes ? matched.reduce((sum,row) => sum+row.usdMax,0)/successes : null;
  }
  const usable = candidates.filter(row => row.samples < 3 || row.qualityRate! >= .8);
  const ranked = usable.filter(row => row.samples >= 3 && row.usdPerAccepted !== null).sort((a,b) => a.usdPerAccepted!-b.usdPerAccepted! ||
    Number(a.plannerId!==null||a.executorId!==input.currentModelId)-Number(b.plannerId!==null||b.executorId!==input.currentModelId));
  // Evidence is comparative only when every otherwise viable candidate has
  // sufficient matched evidence. A cheap child receipt alone is insufficient.
  const comparable = (policy.objective ?? 'reference-cost') === 'reference-cost' && usable.length > 1 && ranked.length === usable.length;
  const sameConfiguredModel=preferred&&current&&preferred.provider===current.provider&&preferred.model===current.model&&preferred.effort===current.effort;
  const selected = comparable ? ranked[0] : input.needsPlanning || input.risk==='high'
    ? usable.find(row => row.plannerId !== null) : (sameConfiguredModel?usable.find(row=>row.plannerId===null&&row.executorId===input.currentModelId):undefined) ?? usable.find(row => row.plannerId === null && row.executorId === input.preferredExecutorId) ?? usable.find(row => row.plannerId === null) ?? usable[0];
  return {
    status: !selected ? 'blocked' : comparable ? 'historical-forecast' : 'rule-based',
    mode: !selected ? 'blocked' : selected.technicalPlannerId?'architecture-technical-implement-review':selected.plannerId ? 'plan-implement-review' : selected.executorId === input.currentModelId ? 'direct-current' : 'direct-worker',
    plannerId: selected?.plannerId ?? null, executorId: selected?.executorId ?? null,
    technicalPlannerId:selected?.technicalPlannerId??null,reviewerId: selected?.reviewerId ?? null,
    workerCount: !selected ? 0 : selected.plannerId || selected.executorId !== input.currentModelId ? 1 : 0,
    phases: !selected ? [] : selected.plannerId ? [
      { phase: 'plan', modelId: selected.plannerId, writeFiles: false },
      ...(selected.technicalPlannerId?[{phase:'technical-plan',modelId:selected.technicalPlannerId,writeFiles:false}]:[]),
      { phase: executionRole==='coding'?'implement':executionRole, modelId: selected.executorId, writeFiles: executionRole==='coding' },
      { phase: 'review', modelId: selected.reviewerId!, writeFiles: false }
    ] : [{ phase: executionRole==='coding'?'implement':executionRole, modelId: selected.executorId, writeFiles: executionRole==='coding' },...(selected.reviewerId?[{phase:'review',modelId:selected.reviewerId,writeFiles:false}]:[])],
    decisionInferenceTokens: 0, dispatchPerformed: false, objective: policy.objective ?? 'reference-cost',
    estimatedReferenceUsdPerAccepted: comparable ? selected?.usdPerAccepted ?? null : null,
    actualSubscriptionCharge: null, candidates, quotaChecks,
    reason: !selected ? 'No verified, policy-allowed workflow satisfies planning, implementation and acceptance requirements'
      : comparable ? 'Ranked full workflow cost per accepted result, including failed attempts; forecast only'
      : 'Configured complexity and risk rules; insufficient matched evidence to claim optimal cost',
    requiredHandoff: ['goal','acceptanceCriteria','allowedPaths','dependencies','checkCommands','openQuestions'],
    maxImplementationRetries: 1
  };
}
