import {readFile,realpath,mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const validated=new Map();
export async function prepareGuardedClaude(executable,args){
  let plugin=null;
  for(const candidate of [new URL('../hooks/lib/context-guard-plugin',import.meta.url),new URL('../plugin/hooks/lib/context-guard-plugin',import.meta.url),new URL('../../../hooks/lib/context-guard-plugin',import.meta.url)]){
    try{await readFile(new URL(candidate.href+'/hooks/guard-module.js'));plugin=await realpath(fileURLToPath(candidate));break;}catch{}
  }
  if(!plugin)throw Error('Native context guard package unavailable');
  const names=['.claude-plugin/plugin.json','hooks/hooks.json','hooks/guard-module.js','hooks/haiku-context.js','hooks/haiku-http-guard.js'];
  const files=await Promise.all(names.map(async name=>({name,bytes:await readFile(join(plugin,name))})));
  const buildHash=createHash('sha256').update(Buffer.concat(files.flatMap(file=>[Buffer.from(file.name),file.bytes]))).digest('hex');
  const base=join(homedir(),'.vpr','context-guards');await mkdir(base,{recursive:true,mode:0o700});
  const cacheRoot=await realpath(base),target=join(cacheRoot,buildHash);
  try{await readFile(join(target,'hooks/hooks.json'));}catch{
    const temporary=await mkdtemp(join(cacheRoot,'.pending-'));
    if(dirname(await realpath(temporary))!==cacheRoot)throw Error('Unexpected guard staging directory');
    try{
      await mkdir(join(temporary,'.claude-plugin'));await mkdir(join(temporary,'hooks'));
      for(const file of files)await writeFile(join(temporary,file.name),file.bytes,{flag:'wx',mode:0o444});
      try{await rename(temporary,target);}catch(error){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;}
    }finally{if(dirname(temporary)!==cacheRoot||!basename(temporary).startsWith('.pending-'))throw Error('Guard cleanup escaped cache');await rm(temporary,{recursive:true,force:true});}
  }
  for(const file of files)if(!file.bytes.equals(await readFile(join(target,file.name))))throw Error('Cached native guard integrity mismatch');
  plugin=target;
  const env={...process.env,CLAUDE_CODE_DISABLE_ADVISOR_TOOL:'1',CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:'90'};
  for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY'])delete env[key];
  const key=executable+'|'+buildHash;
  if(!validated.has(key))validated.set(key,(async()=>{
    const response=await promisify(execFile)(executable,['plugin','validate',plugin,'--strict','--json'],{env,windowsHide:true,timeout:20000,maxBuffer:1048576});
    const result=JSON.parse(response.stdout);
    const hooks=result.contents?.flatMap(content=>content.gatingHooks??[])??[];
    if(!result.success||!hooks.some(hook=>hook.hook==='http.fetch'&&hook.hasCatch))throw Error('Native pre-request guard was not validated');
  })());
  await validated.get(key);
  // Workers need the minimal guard, not a second copy of VPR's command/usage
  // hooks. Other owner plugins, permissions and managed settings are preserved.
  const enabledPlugins={'vpr-context-guard@inline':true,'vertical-pair-router@vpr-local':false,'vertical-pair-router@inline':false,'vertical-pair-router@skills-dir':false};
  return {args:[...args,'--plugin-dir',plugin,'--settings',JSON.stringify({enabledPlugins,modelSettings:{'claude-haiku-5-5':{autoCompactWindow:100000}}})],env,policy:'provider-preflight-90k/native-window-100k',buildHash,plugin};
}
