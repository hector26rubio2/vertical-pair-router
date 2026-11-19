import {access,readFile,realpath,stat,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {resolveExecutable,allowedProjectPath} from '@vpr/runtime';
import {createSafeProcessRunner} from '@vpr/quality';
import type {CliIo} from './cli.js';
import {managedArchifyRoot} from './archify-install.js';

export async function localToolPaths(){
  const graphify=process.env.VPR_GRAPHIFY_EXECUTABLE??await resolveExecutable('graphify')??join(homedir(),'.local','bin',process.platform==='win32'?'graphify.exe':'graphify');
  const existing=join(homedir(),'.agents','skills','archify');
  const archify=join(process.env.VPR_ARCHIFY_HOME??(await exists(join(existing,'bin','archify.mjs'))?existing:join(managedArchifyRoot(),'archify')),'bin','archify.mjs');
  return {graphify,archify};
}
async function exists(path:string){try{await access(path);return true;}catch{return false;}}
export async function runLocalToolsCommand(args:readonly string[],io:CliIo,signal?:AbortSignal):Promise<number>{
  const flag=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const root=await realpath(resolve(flag('--project')??process.cwd()));
  const paths=await localToolPaths();
  const graph=join(root,'.vpr','graphify','graphify-out','graph.json');
  if(args[0]==='doctor'){
    io.stdout(JSON.stringify({project:root,graphify:{available:await exists(paths.graphify),graphAvailable:await exists(graph)},archify:{available:await exists(paths.archify)},inferenceTokens:0})+'\n');return 0;
  }
  let program:string,argv:string[];
  if(args[0]==='graph'){
    program=paths.graphify;argv=['extract',root,'--code-only','--no-cluster','--max-workers','2','--out',join(root,'.vpr','graphify')];
  }else if(args[0]==='query'){
    const question=flag('--question');
    if(!question?.trim()||question.length>2000)throw new TypeError('Query requires --question (1–2000 characters)');
    if(!await exists(graph)){io.stdout(JSON.stringify({state:'unavailable',reason:'Run vpr tools graph first',inferenceTokens:0})+'\n');return 3;}
    program=paths.graphify;argv=['query',question,'--budget','1200','--depth','2','--graph',graph];
  }else if(args[0]==='diagram'){
    const type=flag('--type'),input=flag('--input'),out=flag('--out');
    if(!type||!['architecture','workflow','sequence','dataflow','lifecycle'].includes(type)||!input||!out)throw new TypeError('diagram requires --type, --input and --out');
    const candidate=await realpath(resolve(root,input)),output=resolve(root,out);
    const escapes=(path:string)=>isAbsolute(path)||path==='..'||path.startsWith('..\\')||path.startsWith('../');
    if(escapes(relative(root,output)))throw new TypeError('Diagram output must stay inside project');
    if(!await allowedProjectPath(root,output,['.']))throw new TypeError('Diagram output escapes project through a link');
    if(await exists(output)&&!args.includes('--replace'))throw new Error('Output exists; inspect it before using --replace');
    if((await stat(candidate)).size>1_048_576)throw new Error('Diagram specification exceeds 1 MiB');
    JSON.parse(await readFile(candidate,'utf8'));
    await mkdir(resolve(output,'..'),{recursive:true});
    if(escapes(relative(root,await realpath(resolve(output,'..')))))throw new TypeError('Diagram output parent escapes project');
    if(!await exists(paths.archify)){io.stdout(JSON.stringify({state:'unavailable',reason:'Install Archify or set VPR_ARCHIFY_HOME',inferenceTokens:0})+'\n');return 3;}
    program=process.execPath;argv=[paths.archify,'deliver',type,candidate,output,'--quality','showcase','--json'];
  }else{io.stderr('Usage: vpr tools <doctor|graph|query|diagram> --project <path> [options]\n');return 2;}
  if(!await exists(program)){io.stdout(JSON.stringify({state:'unavailable',reason:'Local tool is not installed; run init provisioning',inferenceTokens:0})+'\n');return 3;}
  const result=await createSafeProcessRunner([program])({program,args:argv,cwd:root,timeoutMs:120000,maxOutputBytes:1_048_576,...(signal?{signal}:{})});
  io.stdout(JSON.stringify({state:result.exitCode===0&&!result.timedOut&&!result.outputTruncated?'ready':'failed',command:args[0],exitCode:result.exitCode,timedOut:result.timedOut,outputTruncated:result.outputTruncated,stdout:result.stdout,stderr:result.stderr,inferenceTokens:0})+'\n');
  return result.exitCode===0&&!result.timedOut&&!result.outputTruncated?0:3;
}
