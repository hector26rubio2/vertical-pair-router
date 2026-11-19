const baseArm = row => row.strategyArm ?? row.arm.replace(/-(?:attempt|repeat)-\d+$/u, '');
const bounded = value => Number.isFinite(value) && value >= 0;
export function executionBlocker(row){
  for(const phase of row.phases??[]){
    const receipt=phase.receipt??{},label=phase.phase??'fase';
    if(receipt.stopped==='provider-limit')return 'El proveedor alcanzó su límite durante '+label+'. No se evalúa como capacidad del modelo.';
    if(receipt.stopped==='context-guard-unverified'||/VPR:.*(?:context|count)/iu.test(phase.answer??''))return 'La protección de contexto detuvo '+label+'. Es un bloqueo técnico; no una medida de calidad del modelo.';
    if(receipt.stopped==='deadline')return 'Se alcanzó el límite de tiempo de '+label+'. La tarea no terminó; se conserva el consumo parcial y no se supone costo cero.';
    if(receipt.terminalReceipt?.subtype==='error_max_turns')return 'Se alcanzó el límite de turnos de '+label+' antes de entregar el resultado. Las fases posteriores no se ejecutaron.';
  }
  return null;
}
export function comparisonSelection(task,rows){
  const all=rows.filter(row=>row.taskId===task.id);
  const technical=row=>{
    const phases=row.phases??[];
    return phases.some(phase=>['provider-limit','context-guard-unverified'].includes(phase.receipt?.stopped)||/VPR:.*(?:context|count)|hit your.*limit/iu.test(phase.answer??''));
  };
  const oldContext=row=>(row.models??[]).some(model=>model.model?.includes('haiku')&&contextEvidence(row,model).observedMax>=90000);
  const comparable=all.filter(row=>!technical(row)&&!oldContext(row));
  const corrected=comparable.some(row=>row.validationPolicy==='common-review-up-to-one-correction');
  const selected=corrected?comparable.filter(row=>row.validationPolicy==='common-review-up-to-one-correction'):comparable;
  return {selected,excluded:all.filter(row=>!selected.includes(row)),policy:corrected?'common-review-up-to-one-correction':task.protocol==='staged-recipe-v1'?'common-review-first-pass':'legacy-contract',technicalBlocked:all.filter(technical).length};
}
export function contextEvidence(row, model) {
  const requests = (row.receipt?.requests ?? []).filter(request => request.model === model.model);
  const valid = requests.filter(request => ['inputTokens','cacheReadTokens','cacheWriteTokens'].every(key => bounded(request[key])));
  const max = valid.length ? Math.max(...valid.map(request => request.inputTokens + request.cacheReadTokens + request.cacheWriteTokens)) : null;
  return {observedMax: max ?? model.maxObservedPromptTokens ?? null,
    upperBound: model.cost?.contextPromptUpperBound ?? (model.provider==='codex' && [model.inputTokens,model.cacheReadTokens,model.cacheWriteTokens].every(bounded) ? model.inputTokens+model.cacheReadTokens+model.cacheWriteTokens : null),
    completePromptCoverage: model.cost?.perRequestPromptCoverage === true,
    requestCount: valid.length || null};
}
export function analyzeTask(task, rows) {
  const selection=comparisonSelection(task,rows),selected=selection.selected;
  const hashes = new Set(selected.map(row => row.acceptanceHash).filter(Boolean));
  const contractConflict = hashes.size > 1;
  const strategies = [...new Set(selected.map(baseArm))].map(arm => {
    const samples = selected.filter(row => baseArm(row) === arm);
    const accepted = samples.filter(row => row.status === 'accepted');
    const complete = samples.every(row => row.totalCost && row.receipt?.completeAccounting);
    const conditional = samples.some(row => row.models.some(model => model.cost?.modelIdentityCaveat));
    const cost = complete && accepted.length ? {min: samples.reduce((s,r) => s+r.totalCost.min,0)/accepted.length, max: samples.reduce((s,r) => s+r.totalCost.max,0)/accepted.length} : null;
    const wall = accepted.map(row => {
      const agent = row.receipt?.timings?.wallMs;
      return bounded(agent) ? agent + (row.localChecksTotalMs ?? ((row.checks?.own?.durationMs ?? 0)+(row.checks?.external?.durationMs ?? 0))) : null;
    });
    return {arm, attempts: samples.length, accepted: accepted.length, acceptanceRate: accepted.length/samples.length,
      costPerAccepted: cost, conditional, accountingComplete: complete,
      meanAcceptedMs: wall.length && wall.every(value => value !== null) ? wall.reduce((s,v)=>s+v,0)/wall.length : null,
      semanticReview: samples.some(row=>(row.semanticReview && row.semanticReview !== 'passed')||row.qualityReview?.findings?.some(f=>['critical','high','medium'].includes(f.severity))) ? 'pending-or-failed' : samples.every(row=>row.semanticReview === 'passed') ? 'passed' : 'not-measured',
      independentCodeReview: 'not-measured', securityAssessment: 'not-measured', maintainabilityAssessment: 'not-measured',
      contexts: samples.flatMap((row,index) => row.models.map(model => ({attempt: index+1, model: model.model, ...contextEvidence(row,model)})))};
  });
  const candidates = strategies.filter(s => s.accepted && s.costPerAccepted && !s.conditional && !contractConflict && s.acceptanceRate >= .8 && s.semanticReview !== 'pending-or-failed');
  const cheapest = [...candidates].sort((a,b)=>a.costPerAccepted.max-b.costPerAccepted.max)[0];
  const fastest = [...strategies].filter(s=>s.accepted && s.semanticReview!=='pending-or-failed' && s.meanAcceptedMs !== null).sort((a,b)=>a.meanAcceptedMs-b.meanAcceptedMs)[0];
  const expected = task.expectedArms??(task.id === 'R01' ? ['sonnet-codex-6-luna','sonnet-codex-6.1-terra','sonnet-codex-6.1-sol'] : ['haiku-solo','sonnet-solo','sonnet-haiku','opus-solo','opus-haiku',...(task.id==='F01'?['sonnet','opus'].flatMap(planner=>['6-luna','6.1-terra','6.1-sol'].map(model=>planner+'-codex-'+model)):[])]);
  const missing = expected.filter(arm => !strategies.some(s => s.arm === arm && s.accepted));
  const nextTrial=selected.filter(row=>row.status==='accepted'&&row.semanticReview==='reviewed-draft'&&row.receipt?.completeAccounting&&row.totalCost&&!contractConflict).sort((a,b)=>a.totalCost.max-b.totalCost.max)[0];
  return {taskId: task.id, contractConflict, strategies, comparisonPolicy:selection.policy,excludedTrials:selection.excluded.length,technicalBlocked:selection.technicalBlocked,cheapestObserved: cheapest?.arm ?? null, fastestObserved: fastest?.arm ?? null,
    nextTrialCandidate:nextTrial?{arm:baseArm(nextTrial),cost:nextTrial.totalCost,priceConditional:nextTrial.models.some(model=>model.cost?.modelIdentityCaveat),basis:'Next trial among coordinator-reviewed drafts; not approved engineering quality or autonomous optimal routing'}:null,
    missing, comparativeConfidence: contractConflict ? 'incompatible-contracts' : candidates.length > 1 && candidates.every(s=>s.attempts>=3) && !missing.length ? 'repeated-bounded-tests' : 'exploratory',
    qualityConclusion: 'Only acceptance of the measured contract is established; equal general code quality is not established.',
    recommendedRoute: task.level === 'simple' ? 'Light executor for a bounded low-risk change with external checks; escalate on failure.' : task.level.includes('complejo') ? 'Advanced planner, light executor, independent acceptance and review before integration.' : 'Standard planner, light executor, independent acceptance and review before integration.'};
}
