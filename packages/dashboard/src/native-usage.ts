const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value:unknown,keys:readonly string[])=>object(value)?Object.fromEntries(keys.filter(key=>value[key]===null||['string','boolean'].includes(typeof value[key])||typeof value[key]==='number'&&Number.isFinite(value[key])).map(key=>[key,value[key]])):{};
/** An explicit DTO: no prompts, answers, credential objects or arbitrary fields. */
export function nativeUsageView(value:unknown){
  const report=object(value)?value:{};
  const groups=(Array.isArray(report.groups)?report.groups:[]).slice(0,2000).map(row=>fields(row,['accountKey','provider','model','modelVerification','calls','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','inputSemantics','inputTotal','totalTokens','usdMin','usdMax','countersComplete','costComplete']));
  const records=(Array.isArray(report.records)?report.records:[]).slice(0,1000).map(row=>({...fields(row,['accountKey','provider','model','modelVerification','sessionId','parentSessionId','task','role','agent','at','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','inputSemantics','complete','wallMs']),cost:object(row)?fields(row.cost,['min','max','basis']):{}}));
  const quotas=(Array.isArray(report.quotas)?report.quotas:[]).slice(0,30).map(row=>({...fields(row,['provider','accountKey','observedAt']),windows:object(row)&&Array.isArray(row.windows)?row.windows.slice(0,10).map(window=>fields(window,['kind','remainingPercent','resetsAt'])):[]}));
  return {groups,records,quotas,recordCount:typeof report.recordCount==='number'?report.recordCount:null,sessionCount:typeof report.sessionCount==='number'?report.sessionCount:null,scanTruncated:report.scanTruncated===true,detailsTruncated:report.detailsTruncated===true,inferenceTokens:0,coverage:'Sólo sesiones registradas localmente por VPR. USD de referencia; no factura ni cuota deducida de tokens.'};
}

export function nativeUsageScript(){return `
const nativeRoot=document.createElement('section');
const nativeTitle=document.createElement('h2');nativeTitle.textContent='Consumo nativo · esta máquina';
const nativeInfo=document.createElement('p');nativeInfo.textContent='Ver modelos, fases, caché y USD observados. Lectura local: 0 tokens de modelo. Las cuentas se mantienen separadas.';
const nativeRefresh=document.createElement('button');nativeRefresh.textContent='Actualizar consumo nativo';
const nativeMode=document.createElement('select');
for(const [value,label]of [['model','Por cuenta y modelo'],['execution','Por ejecución y fase']]){const option=document.createElement('option');option.value=value;option.textContent=label;nativeMode.append(option);}
const nativeOutput=document.createElement('div');nativeOutput.style.overflowX='auto';
nativeRoot.append(nativeTitle,nativeInfo,nativeRefresh,nativeMode,nativeOutput);document.querySelector('main').append(nativeRoot);
let nativeData;
function renderNativeUsage(){
 nativeOutput.replaceChildren();if(!nativeData)return;
 const detail=nativeMode.value==='execution',table=document.createElement('table'),head=document.createElement('tr');
 for(const label of ['Cuenta local','Proveedor','Modelo / tarea','Rol / fase','Entrada sin caché','Input total','Salida','Caché leída','Caché escrita','Total tokens','USD referencia','Hasta recibo · ms']){const cell=document.createElement('th');cell.textContent=label;head.append(cell);}table.append(head);
 for(const row of detail?nativeData.records:nativeData.groups){
  const tr=document.createElement('tr'),known=(detail?row.complete:row.countersComplete)&&row.inputSemantics==='uncached'&&[row.inputTokens,row.outputTokens,row.cacheReadTokens,row.cacheWriteTokens].every(Number.isSafeInteger);
  const input=known?row.inputTokens+row.cacheReadTokens+row.cacheWriteTokens:null,total=known?input+row.outputTokens:null;
  const cost=detail?row.cost:row.costComplete?{min:row.usdMin,max:row.usdMax}:null;
  const values=[row.accountKey?row.accountKey.slice(0,12):'Sin atribuir',row.provider,row.model+(row.modelVerification==='requested-only'?' (solicitado; precio condicional)':'')+(detail?' · '+(row.task||'sin título')+' · '+(row.sessionId||'').slice(0,10):''),detail?row.role:'Agregado por modelo',row.inputTokens,input,row.outputTokens,row.cacheReadTokens,row.cacheWriteTokens,total,cost&&Number.isFinite(cost.min)&&Number.isFinite(cost.max)?cost.min.toFixed(8)+(cost.max!==cost.min?'–'+cost.max.toFixed(8):''):'N/D',detail?row.wallMs:null];
  for(const value of values){const cell=document.createElement('td');cell.textContent=value==null?'N/D':String(value);tr.append(cell);}table.append(tr);
 }
 nativeOutput.append(table);if(!(detail?nativeData.records:nativeData.groups).length)nativeOutput.append('Sin registros observados; no equivale a consumo cero.');
}
nativeMode.addEventListener('change',renderNativeUsage);
nativeRefresh.addEventListener('click',async()=>{
 nativeRefresh.disabled=true;
 try{const response=await fetch('/api/native-usage',{headers:authHeaders});if(!response.ok)throw Error('Registro nativo no disponible');nativeData=await response.json();
 nativeInfo.textContent=nativeData.coverage+' Registros: '+nativeData.recordCount+' · sesiones: '+nativeData.sessionCount+(nativeData.scanTruncated?' · acumulado parcial':'')+(nativeData.detailsTruncated?' · se muestran las 1.000 ejecuciones más recientes':'');
 const windows=nativeData.quotas.flatMap(q=>q.windows.map(w=>q.provider+' '+q.accountKey.slice(0,12)+' · '+w.kind+': '+w.remainingPercent+'% restante (lectura '+q.observedAt+')'));nativeInfo.textContent+=' Cuota: '+(windows.join(' · ')||'no disponible; no se estima desde tokens.');renderNativeUsage();
 }catch{nativeInfo.textContent='Registro nativo no disponible. No se supone consumo cero.';}finally{nativeRefresh.disabled=false;}
});
`;}
