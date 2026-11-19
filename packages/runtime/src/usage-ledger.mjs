import {mkdir,readFile,readdir,writeFile,link,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const usageDirectory=()=>join(process.env.VPR_USAGE_HOME||join(homedir(),'.vpr'),'usage');
const hash=value=>createHash('sha256').update(value).digest('hex');
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
/** Identity is used in memory only; the local salt is not an authentication credential. */
export async function accountKey(provider,identity){
  if(typeof identity!=='string'||!identity)return null;
  const directory=usageDirectory();await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'salt');let salt;
  try{salt=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;try{await writeFile(path,randomUUID(),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}salt=await readFile(path,'utf8');}
  return hash(provider+'|'+salt+'|'+identity);
}
/** Immutable call records. Exclusive creation deduplicates concurrent replay. */
export async function recordUsage(input){
  if(!['claude','codex','copilot'].includes(input.provider)||typeof input.sessionId!=='string'||typeof input.id!=='string'||typeof input.model!=='string'||!/^[-\w./:]{1,100}$/u.test(input.model))throw Error('Invalid usage metadata');
  const directory=join(usageDirectory(),'records');await mkdir(directory,{recursive:true,mode:0o700});
  const row={schemaVersion:1,id:hash(input.provider+'|'+input.sessionId+'|'+input.id),provider:input.provider,
    sessionId:hash(input.sessionId),parentSessionId:typeof input.parentSessionId==='string'?hash(input.parentSessionId):null,
    accountKey:typeof input.accountKey==='string'&&/^[a-f0-9]{64}$/u.test(input.accountKey)?input.accountKey:null,
    model:input.model,agent:typeof input.agent==='string'?input.agent.slice(0,100):'main',role:['plan','technical-plan','implement','repair','review','inventory','main','subagent'].includes(input.role)?input.role:'unattributed',wallMs:count(input.wallMs),
    task:typeof input.task==='string'?input.task.slice(0,120):null,
    inputTokens:count(input.inputTokens),outputTokens:count(input.outputTokens),cacheReadTokens:count(input.cacheReadTokens),cacheWriteTokens:count(input.cacheWriteTokens),
    inputSemantics:input.inputSemantics==='uncached'?'uncached':'provider-unspecified',
    reportedAiCredits:input.provider==='copilot'&&typeof input.reportedAiCredits==='number'&&Number.isFinite(input.reportedAiCredits)&&input.reportedAiCredits>=0?input.reportedAiCredits:null,
    modelVerification:input.modelIdentity==='requested-only'?'requested-only':'native-reported',
    cost:input.cost&&Number.isFinite(input.cost.min)&&input.cost.min>=0&&Number.isFinite(input.cost.max)&&input.cost.max>=input.cost.min?{min:input.cost.min,max:input.cost.max,basis:input.cost.basis==='provider-reported'?'provider-reported':'official-reference'}:null,
    complete:input.complete===true,at:typeof input.at==='string'&&Number.isFinite(Date.parse(input.at))?input.at:new Date().toISOString()};
  const path=join(directory,row.id+'.json'),temporary=path+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(row),{mode:0o600,flag:'wx'});
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;return JSON.parse(await readFile(path,'utf8'));}finally{await unlink(temporary);}
  return row;
}
export async function readUsage({sessionId,account,scope='session',detail=false}={}){
  const directory=join(usageDirectory(),'records');let names=[];try{names=await readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
  const session=sessionId?hash(sessionId):null;
  if(scope==='session'&&!session)return {scope,rows:[],reason:'Session ID required',inferenceTokens:0};
  if(scope==='account'&&!account)return {scope,rows:[],reason:'Account identity unavailable; no accounts were combined',inferenceTokens:0};
  const sources=names.filter(name=>/^[a-f0-9]{64}\.json$/u.test(name)),scanTruncated=sources.length>100000;
  const rows=[];for(const name of sources.slice(0,100000)){
    let row;try{row=JSON.parse(await readFile(join(directory,name),'utf8'));}catch{continue;}
    if(row.schemaVersion!==1||!['claude','codex','copilot'].includes(row.provider))continue;
    if(scope==='session'&&row.sessionId!==session&&row.parentSessionId!==session)continue;
    if(scope==='account'&&(!account||row.accountKey!==account))continue;
    rows.push(row);
  }
  rows.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
  const groups=[];for(const row of rows){let group=groups.find(item=>item.provider===row.provider&&item.model===row.model&&item.accountKey===row.accountKey);if(!group){group={provider:row.provider,model:row.model,accountKey:row.accountKey,calls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,inputSemantics:'uncached',modelVerification:'native-reported',usdMin:0,usdMax:0,costComplete:true,countersComplete:true};groups.push(group);}group.calls++;if(row.modelVerification!=='native-reported')group.modelVerification='requested-only';
    for(const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']){if(count(row[key])===null)group.countersComplete=false;else group[key]+=row[key];}
    if(row.inputSemantics!=='uncached')group.inputSemantics='provider-unspecified';
    if(row.cost){group.usdMin+=row.cost.min;group.usdMax+=row.cost.max;}else group.costComplete=false;
    if(!row.complete)group.countersComplete=false;
  }
  for(const group of groups){if(scanTruncated){group.countersComplete=false;group.costComplete=false;}group.inputTotal=group.countersComplete&&group.inputSemantics==='uncached'?group.inputTokens+group.cacheReadTokens+group.cacheWriteTokens:null;group.totalTokens=group.inputTotal===null?null:group.inputTotal+group.outputTokens;}
  let quotaKeys=[];try{quotaKeys=(await readdir(join(usageDirectory(),'accounts'))).filter(name=>/^[a-f0-9]{64}\.json$/u.test(name)).map(name=>name.slice(0,-5));}catch{}
  const relevant=new Set([...rows.map(row=>row.accountKey),account].filter(Boolean));
  const quotas=(await Promise.all(quotaKeys.filter(key=>scope==='machine'||relevant.has(key)).map(readAccountObservation))).filter(Boolean);
  return {scope,groups,recordCount:rows.length,sessionCount:new Set(rows.map(row=>row.sessionId)).size,unattributedAccounts:rows.some(row=>!row.accountKey),scanTruncated,
    quotas,
    ...(detail?{records:rows.slice(0,1000),detailsTruncated:rows.length>1000}:{}),
    coverage:'Only locally recorded VPR sessions; provider account quota is separate and may include other machines',inferenceTokens:0};
}
export function formatUsage(report){
  const lines=['VPR · uso observado · '+report.scope,'Cuenta local | Proveedor | Modelo | Entrada | Salida | Caché leída | Caché escrita | Total tokens | USD'];
  if(!(report.groups??[]).length)lines.push('Sin registros medidos para este filtro; no significa consumo cero.');
  for(const row of report.groups??[])lines.push([row.accountKey?.slice(0,12)??'sin atribuir',row.provider,row.model+(row.modelVerification==='requested-only'?' (solicitado; costo condicional)':''),...['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].map(key=>(row.countersComplete?'':'≥')+row[key]),row.totalTokens??'N/D',row.costComplete?row.usdMin.toFixed(6)+(row.usdMax!==row.usdMin?'–'+row.usdMax.toFixed(6):''):'no disponible'].join(' | '));
  if(report.records)for(const row of report.records){const total=row.complete&&row.inputSemantics==='uncached'&&[row.inputTokens,row.outputTokens,row.cacheReadTokens,row.cacheWriteTokens].every(Number.isSafeInteger)?[row.inputTokens,row.outputTokens,row.cacheReadTokens,row.cacheWriteTokens].reduce((sum,value)=>sum+(value??0),0):null;lines.push([row.at,'sesión '+row.sessionId.slice(0,12),row.task??'tarea sin título',row.provider,row.model,row.role,row.agent,'entrada sin caché '+(row.inputTokens??'N/D'),'salida '+(row.outputTokens??'N/D'),'caché leída '+(row.cacheReadTokens??'N/D'),'caché escrita '+(row.cacheWriteTokens??'N/D'),'total '+(total??'N/D'),'USD '+(row.cost?row.cost.min.toFixed(8)+(row.cost.max!==row.cost.min?'–'+row.cost.max.toFixed(8):''):'N/D'),'hasta recibo '+(row.wallMs??'N/D')+' ms'].join(' | '));}
  if(report.scanTruncated)lines.push('Lectura limitada a 100.000 registros: los acumulados son parciales y el total completo es N/D.');
  for(const quota of report.quotas??[])for(const window of quota.windows)lines.push('Cuota '+quota.provider+' · cuenta '+quota.accountKey.slice(0,12)+' · '+window.kind+': '+window.remainingPercent+'% restante · lectura '+quota.observedAt);
  lines.push(report.reason??'Desglose de sesiones registradas por VPR en esta máquina; la cuota global del proveedor es independiente.', 'USD de referencia/estimación del host; no factura de suscripción.','Lectura local: 0 tokens de inferencia. Los datos ausentes no son consumo cero.');return lines.join('\n');
}
export async function recordAccountObservation(input){
  if(!['claude','codex','copilot'].includes(input.provider)||typeof input.accountKey!=='string'||!/^[a-f0-9]{64}$/u.test(input.accountKey))return;
  const directory=join(usageDirectory(),'accounts');await mkdir(directory,{recursive:true,mode:0o700});
  const windows=(Array.isArray(input.windows)?input.windows:[]).slice(0,10).filter(w=>typeof w.kind==='string'&&/^[a-zA-Z0-9_-]{1,80}$/u.test(w.kind)&&typeof w.percentUsed==='number'&&Number.isFinite(w.percentUsed)&&w.percentUsed>=0&&Number.isFinite(Date.parse(w.resetsAt))).map(w=>({kind:w.kind,percentUsed:w.percentUsed,remainingPercent:Math.max(0,100-w.percentUsed),resetsAt:w.resetsAt}));
  const c=input.context??{};const row={provider:input.provider,accountKey:input.accountKey,observedAt:new Date().toISOString(),windows,context:{tokens:count(c.tokens),window:count(c.window),percent:typeof c.percent==='number'&&Number.isFinite(c.percent)?c.percent:null},source:'provider-reported'};
  await writeFile(join(directory,input.accountKey+'.json'),JSON.stringify(row),{mode:0o600});
}
export async function readAccountObservation(key){
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/u.test(key))return null;
  try{const row=JSON.parse(await readFile(join(usageDirectory(),'accounts',key+'.json'),'utf8'));const age=Date.now()-Date.parse(row.observedAt);if(!Number.isFinite(age)||age<0||age>300000)return null;return {...row,windows:row.windows.filter(w=>Date.parse(w.resetsAt)>Date.now())};}catch{return null;}
}
export function claudeReferenceCost(model,u,catalog){
  if(!catalog||Date.parse(catalog.expiresAt)<Date.now())return null;
  if(!['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].every(key=>count(u[key])!==null))return null;
  const input=u.input_tokens+u.cache_read_input_tokens+u.cache_creation_input_tokens;
  const tier=catalog.cards.find(card=>card.model===model)?.tiers.find(tier=>tier.maxPromptTokens==null||input<=tier.maxPromptTokens);if(!tier)return null;
  const base=(u.input_tokens*tier.input+u.output_tokens*tier.output+u.cache_read_input_tokens*tier.cacheRead)/1e6;
  return {min:base+u.cache_creation_input_tokens*tier.cacheWrite5m/1e6,max:base+u.cache_creation_input_tokens*tier.cacheWrite1h/1e6,basis:'official-reference'};
}
