import {access,mkdir,mkdtemp,realpath,readFile,rename,rm} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {createSafeProcessRunner} from '@vpr/quality';
import {resolveExecutable} from '@vpr/runtime';

export const archifyRevision='c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de';
export const managedArchifyRoot=()=>join(homedir(),'.vpr','tools','archify-'+archifyRevision);

/** Explicit init selection authorizes this fixed upstream installation, never latest. */
export async function installArchify():Promise<string|null>{
  if(process.env.VPR_ARCHIFY_HOME)return null;
  const git=await resolveExecutable('git');if(!git)return null;
  const base=join(homedir(),'.vpr','tools');await mkdir(base,{recursive:true});
  const canonical=await realpath(base),target=join(canonical,'archify-'+archifyRevision);
  try{await access(join(target,'archify','bin','archify.mjs'));return target;}catch{}
  const temporary=await mkdtemp(join(canonical,'.archify-install-'));
  const run=createSafeProcessRunner([git]);
  async function command(args:readonly string[]){
    const result=await run({program:git!,args:['-c','core.hooksPath='+join(temporary,'.no-hooks'),'-c','protocol.file.allow=never','-c','protocol.ext.allow=never',...args],cwd:temporary,timeoutMs:120000,maxOutputBytes:1048576});
    if(result.exitCode!==0||result.timedOut||result.outputTruncated)throw Error('Pinned Archify installation did not complete');
    return result.stdout.trim();
  }
  try{
    await command(['init','--quiet']);
    await command(['fetch','--depth','1','https://github.com/tt-a1i/archify.git',archifyRevision]);
    await command(['checkout','--detach',archifyRevision]);
    if(await command(['rev-parse','HEAD'])!==archifyRevision)throw Error('Archify revision mismatch');
    const metadata=JSON.parse(await readFile(join(temporary,'archify','package.json'),'utf8'));
    if(metadata.version!=='2.16.0'||metadata.license!=='MIT')throw Error('Archify release metadata mismatch');
    await access(join(temporary,'archify','bin','archify.mjs'));
    await rename(temporary,target);
    return target;
  }finally{
    if(dirname(temporary)!==canonical||!basename(temporary).startsWith('.archify-install-'))throw Error('Archify cleanup escaped staging directory');
    await rm(temporary,{recursive:true,force:true});
  }
}
