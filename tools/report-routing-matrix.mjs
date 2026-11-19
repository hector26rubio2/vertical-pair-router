import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { officialCostBreakdown } from './lib/official-cost-breakdown.mjs';
import {codexReferenceCost} from './lib/codex-reference-cost.mjs';
import { scenarioComparisonTable } from './lib/scenario-comparison-table.mjs';
import { benchmarkDashboard } from './lib/benchmark-dashboard.mjs';
import { contextEvidence } from './lib/benchmark-analysis.mjs';
const at = process.argv.indexOf('--report');
if (at < 0 || !process.argv[at + 1]) throw new Error('--report <report.json> required');
const path = resolve(process.argv[at + 1]);
const report = JSON.parse(await readFile(path, 'utf8'));
const currentPrices=JSON.parse(await readFile('docs/research/model-price-catalog.json','utf8'));
const openaiPrices=JSON.parse(await readFile('docs/research/openai-model-price-catalog.json','utf8'));
const outputAt = process.argv.indexOf('--output');
const output = outputAt < 0 ? dirname(path) : resolve(process.argv[outputAt + 1]);
await mkdir(output, { recursive: true });
const sources = [path];
for (let index = 0; index < process.argv.length; index++) if (process.argv[index] === '--additional') {
  const source=resolve(process.argv[index+1]),additional=JSON.parse(await readFile(source,'utf8'));sources.push(source);
  for(const task of additional.tasks)if(!report.tasks.some(value=>value.id===task.id))report.tasks.push(task);
  for(const row of additional.rows){
    const normalized={...row,evidenceSource:source,observedAt:row.startedAt??row.observedAt??additional.at};
    if(row.totals)normalized.receipt={...row.receipt,totals:row.totals};
    if(row.codexReceipt?.durationMs)normalized.receipt={...normalized.receipt,timings:{...normalized.receipt.timings,childForegroundSpanMs:row.codexReceipt.durationMs}};
    if(report.rows.some(value=>value.taskId===row.taskId&&value.arm===row.arm))normalized.arm=row.arm+'-attempt-'+(report.rows.filter(value=>value.taskId===row.taskId&&value.arm.startsWith(row.arm)).length+1);
    report.rows.push(normalized);
  }
}
let inventoryAcceptanceHash;
for (let index = 0; index < process.argv.length; index++) if (process.argv[index] === '--inventory') {
  const summaryPath = resolve(process.argv[index + 1]);
  const previous = JSON.parse(await readFile(summaryPath, 'utf8'));
  if (previous.task?.id !== 'P01' || !Array.isArray(previous.rows)) throw new Error('Expected an inventory pilot summary');
  if (typeof previous.sameAcceptanceHash !== 'string' || (inventoryAcceptanceHash && inventoryAcceptanceHash !== previous.sameAcceptanceHash)) throw new Error('Inventory acceptance contracts differ; cannot combine them');
  inventoryAcceptanceHash = previous.sameAcceptanceHash;
  sources.push(summaryPath);
  if (!report.tasks.some(task => task.id === 'P01')) report.tasks.push({ id: 'P01', name: previous.task.title, level: previous.task.level,
    requirement: previous.task.externalAcceptance.join('; '), testCount: previous.task.externalAcceptance.length,
    classification: previous.task.levelSource });
  for (const row of previous.rows) {
    const family = model => model.replace('claude-', '').replace(/-\d.*$/u,'');
    const arm = row.coordinatorModel ? `${family(row.coordinatorModel)}-${family(row.executorModel)}` : `${family(row.executorModel)}-solo`;
    if (report.rows.some(value => value.taskId === 'P01' && value.arm === arm)) throw new Error('Duplicate inventory arm');
    report.rows.push({ taskId: 'P01', arm, acceptanceHash:previous.sameAcceptanceHash, observedAt: previous.at, evidenceSource: summaryPath, retries: row.retries,
      coordinatorModel: row.coordinatorModel, executorModel: row.executorModel, status: row.accepted ? 'accepted' : 'incomplete',
      models: row.models, totalCost: row.costs.totalUsd, delegationVerified: row.accepted,
      receipt: { totals: row.totals, completeAccounting: row.accepted, timings: {
        wallMs: row.timings.modelSessionsWallMs, childForegroundSpanMs: row.timings.foregroundWorkerSpanMs,
        mainOutsideChildSpanMs: row.timings.mainOutsideWorkerSpanMs } },
      localChecksTotalMs:row.timings.localChecksMs,checks: { own: row.finalChecks.own, external: row.finalChecks.acceptance } });
  }
}
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = value => value === null || value === undefined ? 'N/D' : Number(value).toLocaleString('es-CO');
const usd = value => !value ? 'N/D' : Math.abs(value.min - value.max) < 1e-10 ? value.min.toFixed(8) : `${value.min.toFixed(8)}–${value.max.toFixed(8)}`;
const short = model => model?.replace('claude-', '') ?? '—';
const armLabel=id=>{
  const attempt=id.match(/-(?:attempt|repeat)-(\d+)$/u),base=id.replace(/-(?:attempt|repeat)-\d+$/u,'');
  const label=({'haiku-solo':'Haiku solo','sonnet-solo':'Sonnet solo','opus-solo':'Opus solo','sonnet-haiku':'Sonnet → Haiku','haiku-sonnet':'Haiku → Sonnet','opus-haiku':'Opus → Haiku','haiku-codex-terra':'Haiku → Codex Terra','opus-codex-terra':'Opus → Codex Terra'})[base]??base;
  if(base.endsWith('-reviewed')){
    const recipe=base.slice(0,-9),cross=recipe.match(/^(sonnet|opus)-codex-(terra|sol)$/u);
    const readable=cross?cross[1][0].toUpperCase()+cross[1].slice(1)+' → Codex '+cross[2][0].toUpperCase()+cross[2].slice(1):recipe.replace('-solo','').split('-').map(name=>name[0].toUpperCase()+name.slice(1)).join(' → ');
    return readable+' + revisión común Sonnet'+(attempt?' · intento '+attempt[1]:'');
  }
  const readable=label.replace(/^(sonnet|haiku|opus)-codex-(.+)$/u,(_,planner,model)=>planner[0].toUpperCase()+planner.slice(1)+' → Codex GPT-'+model);
  return readable+(attempt?' · '+(id.includes('-repeat-')?'repetición ':'intento ')+attempt[1]:'');
};
const priceCodex=model=>codexReferenceCost({input_tokens:model.inputTokens+model.cacheReadTokens+model.cacheWriteTokens,cached_input_tokens:model.cacheReadTokens,cache_write_input_tokens:model.cacheWriteTokens,output_tokens:model.outputTokens},model.model,openaiPrices)?.cost??null;
const sumCosts=models=>models.length&&models.every(m=>m.cost)?{min:models.reduce((s,m)=>s+m.cost.totalUsd.min,0),max:models.reduce((s,m)=>s+m.cost.totalUsd.max,0)}:null;
for(const row of report.rows)if(row.receipt?.requests){
  row.phaseCosts=(row.phaseCosts??[]).map(phase=>{
    const models=(phase.models??[]).map(model=>({...model,cost:model.model.startsWith('claude-')?officialCostBreakdown(model,phase.receipt?.requests??[],currentPrices):model.provider==='codex'?priceCodex(model):model.cost}));
    return {...phase,models,totalCost:phase.receipt?.completeAccounting?sumCosts(models):null};
  });
  row.models=row.models.map(model=>{
    if(model.provider==='codex'){
      const phases=row.phaseCosts.flatMap(phase=>phase.models.filter(m=>m.model===model.model));
      const valid=phases.length&&phases.every(m=>m.cost);
      const cost=valid?{...phases[0].cost,...Object.fromEntries(['inputUsd','outputUsd','cacheReadUsd','cacheWriteUsd','totalUsd'].map(key=>[key,{min:phases.reduce((s,m)=>s+m.cost[key].min,0),max:phases.reduce((s,m)=>s+m.cost[key].max,0)}])),unknownContextTier:phases.some(m=>m.cost.unknownContextTier),contextPromptUpperBound:Math.max(...phases.map(m=>m.cost.contextPromptUpperBound??0))||null}:priceCodex(model);
      return {...model,cost};
    }
    if(!model.model.startsWith('claude-'))return model;
    const requests=row.receipt.requests.filter(request=>request.model===model.model);
    return {...model,cost:officialCostBreakdown(model,row.receipt.requests,currentPrices),
      maxObservedPromptTokens:requests.length?Math.max(...requests.map(request=>request.inputTokens+request.cacheReadTokens+request.cacheWriteTokens)):null};
  });
  row.observedModelCost=row.models.length&&row.models.every(model=>model.cost)?{min:row.models.reduce((s,m)=>s+m.cost.totalUsd.min,0),max:row.models.reduce((s,m)=>s+m.cost.totalUsd.max,0)}:null;
  const expected=row.requiredModelIds??[row.coordinatorModel,row.executorModel].filter(Boolean);
  row.completeModelAccounting=row.receipt?.completeAccounting===true&&expected.every(id=>row.models.some(model=>model.model===id));
  row.totalCost=row.completeModelAccounting?row.observedModelCost:null;
}
const descriptions = {
  T01: 'Crear una función que limpie espacios en códigos de producto, convierta a minúsculas y rechace valores que no sean texto. Se comprueban espacios, tabulaciones, texto vacío y acentos.',
  T02: 'Ordenar tareas respetando sus dependencias y el orden de entrada. Detectar dependencias inexistentes, identificadores duplicados y ciclos. Conservar la entrada original.',
  T03: 'Crear un planificador por tandas con límite de capacidad, dependencias y conflictos entre rutas de archivos. Evitar ejecutar juntas tareas incompatibles, rechazar ciclos y conservar la entrada.',
  P01: 'Desarrollar reservas de inventario HTTP con persistencia SQLite. Verificar que repetir una solicitud no descuente dos veces, que las peticiones simultáneas sean correctas y que los datos sobrevivan al reinicio.'
};
Object.assign(descriptions,{
  W01:'Resolver un conflicto de dos ramas conservando descuentos y cálculo de impuestos con centavos enteros. Se verifican redondeo, validación y eliminación de marcadores de conflicto.',
  W02:'Analizar una solicitud de invitaciones con decisiones abiertas, delimitar el alcance y detallar tareas, dependencias y aceptación. La validación es una lista de criterios estructurados; no sustituye revisión humana de requerimientos libres.',
  W03:'Diagnosticar por qué una suma concatena cadenas. Entregar reproducción, causa y propuesta de corrección sin modificar producción.',
  W04:'Aplicar la corrección al carrito, añadir validación y pruebas de regresión, manteniendo la entrada original.',
  W05:'Crear la configuración inicial de un proyecto Node sin descargar dependencias: configuración de puerto, entorno, script de pruebas y formato. No evalúa instalación de Husky, Graphify ni servicios externos.',
  W06:'Separar un módulo de facturación, dinero, libro de movimientos y CSV en módulos, conservando importaciones y comportamiento. Es una prueba estructural acotada; queda pendiente un refactor pesado en un repositorio de tamaño real.',
  W07:'Reconstruir el flujo HTTP→servicio→repositorio, identificar una consulta SQL insegura y proponer tareas sin editar producción. Se valida evidencia concreta y estructura; no es una auditoría general de seguridad.',
  W08:'Añadir una caché LRU con capacidad acotada. Comprobar menos llamadas al cargador, expulsión correcta, caché de valores vacíos y manejo de errores.'
});
descriptions.P02='Refactorizar el servidor real del dashboard VPR: extraer presentación y helpers HTTP/seguridad en dos módulos nuevos, reducir server.ts al menos 40%, conservar exportaciones y aprobar compilación y las pruebas originales sin modificarlas. Las copias parten de una instantánea congelada; el dashboard de trabajo no se cambia.';
descriptions.R01='Revisar una función sintética de reservas de inventario suministrada en la solicitud: detectar cantidad inválida, descuento duplicado por ID repetido y modificación de stock al rechazar una reserva. Se exige identificar tres defectos y evitar dos falsos positivos. Es revisión con lista de criterios, sin herramientas de archivos ni implementación; no prueba una auditoría abierta.';
descriptions.F01='Investigar una instantánea real de Finanzas (Angular, API .NET/PostgreSQL e importador Python) y convertir la solicitud existente de importación JSON en un plan de desarrollo full stack. Distinguir código existente y propuesta; justificar riesgos con citas exactas, detallar tareas por capa, dependencias, decisiones, migración, rollback y pruebas. No implementa la feature. Las ocho comprobaciones automáticas validan el artefacto y sus citas; la calidad del diseño necesita revisión semántica.';
descriptions.F01B=descriptions.F01+' Nueva serie: roles separados por fases y la MISMA revisión fresca Sonnet incluida en el costo de todas las recetas. No mezclar causalmente con F01: cambian el protocolo y los límites por fase.';
descriptions.F02='Corregir en el frontend Angular real la importación de movimientos: cuenta y signo en duplicados, cambio de cuenta en vista previa, identidad estable de filas y reintentos tras fallos parciales sin reenviar éxitos. Se conserva el contrato API y máximo cuatro peticiones. Se exige compilar toda la aplicación, preservar 12 regresiones, aprobar nueve pruebas externas y pasar revisión fresca del diff. Usa API simulada: no prueba persistencia ni atomicidad de PostgreSQL.';
const comparisons = report.tasks.map(task => {
  const rows = report.rows.filter(row => row.taskId === task.id);
  const strategy=row=>row.strategyArm??row.arm.replace(/-(?:attempt|repeat)-\d+$/u,'');
  const strategies=[...new Set(rows.map(strategy))].map(arm=>{
    const samples=rows.filter(row=>strategy(row)===arm),accepted=samples.filter(row=>row.status==='accepted').length;
    const complete=samples.every(row=>(!row.semanticReview||row.semanticReview==='passed')&&row.totalCost&&row.receipt?.completeAccounting&&row.models.every(model=>!model.cost?.modelIdentityCaveat));
    return {arm,samples:samples.length,accepted,qualityRate:accepted/samples.length,
      totalCost:accepted&&complete?{min:samples.reduce((sum,row)=>sum+row.totalCost.min,0)/accepted,max:samples.reduce((sum,row)=>sum+row.totalCost.max,0)/accepted}:null};
  });
  const baseline = strategies.find(row => row.arm === 'sonnet-solo' && row.accepted);
  const sonnetHaiku = strategies.find(row=>row.arm==='sonnet-haiku'&&row.accepted);
  const best = strategies.filter(row => row.accepted && row.qualityRate>=.8 && row.totalCost).sort((a,b) => a.totalCost.max-b.totalCost.max)[0];
  const light = strategies.find(row=>row.arm==='haiku-solo'&&row.accepted);
  const opus = strategies.find(row => row.arm === 'opus-solo' && row.accepted);
  const opusHaiku = strategies.find(row => row.arm === 'opus-haiku' && row.accepted);
  const compare = (a,b) => a?.totalCost && b?.totalCost ? { min: 100*(1-b.totalCost.max/a.totalCost.min), max: 100*(1-b.totalCost.min/a.totalCost.max) } : null;
  return { taskId: task.id, accepted: rows.filter(row => row.status === 'accepted').length, attempted: rows.length, cheapestAccepted: best?.arm ?? null,strategies,
    savingAgainstSonnetPercent: compare(baseline,best), opusDelegationSavingPercent: compare(opus,opusHaiku),
    sonnetDelegationSavingPercent:compare(baseline,sonnetHaiku),
    planningOverheadVsHaikuPercent: light?.totalCost&&opusHaiku?.totalCost ? {min:100*(opusHaiku.totalCost.min/light.totalCost.max-1),max:100*(opusHaiku.totalCost.max/light.totalCost.min-1)}:null };
});
const costs = report.rows.filter(row => row.totalCost).map(row => row.totalCost);
const knownModelCosts = report.rows.flatMap(row=>row.models.map(model=>model.cost?.totalUsd).filter(Boolean));
const summary = { source: path, sources, at: new Date().toISOString(), tasks: report.tasks, comparisons, repetitions: report.repetitions,
  totalObservedTokens: report.rows.reduce((sum,row) => sum+(row.receipt?.totals.totalTokens??0),0),
  totalReferenceUsd: { min: costs.reduce((sum,cost) => sum+cost.min,0), max: costs.reduce((sum,cost) => sum+cost.max,0) },
  totalKnownModelReferenceUsd: {min:knownModelCosts.reduce((sum,cost)=>sum+cost.min,0),max:knownModelCosts.reduce((sum,cost)=>sum+cost.max,0)},
  hasIncompleteAccounting:report.rows.some(row=>!row.receipt?.completeAccounting||row.totalCost===null),
  unmeteredFailures: report.rows.filter(row => !row.receipt?.completeAccounting).map(row => `${row.taskId}/${row.arm}`),
  pendingCombinations: report.tasks.filter(task=>task.id.startsWith('T')).flatMap(task => ['sonnet-solo','haiku-solo','sonnet-haiku','haiku-sonnet',...(task.id==='T03'?['opus-solo','opus-haiku']:[])].filter(arm=>!report.rows.some(row=>row.taskId===task.id&&row.arm===arm&&row.status==='accepted')).map(arm=>`${task.id}/${arm}`)),
  failedOrIncomplete:report.rows.filter(row=>row.status!=='accepted').map(row=>({taskId:row.taskId,arm:row.arm,cost:row.totalCost})),
  unpricedExecutions:report.rows.filter(row=>!row.totalCost).map(row=>`${row.taskId}/${row.arm}`),
  warning: 'One attempt per row, including explicit repetitions; rotated order does not remove cache effects. Inventory includes earlier evidence from a different date and fixed order. Official API reference is not subscription billing or a measure of subscription duration. Controlled delegation is not autonomous optimal routing.' };
