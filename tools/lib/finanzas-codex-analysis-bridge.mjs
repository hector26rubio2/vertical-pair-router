import {spawn} from 'node:child_process';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute,relative} from 'node:path';
import {createInterface} from 'node:readline';
import {StringDecoder} from 'node:string_decoder';
import {parseAnalysisArtifact,analysisSchema} from './analysis-artifact-json.mjs';
const manifest=JSON.parse(await readFile(resolve(process.argv[process.argv.indexOf('--manifest')+1]),'utf8'));
const cwd=await realpath(manifest.project);
if(!isAbsolute(manifest.executable)||!isAbsolute(manifest.receipt)||!/^gpt-[\w.-]+$/u.test(manifest.model)||typeof manifest.authorization!=='string'||manifest.authorization!=='owner-authorized-native-read-only-finanzas-analysis')throw Error('Invalid authorized analysis manifest');
const outside=relative(cwd,manifest.receipt);if(outside&&!outside.startsWith('..')&&!isAbsolute(outside))throw Error('Receipt must be outside project');
const sourceManifest=JSON.parse(await readFile(join(cwd,'SOURCE-MANIFEST.json'),'utf8'));
let source='';
for(const file of sourceManifest.files){if(isAbsolute(file.path)||file.path.split(/[\\/]/u).includes('..'))throw Error('Unsafe source path');source+='\nFILE '+file.path+'\n'+(await readFile(join(cwd,file.path),'utf8')).split(/\r?\n/u).map((line,i)=>`${i+1}: ${line}`).join('\n')+'\nEND FILE\n';}
const contract=await readFile(join(cwd,'ANALYSIS-CONTRACT.txt'),'utf8');
if(Buffer.byteLength(source)>300000)throw Error('Bounded snapshot required');
let active,used=false,invalidCalls=0,stage='idle';
function stop(){if(!active?.pid)return;if(process.platform==='win32'){const k=spawn('taskkill.exe',['/PID',String(active.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.once('error',()=>active?.kill());}else{try{process.kill(-active.pid,'SIGTERM');}catch{active.kill();}}}
const reply=(id,result,error)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...(error?{error}:{result})})+'\n');
async function execute(plan){
  stage='prepare-schema';
  const start=performance.now(),env={...process.env};
  for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CODEX_APP_TOOLS_PIPE_PATH','CODEX_THREAD_ID','CODEX_SESSION_ID','CODEX_TOOL_CALL_ID','CODEX_INTERNAL_ORIGINATOR_OVERRIDE'])delete env[key];
  env.VPR_CAPTURE_DISABLED='1';
  const schemaPath=manifest.receipt+'.schema.json',answerPath=manifest.receipt+'.artifact.txt';
  await writeFile(schemaPath,JSON.stringify(analysisSchema));
  stage='spawn-native';
  const args=['--no-daemon','-a','never','exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--output-schema',schemaPath,'--output-last-message',answerPath,'-C',cwd,'-m',manifest.model,'-c','model_reasoning_effort="medium"','-c','features.multi_agent=false','-c','web_search="disabled"','-'];
  const child=spawn(manifest.executable,args,{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});active=child;
  let pending='',bytes=0,answer='',usage=null,complete=false,toolCalls=0,errorCount=0;
  const decoder=new StringDecoder('utf8');
  const observe=line=>{let e;try{e=JSON.parse(line);}catch{return;}if(e.type==='turn.completed'){usage=e.usage;complete=true;}if(e.type==='error'||e.type==='turn.failed')errorCount++;if(e.type==='item.completed'&&e.item?.type==='agent_message')answer=String(e.item.text??'');if(e.type==='item.completed'&&['command_execution','file_change'].includes(e.item?.type))toolCalls++;};
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4000000){stop();return;}pending+=decoder.write(chunk);const lines=pending.split(/\r?\n/u);pending=lines.pop()??'';for(const line of lines)observe(line);});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  const timer=setTimeout(stop,240000);
  const prompt=manifest.requirement+'\nYou are the read-only analysis executor. Source is provided below with original 1-based line numbers. Do not use tools, edit files, access network or delegate. Return the complete report as JSON only; the authorized local harness materializes this JSON as analysis/report.json. Do not claim to have edited files or implemented the feature.\nCONTRACT:\n'+contract+'\nORCHESTRATOR PLAN:\n'+plan+'\nFROZEN SOURCE:\n'+source;
  const exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);child.stdin.end(prompt);}).finally(()=>clearTimeout(timer));active=undefined;
  stage='parse-artifact';
  pending+=decoder.end();if(pending)observe(pending);
  let artifactValid=false;
  if(complete&&exitCode===0)try{const saved=await readFile(answerPath,'utf8').catch(()=>answer);const report=parseAnalysisArtifact(saved);if(report){await writeFile(join(cwd,'analysis/report.json'),JSON.stringify(report,null,2));artifactValid=true;}}catch{}
  const keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens'];
  const valid=usage&&keys.every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0)&&usage.cached_input_tokens+usage.cache_write_input_tokens<=usage.input_tokens;
  const receipt={provider:'codex',requestedModel:manifest.model,modelVerification:'requested-only',completed:complete&&exitCode===0&&!!valid,exitCode,usage:valid?usage:null,durationMs:Math.round(performance.now()-start),toolCalls,errorCount,artifactValid,outputProtocol:'json-schema-v2',preDispatchRejections:invalidCalls,answerCharacters:answer.length,delivery:'Full frozen source inline, unlike Claude file tools; comparison confounded by context delivery',generatedArtifactPersisted:true,rawContentPersisted:false};
  await writeFile(manifest.receipt,JSON.stringify(receipt,null,2));
  return {content:[{type:'text',text:JSON.stringify({...receipt,artifact:'analysis/report.json',note:'The local harness wrote the returned analysis artifact; Codex did not edit source.'})}],isError:!receipt.completed||!artifactValid};
}
const reader=createInterface({input:process.stdin});reader.on('close',stop);reader.on('line',async line=>{
  if(Buffer.byteLength(line)>65536)return;let q;try{q=JSON.parse(line);}catch{return;}if(q.id===undefined)return;
  try{
    if(q.method==='initialize')return reply(q.id,{protocolVersion:q.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'vpr-finanzas-native-analysis',version:'0.0.0'}});
    if(q.method==='ping')return reply(q.id,{});
    if(q.method==='tools/list')return reply(q.id,{tools:[{name:'execute',description:'Run ONE fixed native Codex read-only full-stack analysis on the owner-approved frozen snapshot. No implementation. Model fixed by manifest.',inputSchema:{type:'object',properties:{plan:{type:'string',minLength:20,maxLength:6000}},required:['plan'],additionalProperties:false}}]});
    if(q.method==='tools/call'){stage='validate-plan';const plan=q.params?.arguments?.plan;if(used||q.params?.name!=='execute')throw Error('Invalid call');if(typeof plan!=='string'||plan.length<20||plan.length>6000){invalidCalls++;const diagnostic={completed:false,stage,diagnostic:'invalid-plan-length',planType:typeof plan,planCharacters:typeof plan==='string'?plan.length:null,maxCharacters:6000,modelDispatched:false,correctionAllowed:invalidCalls===1};await writeFile(manifest.receipt,JSON.stringify(diagnostic));if(invalidCalls>1)used=true;return reply(q.id,{content:[{type:'text',text:JSON.stringify({...diagnostic,instruction:'No model has been dispatched. Shorten the plan to 20..6000 characters and correct the call once. Do not retry after model execution.'})}],isError:true});}used=true;return reply(q.id,await execute(plan));}
    reply(q.id,null,{code:-32601,message:'Unsupported method'});
  }catch(error){if(stage!=='validate-plan')await writeFile(manifest.receipt,JSON.stringify({completed:false,stage,diagnostic:error?.name??'Error',code:error?.code??null,modelDispatched:stage!=='prepare-schema'})).catch(()=>{});reply(q.id,null,{code:-32000,message:'Native analysis failed; no automatic retry. Inspect metadata receipt.'});}
});
