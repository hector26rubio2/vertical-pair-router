import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {CliIo} from './cli.js';
type Result={code:number;stdout:string;stderr:string};
interface Services{run:(args:readonly string[])=>Promise<Result>;catalog:(root:string)=>Promise<unknown>;}
const parse=(value:string)=>{try{return JSON.parse(value);}catch{return null;}};
const ownCatalog=(value:any)=>value?.name==='vpr-local'&&Array.isArray(value.plugins)&&value.plugins.length===1&&value.plugins[0]?.name==='vertical-pair-router';

/** Move only VPR's single-plugin catalog when npm/pnpm changes its location. */
export async function installPlugin(executable:string,root:string,io:CliIo,services?:Services){
  const run=services?.run??(async(args:readonly string[]):Promise<Result>=>{
    try{const result=await promisify(execFile)(executable,[...args],{windowsHide:true,timeout:120000,maxBuffer:1048576});return {code:0,stdout:result.stdout,stderr:result.stderr};}
    catch(error){const e=error as Error&{code?:number;stdout?:string;stderr?:string};return {code:typeof e.code==='number'?e.code:1,stdout:e.stdout??'',stderr:e.stderr??'Native plugin management did not complete'};}
  });
  const catalog=services?.catalog??(async(path:string)=>JSON.parse(await readFile(join(path,'.claude-plugin/marketplace.json'),'utf8')));
  if(!ownCatalog(await catalog(root)))throw Error('Packaged VPR catalog is not the expected single-plugin distribution');
  const install=(path:string)=>run(['plugin','install','vertical-pair-router','--marketplace',path,'--scope','user','--json']);
  let result=await install(root);
  if(parse(result.stdout)?.failureCode==='name_taken'){
    const locations=parse((await run(['plugin','marketplace','list','--json'])).stdout),installed=parse((await run(['plugin','list','--json'])).stdout);
    const previous=Array.isArray(locations)?locations.find(item=>item.name==='vpr-local'&&item.source==='directory'):null;
    const others=Array.isArray(installed)?installed.filter(item=>typeof item.id==='string'&&item.id.endsWith('@vpr-local')&&item.id!=='vertical-pair-router@vpr-local'):null;
    if(previous&&typeof previous.path==='string'&&others?.length===0&&ownCatalog(await catalog(previous.path))){
      const removed=await run(['plugin','marketplace','remove','vpr-local','--json']);
      if(removed.code===0){
        result=await install(root);
        if(result.code!==0){const restored=await install(previous.path);io.stderr(restored.code===0?'VPR: previous local registration restored after installation failed.\n':'VPR: registration needs recovery; project files were not modified.\n');}
      }else result=removed;
    }else io.stderr('VPR preserved a shared or unrecognized catalog. Review its source before replacing it.\n');
  }
  if(result.stdout)io.stdout(result.stdout);if(result.code!==0&&result.stderr)io.stderr(result.stderr);return result.code;
}
