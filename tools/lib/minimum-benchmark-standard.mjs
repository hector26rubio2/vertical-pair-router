import {readFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
export async function minimumBenchmarkStandard(row,task){
  const reasons=[];
  if(row.receipt?.completeAccounting!==true)reasons.push('Contabilidad incompleta');
  if(row.receipt?.terminalReceipt?.success!==true||row.delegationVerified!==true)reasons.push('Fases incompletas o modelos no comprobados');
  if(row.checks?.external?.exitCode!==0||row.checks.external.passed!==task.testCount)reasons.push('No aprobó todos los criterios externos');
  if(task.executionRole==='coding'&&(row.checks?.own?.exitCode!==0||row.checks.own.testExitCode!==0||row.checks.own.passed<12))reasons.push('Compilación o regresiones sin aprobar');
  if(row.allowedChanges===false||row.acceptanceUnchanged===false)reasons.push('Cambios fuera del alcance o pruebas alteradas');
  else if(row.allowedChanges!==true||row.acceptanceUnchanged!==true)reasons.push('No se verificó el alcance de cambios ni la integridad de las pruebas');
  const review=row.qualityReview;
  if(!review||review.approved!==true||!Array.isArray(review.findings))reasons.push('Sin aprobación de revisión fresca');
  if(review?.findings?.some(f=>['critical','high'].includes(f.severity)))reasons.push('Hallazgos críticos o altos sin resolver');
  let reviewEvidenceValid=!!review&&Array.isArray(review.findings);
  for(const finding of review?.findings??[]){
    if(typeof finding.path!=='string'||isAbsolute(finding.path)||finding.path.split(/[\\/]/u).includes('..')||!Number.isInteger(finding.line)||finding.line<1||typeof finding.quote!=='string'||finding.quote.trim().length<8||finding.quote.length>180){reviewEvidenceValid=false;continue;}
    const content=await readFile(join(row.project,finding.path),'utf8').catch(()=>null);
    if(content===null||!content.split(/\r?\n/u)[finding.line-1]?.includes(finding.quote))reviewEvidenceValid=false;
  }
  if(review&&!reviewEvidenceValid)reasons.push('Citas de la revisión no verificables');
  return {passed:reasons.length===0,reasons,reviewEvidenceValid,scope:'Contrato acotado y revisión por modelo; no garantiza corrección general ni integración real de la base de datos.'};
}