const comparisonTable = scenarioComparisonTable({tasks: report.tasks, rows: report.rows, descriptions, armLabel});
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
await writeFile(join(output,'data.json'),JSON.stringify({ ...report, sources },null,2)+'\n');
// Flat export keeps individual models separate from the execution TOTAL.
const columns=['taskId','task','level','taskDescription','execution','role','model','status','inputUncached','inputTotal','output','cacheRead','cacheWrite','totalTokens','inputUsdMin','inputUsdMax','outputUsdMin','outputUsdMax','cacheReadUsdMin','cacheReadUsdMax','cacheWriteUsdMin','cacheWriteUsdMax','usdMin','usdMax','contextMaxObserved','contextUpperBound','promptCoverage','modelPriceConditional','semanticReview','artifactChecksPassed','artifactChecksTotal','executionWallMs','checksMs','source'];
const flat=[];
for(const row of report.rows){
  const task=report.tasks.find(task=>task.id===row.taskId);
  const common={taskId:task.id,task:task.name,level:task.level,taskDescription:descriptions[task.id]??task.requirement,execution:armLabel(row.arm),status:row.status,semanticReview:row.semanticReview??'not-measured',artifactChecksPassed:row.checks?.external?.passed,artifactChecksTotal:task.testCount,executionWallMs:row.receipt?.timings.wallMs,checksMs:row.localChecksTotalMs??((row.checks?.own?.durationMs??0)+(row.checks?.external?.durationMs??0)),source:row.sourceReport??row.evidenceSource??path};
  const counts=(model,cost)=>({inputUncached:model?.inputTokens,inputTotal:model?model.inputTokens+model.cacheReadTokens+model.cacheWriteTokens:null,output:model?.outputTokens,cacheRead:model?.cacheReadTokens,cacheWrite:model?.cacheWriteTokens,totalTokens:model?.totalTokens,usdMin:cost?.min,usdMax:cost?.max});
  for(const model of row.models){
    const context=contextEvidence(row,model),categoryCosts=Object.fromEntries(['input','output','cacheRead','cacheWrite'].flatMap(category=>[[''+category+'UsdMin',model.cost?.[category+'Usd']?.min],[''+category+'UsdMax',model.cost?.[category+'Usd']?.max]]));
    flat.push({...common,role:model.role,model:model.model,...counts(model,model.cost?.totalUsd),...categoryCosts,contextMaxObserved:context.observedMax,contextUpperBound:context.upperBound,promptCoverage:context.completePromptCoverage,modelPriceConditional:!!model.cost?.modelIdentityCaveat});
  }
  flat.push({...common,role:'TOTAL',model:'TOTAL',...counts(row.receipt?.totals,row.totalCost)});
}
const csvCell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
await writeFile(join(output,'ejecuciones.csv'),'\uFEFF'+[columns,...flat.map(row=>columns.map(column=>row[column]))].map(row=>row.map(csvCell).join(',')).join('\n')+'\n');
const caseAt=process.argv.indexOf('--case-library');
if(caseAt>=0){
  const libraryPath=resolve(process.argv[caseAt+1]);let existing=[];
  try{existing=JSON.parse(await readFile(libraryPath,'utf8')).rows;if(!Array.isArray(existing))throw Error('Invalid case library');}catch(error){if(error.code!=='ENOENT')throw error;}
  const prices=JSON.parse(await readFile('docs/research/model-price-catalog.json','utf8'));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const cases=report.rows.flatMap(row=>{
    const task=report.tasks.find(task=>task.id===row.taskId),wanted=[row.coordinatorModel,row.executorModel].filter(Boolean);
    if(['pending','reviewed-draft'].includes(row.semanticReview)||!row.totalCost||!row.receipt?.completeAccounting||row.models.some(model=>!model.model.startsWith('claude-')||model.cost?.modelIdentityCaveat||(model.model.includes('haiku')&&model.maxObservedPromptTokens>=90000))||!wanted.every(id=>row.models.some(model=>model.model===id)))return [];
    return [{caseId:hash((row.evidenceSource??path)+'|'+row.taskId+'|'+row.arm),taskKind:task.kind??'feature',taskSignature:hash(task.requirement+'|'+(row.acceptanceHash??'')),
      executionRole:row.executionRole??'coding',complexity:task.level.includes('complejo')?'complex':task.level==='simple'?'simple':'normal',risk:task.level==='simple'?'low':'medium',
      plannerId:row.coordinatorModel??null,technicalPlannerId:row.technicalPlannerModel??null,reviewerId:row.reviewerModel??null,executorId:row.executorModel,plannerProvider:row.coordinatorModel?'claude':null,executorProvider:'claude',plannerEffort:row.coordinatorModel?'medium':undefined,executorEffort:'medium',effortVerification:'requested-only',
      technicalPlannerProvider:row.technicalPlannerModel?'claude':null,technicalPlannerEffort:row.technicalPlannerModel?'medium':undefined,reviewerProvider:row.reviewerModel?'claude':null,reviewerEffort:row.reviewerModel?'medium':undefined,
      accepted:row.status==='accepted'&&(!row.semanticReview||row.semanticReview==='passed')&&(!row.minimumStandard||row.minimumStandard.passed)&&!row.qualityReview?.findings?.some(f=>['critical','high','medium'].includes(f.severity)),modelConfirmed:true,completeAccounting:true,usdMax:row.totalCost.max,pricesExpireAt:prices.expiresAt,
      source:row.evidenceSource??path,classificationSource:'manual bounded benchmark; match task signature before comparison'}];
  });
  const byId=new Map([...existing,...cases].map(row=>[row.caseId,row]));await mkdir(dirname(libraryPath),{recursive:true});await writeFile(libraryPath,JSON.stringify({schemaVersion:1,rows:[...byId.values()]},null,2)+'\n');
}
const routingPanel=`<section id="routing"><h2>Cómo se filtra y se elige la ruta</h2>
<p>La selección local no llama a un modelo. La dificultad y el riesgo se reciben de la tarea; las fichas documentadas orientan los candidatos y los resultados medidos permiten comparar el costo del flujo completo.</p>
<ol><li>Intersección de proveedores autorizados por el proyecto y el perfil global.</li><li>Sesión nativa disponible en esta máquina y modelos habilitados para esa cuenta. Los modelos no verificados se distinguen de los listados por el proveedor.</li><li>Esfuerzo admitido, rol configurado y permisos de la fase: plan/revisión sin escritura; implementación con checks.</li><li>Cuota conocida: se excluye un límite global alcanzado. Una cuota ausente o vencida permanece desconocida; no se calcula desde los tokens.</li><li>Complejidad, riesgo y casos locales del mismo contrato y rol. La comparación económica requiere evidencia suficiente para las alternativas.</li><li>Ejecución directa, o planificación → implementación → revisión. Un solo ejecutor por defecto; los errores y los checks fallidos detienen el flujo y conservan el consumo.</li></ol>
<table><thead><tr><th>Entorno autorizado y conectado</th><th>Candidatos iniciales configurables</th><th>Resultado del filtro</th></tr></thead><tbody>
<tr><td>Sólo Claude</td><td>Haiku, Sonnet, Opus</td><td>Se usan los roles de Claude. El acceso a cada modelo se comprueba al ejecutarlo.</td></tr>
<tr><td>Codex disponible</td><td>Luna, Terra, Sol</td><td>Sólo modelos/esfuerzos listados. La capacidad de editar se valida con los checks; listar un modelo no la demuestra.</td></tr>
<tr><td>Copilot disponible</td><td>Modelos que devuelve el SDK nativo</td><td>Se excluyen modelos deshabilitados, no configurados y fuentes BYOK o no atribuidas.</td></tr>
<tr><td>Varios proveedores</td><td>Unión de los anteriores autorizados</td><td>Se comparan por rol y evidencia; no se abren varios agentes por tener varios proveedores.</td></tr>
<tr><td>Ningún proveedor permitido y autenticado</td><td>Ninguno</td><td>Bloqueado antes de gastar tokens de modelo.</td></tr></tbody></table>
<p>Los dólares son referencia de modelos; los porcentajes de suscripción son lecturas separadas del proveedor. El desglose de <code>vpr use</code> cubre sesiones registradas localmente, no todas las máquinas de la cuenta.</p></section>`;
let profile = null;
try { profile = JSON.parse(await readFile('.vpr/profile.json','utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let campaign = null;
try { campaign = JSON.parse(await readFile(join(output,'finanzas-campaign.json'),'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
const dashboard = benchmarkDashboard({report, descriptions, armLabel, comparisonTable, routingPanel, summary, profile, campaign, claudePrices: currentPrices,openaiPrices});
await writeFile(join(output,'analysis.json'),JSON.stringify({at:summary.at, tasks:dashboard.analyses},null,2)+'\n');
await writeFile(join(output,'informe.html'),dashboard.html);
console.log(JSON.stringify({report:join(output,'informe.html'), tasks:report.tasks.length, executions:report.rows.length, totalReferenceUsd:summary.totalReferenceUsd}));
