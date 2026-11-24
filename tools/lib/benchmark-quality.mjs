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
/** Quality is an evidence gate, never a score inferred from tokens or price. */
export function qualityEvidence(row,task){
  const counts={critical:0,high:0,medium:0,low:0};
  for(const finding of row.qualityReview?.findings??[])if(finding.severity in counts)counts[finding.severity]++;
  const external=row.checks?.external;
  const checksPassed=row.status==='accepted'&&external?.exitCode===0&&Number.isInteger(task.testCount)&&external.passed===task.testCount;
  const freshReview=!!row.phases?.some(p=>p.phase==='review'&&p.receipt?.terminalReceipt?.success===true)&&
    Array.isArray(row.qualityReview?.findings)&&row.minimumStandard?.reviewEvidenceValid===true;
  const unresolved=counts.critical+counts.high+counts.medium>0;
  const qualified=checksPassed&&freshReview&&row.qualityReview.approved===true&&row.minimumStandard?.passed===true&&!unresolved&&row.semanticReview==='passed';
  const blocker=executionBlocker(row);
  const band=qualified?'quality-passed':unresolved?'quality-open':blocker?'not-completed':checksPassed?'checks-only':'not-accepted';
  return {band,qualified,checksPassed,freshReview,findings:counts,blocker,
    sameMinimumOnly:qualified,securityAudit:'not-measured',productionIntegration:'not-measured',generalQualityEquivalence:'not-demonstrated'};
}

