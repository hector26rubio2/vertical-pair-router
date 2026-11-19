const e=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const money=value=>value==null?'N/D':value.toFixed(8);
const palette=['#198266','#336dc4','#8855b4','#b4761c','#d45467','#3a8f9d'];
export const phaseLabel=value=>({'architecture':'Arquitectura','technical-plan':'Plan técnico','plan':'Análisis y plan','implement':'Ejecución','repair':'Corrección','review':'Revisión común'})[value]??value;
export function costAllocation(row,kind='model'){
  if(row.receipt?.completeAccounting!==true||row.completeModelAccounting===false||!row.totalCost)return {available:false,reason:'No se calculan porcentajes: falta contabilidad completa.'};
  const parts=kind==='phase'?(row.phaseCosts??[]).map(p=>({label:phaseLabel(p.phase)+' · '+p.model,min:p.totalCost?.min,max:p.totalCost?.max})):(row.models??[]).map(m=>({label:m.model+' · '+m.role,min:m.cost?.totalUsd?.min,max:m.cost?.totalUsd?.max}));
  if(!parts.length||parts.some(p=>!Number.isFinite(p.max)||!Number.isFinite(p.min)||p.max<0))return {available:false,reason:'No se midieron costos completos por fase; no se reparten por estimación.'};
  const total=parts.reduce((sum,p)=>sum+p.max,0);
  if(total<=0||Math.abs(total-row.totalCost.max)>1e-8)return {available:false,reason:'Los componentes no concilian con el total; no se dibuja la distribución.'};
  return {available:true,total,parts:parts.map(p=>({...p,share:100*p.max/total}))};
}
function pie(data,title){
  if(!data.available)return `<article class="chart-card"><h3>${e(title)}</h3><p>${e(data.reason)}</p></article>`;
  let offset=0;
  const arcs=data.parts.map((part,index)=>{const arc=`<circle cx="60" cy="60" r="44" pathLength="100" fill="none" stroke="${palette[index%palette.length]}" stroke-width="22" stroke-dasharray="${part.share} ${100-part.share}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"><title>${e(part.label)}: ${part.share.toFixed(2)}%, USD ${money(part.max)}</title></circle>`;offset+=part.share;return arc;}).join('');
  return `<article class="chart-card"><h3>${e(title)}</h3><div class="pie-layout"><svg viewBox="0 0 120 120" role="img" aria-label="${e(title)} · reparto del costo de una ejecución">${arcs}<text x="60" y="58" text-anchor="middle" font-size="9" fill="#243d53">USD</text><text x="60" y="71" text-anchor="middle" font-size="10" fill="#243d53">${data.total.toFixed(5)}</text></svg><ul>${data.parts.map((p,i)=>`<li><i style="background:${palette[i%palette.length]}"></i>${e(p.label)}<small>${p.share.toFixed(2)}% · USD ${money(p.min)}${p.max!==p.min?'–'+money(p.max):''}</small></li>`).join('')}</ul></div></article>`;
}
export function allocationPanel(task,rows,armLabel){
  return `<div class="allocation-panel"><h3>Tortas · quién consumió el costo de cada ejecución</h3><p>Selecciona una ejecución. Las tortas no mezclan tareas: usan el extremo superior del rango y sólo datos que concilian con el total.</p><label>Ejecución <select class="allocation-selector" data-task="${e(task.id)}">${rows.map((r,i)=>`<option value="${i}">${e(armLabel(r.arm))}</option>`).join('')}</select></label>${rows.map((row,index)=>`<div class="allocation-pair" data-cost-allocation data-task="${e(task.id)}" data-index="${index}" ${index?'hidden':''}>${pie(costAllocation(row),'USD por modelo')}${pie(costAllocation(row,'phase'),'USD por fase')}</div>`).join('')}</div>`;
}

export function measuredCoverage(tasks,rows){
  const arms=['haiku-solo','sonnet-solo','opus-solo','sonnet-haiku','opus-haiku','opus-sonnet-haiku'];
  return {arms,tasks:tasks.map(task=>({id:task.id,name:task.name,level:task.level,protocol:task.protocol??'native-legacy',cells:arms.map(arm=>{
    const samples=rows.filter(r=>r.taskId===task.id&&(r.strategyArm??r.arm).replace(/-(?:attempt|repeat)-\d+$/u,'').replace(/-reviewed$/u,'')===arm);
    return {arm,attempts:samples.length,minimumPassed:samples.filter(r=>r.minimumStandard?.passed===true).length,accepted:samples.filter(r=>r.status==='accepted').length};
  })}))};
}
export function coveragePanel(tasks,rows,armLabel){
  const data=measuredCoverage(tasks,rows);
  return `<section id="coverage"><h2>Cobertura real por tarea, nivel y combinación</h2><p>Verde: cumple el mínimo nuevo (checks + revisión fresca verificable). Azul: aceptación del contrato anterior; no equivale al nuevo mínimo. Rojo: intentos sin aceptación. Gris: no ejecutado. Cada fila conserva su protocolo; no se mezclan mediciones antiguas con revisión nueva.</p><div class="table"><table class="coverage-table"><thead><tr><th>Tarea y nivel</th>${data.arms.map(arm=>`<th>${e(armLabel(arm))}</th>`).join('')}</tr></thead><tbody>${data.tasks.map(t=>`<tr><th><a href="#case-${e(t.id.toLowerCase())}">${e(t.id)} · ${e(t.name)}</a><small>${e(t.level)} · ${e(t.protocol)}</small></th>${t.cells.map(c=>`<td class="coverage-${!c.attempts?'missing':c.minimumPassed?'passed':c.accepted?'legacy':'failed'}">${!c.attempts?'No probado':c.minimumPassed?'Mínimo: '+c.minimumPassed+'/'+c.attempts:c.accepted?'Contrato: '+c.accepted+'/'+c.attempts:'Sin aceptación: 0/'+c.attempts}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>La triple combinación no se declara mejor por tener más modelos. Sólo puede recomendarse para el contrato medido si cumple los gates y mejora costo/tiempo frente a las alternativas comparables. Una muestra no demuestra rendimiento general.</p></section>`;
}
