import {comparisonSelection} from './benchmark-analysis.mjs';
import {qualityEvidence} from './benchmark-quality.mjs';
export {qualityEvidence} from './benchmark-quality.mjs';

export const canonicalRecipe=arm=>String(arm??'').replace(/(?:-(?:attempt|repeat)-\d+)+$/u,'').replace(/-reviewed$/u,'').replace('-codex-6.1-','-codex-').replace('-codex-6-luna','-codex-luna');
const strategy=row=>row.strategyArm??row.arm.replace(/(?:-(?:attempt|repeat)-\d+)+$/u,'');
const finite=value=>Number.isFinite(value)&&value>=0;
const price=value=>value&&finite(value.min)&&finite(value.max)&&value.max>=value.min;
const defaultRecipes=['haiku-solo','sonnet-solo','opus-solo','sonnet-haiku','opus-haiku','opus-sonnet-haiku'];

export function taskVerdict(task,allRows){
  const selection=comparisonSelection(task,allRows),rows=selection.selected;
  const expected=[...new Set([...(task.expectedArms??defaultRecipes).map(canonicalRecipe),...rows.map(r=>canonicalRecipe(strategy(r)))])];
  const cells=expected.map(recipe=>{
    const samples=rows.filter(r=>canonicalRecipe(strategy(r))===recipe);
    const evidence=samples.map(row=>({row,quality:qualityEvidence(row,task)}));
    const qualified=evidence.filter(e=>e.quality.qualified);
    const checks=evidence.filter(e=>e.quality.checksPassed);
    const hashes=new Set(samples.map(r=>r.acceptanceHash).filter(Boolean));
    const contractsKnown=samples.length>0&&samples.every(r=>typeof r.acceptanceHash==='string'&&r.acceptanceHash.length>0)&&hashes.size===1;
    const protocols=new Set(samples.map(r=>r.validationPolicy??r.protocol??task.protocol??'legacy'));
    const wholeCost=samples.length>0&&samples.every(r=>r.receipt?.completeAccounting===true&&r.completeModelAccounting!==false&&price(r.totalCost));
    // Failed/rejected attempts are charged to the accepted quality results too.
    const costPerQualityResult=qualified.length&&wholeCost&&contractsKnown&&protocols.size===1?
      {min:samples.reduce((sum,r)=>sum+r.totalCost.min,0)/qualified.length,max:samples.reduce((sum,r)=>sum+r.totalCost.max,0)/qualified.length}:null;
    const times=qualified.map(({row:r})=>finite(r.receipt?.timings?.wallMs)?r.receipt.timings.wallMs+(r.localChecksTotalMs??((r.checks?.own?.durationMs??0)+(r.checks?.external?.durationMs??0))):null);
    const attemptTimes=samples.map(r=>finite(r.receipt?.timings?.wallMs)?r.receipt.timings.wallMs+(r.localChecksTotalMs??((r.checks?.own?.durationMs??0)+(r.checks?.external?.durationMs??0))):null);
    const spends=samples.map(r=>r.observedModelCost??r.totalCost).filter(price);
    const conditional=samples.some(r=>r.models?.some(m=>m.cost?.modelIdentityCaveat||m.modelIdentity==='requested-only'));
    return {recipe,attempts:samples.length,checksPassed:checks.length,qualityPassed:qualified.length,
      qualityRate:samples.length?qualified.length/samples.length:null,freshReviews:evidence.filter(e=>e.quality.freshReview).length,
      openFindings:evidence.reduce((sum,e)=>sum+e.quality.findings.medium+e.quality.findings.high+e.quality.findings.critical,0),
      state:!samples.length?'not-tested':qualified.length?'quality-passed':checks.length?'checks-only-or-open-review':'not-accepted',
      costPerQualityResult,priceConditional:conditional,contractsKnown,contractHash:contractsKnown?[...hashes][0]:null,
      protocol:protocols.size===1?[...protocols][0]:null,
      meanQualityWallMs:times.length&&times.every(finite)?times.reduce((s,v)=>s+v,0)/times.length:null,
      meanAttemptWallMs:attemptTimes.length&&attemptTimes.every(finite)?attemptTimes.reduce((s,v)=>s+v,0)/attemptTimes.length:null,
      observedCost:spends.length?{min:spends.reduce((s,c)=>s+c.min,0),max:spends.reduce((s,c)=>s+c.max,0)}:null,observedCostComplete:wholeCost,
      reviewSessions:samples.flatMap(r=>r.phases??[]).filter(p=>p.phase==='review'&&p.receipt?.terminalReceipt?.success===true).length,
      completedRepairs:samples.flatMap(r=>r.phases??[]).filter(p=>(p.phase==='repair'||p.phase==='implement'&&p.iteration>0)&&p.receipt?.terminalReceipt?.success===true).length,
      failures:evidence.filter(e=>!e.quality.qualified).map(({row,quality})=>({arm:row.arm,band:quality.band,reason:quality.blocker??(quality.findings.high||quality.findings.critical?'Hallazgos altos/críticos pendientes':quality.findings.medium?'Hallazgos medios pendientes':quality.checksPassed?'Falta revisión fresca y evidencia del mínimo de calidad':'No cumple la aceptación completa'),findings:quality.findings})),
      executedPhases:[...new Set(samples.flatMap(r=>(r.phases??[]).filter(p=>p.receipt?.terminalReceipt?.success===true).map(p=>p.phase+': '+p.model)))],
      structuralOnlyBestCost:checks.length&&wholeCost?{min:samples.reduce((s,r)=>s+r.totalCost.min,0)/checks.length,max:samples.reduce((s,r)=>s+r.totalCost.max,0)/checks.length}:null};
  });
  const viable=cells.filter(c=>c.qualityPassed&&c.costPerQualityResult&&c.qualityRate>=.8);
  const hashSet=new Set(viable.map(c=>c.contractHash)),protocolSet=new Set(viable.map(c=>c.protocol));
  const comparable=hashSet.size<=1&&protocolSet.size<=1;
  const ranked=comparable?[...viable].sort((a,b)=>a.costPerQualityResult.max-b.costPerQualityResult.max):[];
  const candidate=ranked[0]??null;
  const contenders=candidate?ranked.filter(c=>c.costPerQualityResult.min<=candidate.costPerQualityResult.max):[];
  const uniqueCostWinner=candidate&&ranked.every(c=>c===candidate||candidate.costPerQualityResult.max<c.costPerQualityResult.min);
  const pilot=uniqueCostWinner?candidate:null;
  const fallback=ranked.filter(c=>!c.priceConditional).sort((a,b)=>a.costPerQualityResult.max-b.costPerQualityResult.max)[0]??null;
  const snapshotIds=new Set(rows.map(r=>r.sourceSnapshotHash).filter(Boolean));
  const snapshotVerified=rows.length>0&&rows.every(r=>typeof r.sourceSnapshotHash==='string'&&r.sourceSnapshotHash.length>0)&&snapshotIds.size===1;
  const repeated=pilot&&ranked.length>=2&&snapshotVerified&&ranked.every(c=>c.attempts>=3&&!c.priceConditional)&&cells.every(c=>c.attempts>=3);
  const baseline=cells.find(c=>c.recipe==='sonnet-solo'&&c.costPerQualityResult);
  const saving=pilot&&baseline&&pilot!==baseline?{min:100*(1-pilot.costPerQualityResult.max/baseline.costPerQualityResult.min),max:100*(1-pilot.costPerQualityResult.min/baseline.costPerQualityResult.max)}:null;
  const lab=cells.filter(c=>c.structuralOnlyBestCost).sort((a,b)=>a.structuralOnlyBestCost.max-b.structuralOnlyBestCost.max)[0]??null;
  return {taskId:task.id,name:task.name,level:task.level,role:task.executionRole??(task.id==='R01'?'review':['requirements','project-analysis','bug-analysis'].includes(task.kind)||['W02','W03','W07','F01','F01B'].includes(task.id)?'inventory':'coding'),
    comparisonPolicy:selection.policy,excludedTrials:selection.excluded.length,cells,comparable,sourceSnapshotVerified:snapshotVerified,
    pilotChoice:pilot?.recipe??null,pilotCost:pilot?.costPerQualityResult??null,pilotPriceConditional:pilot?.priceConditional??false,
    fallbackChoice:fallback?.recipe??null,fallbackCost:fallback?.costPerQualityResult??null,
    costContenders:contenders.map(c=>c.recipe),qualityLeaders:cells.filter(c=>c.qualityPassed).map(c=>c.recipe),savingAgainstSonnetPercent:saving,
    evidenceLevel:repeated?'repeated-bounded-contract':pilot?'quality-reviewed-pilot':cells.some(c=>c.qualityPassed)?'quality-result-with-comparison-gaps':'acceptance-only-or-incomplete',
    autoRoutingReady:!!repeated,qualityEquivalent:'Sólo se compara el mismo umbral de aceptación y revisión; no se demuestra igualdad general de código.',
    labCandidate:!cells.some(c=>c.qualityPassed)?lab?.recipe??null:null,
    notTested:cells.filter(c=>!c.attempts).map(c=>c.recipe),attemptedNotQualified:cells.filter(c=>c.attempts&&!c.qualityPassed).map(c=>c.recipe),
    conclusion:pilot?'pilot-recommended':!comparable?'incompatible-evidence':cells.some(c=>c.qualityPassed)?'quality-present-no-economic-winner':lab?'checks-only-no-engineering-winner':'no-qualified-result'};
}

export const evaluationMethodology={schemaVersion:1,decisionInferenceTokens:0,minimumTrialsPerViableAlternative:3,minimumObservedQualityRate:.8,
  order:['same-task-snapshot-contract-and-protocol','quality-gate-before-cost','whole-workflow-cost-per-quality-accepted-result','time-and-repair-burden','coverage-confidence-and-provider-availability'],
  qualityGate:['all-external-acceptance','original-regressions-and-build','scope-and-protected-tests','fresh-review-with-verifiable-evidence','no-unresolved-critical-high-medium'],
  generalCodeQualityEquivalence:'not-demonstrated',thresholdMeaning:'Product admission rule; three samples and 80% are not statistical guarantees.',
  context:'Per-request context is separate from cumulative input. Unknown context keeps price intervals.',
  learning:'Legacy check-only results do not establish senior engineering quality or justify positive quality cases. Roles, effort, provider and failure costs must be preserved.'};
