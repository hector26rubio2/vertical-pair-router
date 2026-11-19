import { mkdir, readFile, writeFile, access, realpath,appendFile } from 'node:fs/promises';
import { join,resolve,dirname } from 'node:path';
import { homedir } from 'node:os';
import type { ProjectProfileV1 } from '@vpr/config';
import { resolveExecutable,resolveProgramCommand } from '@vpr/runtime';
import { createSafeProcessRunner } from '@vpr/quality';
import {localToolPaths} from './local-tools-command.js';
import {allowedProjectPath} from '@vpr/runtime';
import {installArchify} from './archify-install.js';

export interface ProvisionReceipt { readonly integration: string; readonly state: 'ready' | 'disabled' | 'unavailable'; readonly detail: string }
export async function provisionProject(root: string, profile: ProjectProfileV1): Promise<readonly ProvisionReceipt[]> {
  const enabled = profile.setup?.integrations;
  if (!enabled) return [];
  const results: ProvisionReceipt[] = [];
  const tools=await localToolPaths();
  const git=await resolveExecutable('git');
  if(git){
    const run=createSafeProcessRunner([git]);
    const top=await run({program:git,args:['rev-parse','--show-toplevel'],cwd:root,timeoutMs:5000,maxOutputBytes:65536});
    if(top.exitCode===0&&resolve(top.stdout.trim()).toLowerCase()===resolve(root).toLowerCase()){
      const location=await run({program:git,args:['rev-parse','--git-path','info/exclude'],cwd:root,timeoutMs:5000,maxOutputBytes:65536});
      const common=await run({program:git,args:['rev-parse','--git-common-dir'],cwd:root,timeoutMs:5000,maxOutputBytes:65536});
      if(location.exitCode===0&&common.exitCode===0){
        const path=resolve(root,location.stdout.trim()),metadataRoot=resolve(root,common.stdout.trim());
        if(await allowedProjectPath(metadataRoot,path,['.'])){
          const content=await readFile(path,'utf8').catch(()=> '');
          const missing=['/.vpr/graphify/','/.vpr/runs/','/.vpr/benchmarks/','/.vpr/usage/','/.vpr/native-run.lock'].filter(pattern=>!content.split(/\r?\n/u).includes(pattern));
          if(missing.length){await mkdir(dirname(path),{recursive:true});await appendFile(path,'\n'+missing.join('\n')+'\n');}
        }
      }
    }
  }
  async function execute(program: string, args: readonly string[]): Promise<void> {
    const result = await createSafeProcessRunner([program])({ program, args, cwd: root, timeoutMs: 120_000, maxOutputBytes: 1_048_576 });
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error('Integration command failed: ' + program + ' ' + args.join(' '));
  }
  if (enabled.husky) {
    const manager = profile.packageManager;
    if (!['pnpm', 'npm', 'yarn'].includes(manager)) {
      results.push({ integration: 'husky', state: 'unavailable', detail: 'Husky requires a supported Node package manager; no hooks were changed' });
    } else {
      const git=await resolveExecutable('git');
      const probe=git?await createSafeProcessRunner([git])({program:git,args:['rev-parse','--show-toplevel'],cwd:root,timeoutMs:5000,maxOutputBytes:65536}):null;
      const hookConfig=git&&probe?.exitCode===0?await createSafeProcessRunner([git])({program:git,args:['config','--get','core.hooksPath'],cwd:root,timeoutMs:5000,maxOutputBytes:65536}):null;
      const existingHooks=hookConfig?.exitCode===0?hookConfig.stdout.trim():'';
      const ownRoot=await realpath(root),gitRoot=probe?.stdout.trim();
      const sameRoot=gitRoot&&(process.platform==='win32'?gitRoot.toLowerCase().replaceAll('\\','/')===ownRoot.toLowerCase().replaceAll('\\','/'):gitRoot===ownRoot);
      if(!probe||probe.exitCode!==0||probe.timedOut||probe.outputTruncated||!sameRoot){
        results.push({integration:'husky',state:'unavailable',detail:'Initialize a Git repository before configuring Husky; no hooks changed'});
      }else if(existingHooks&&!['.husky','.husky/_'].includes(existingHooks.replaceAll('\\','/'))){
        results.push({integration:'husky',state:'unavailable',detail:'Existing core.hooksPath preserved; review hook integration manually'});
      }else{
      const executable = await resolveProgramCommand(manager);
      if (!executable) throw new Error('Package manager executable unavailable: ' + manager);
      const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (!metadata.devDependencies?.husky && !metadata.dependencies?.husky) {
        await execute(executable.program,[...executable.prefix,...(manager === 'npm' ? ['install', '--save-dev', '--save-exact', 'husky@9.1.7'] : ['add', '--dev', '--exact', 'husky@9.1.7'])]);
      }
      await execute(executable.program,[...executable.prefix,...(manager === 'npm' ? ['exec', '--', 'husky'] : ['exec', 'husky'])]);
      if(!await allowedProjectPath(root,'.husky',['.']))throw new Error('Husky directory escapes project through a link');
      await mkdir(join(root, '.husky'), { recursive: true });
      const hook = join(root, '.husky', 'pre-commit');
      let scanner='';
      for(const source of [new URL('../hooks/lib/staged-security.mjs',import.meta.url),new URL('../plugin/hooks/lib/staged-security.mjs',import.meta.url),new URL('../../quality/src/staged-security.mjs',import.meta.url)])try{scanner=await readFile(source,'utf8');break;}catch{}
      if(!scanner)throw new Error('Packaged staged security scanner unavailable');
      scanner+='\nprocess.exitCode=securityMain();\n';
      const scannerPath=join(root,'.husky','vpr-security.mjs');
      if(await exists(scannerPath)&&await readFile(scannerPath,'utf8')!==scanner)throw new Error('Existing security scanner preserved; review its update manually');
      if(!await exists(scannerPath))await writeFile(scannerPath,scanner,{flag:'wx'});
      const command = metadata.scripts?.check ? 'check' : metadata.scripts?.test ? 'test' : null;
      const original=await exists(hook)?await readFile(hook,'utf8'):command?`${manager} run ${command}\n`:'';
      const gate='NODE_OPTIONS= NODE_PATH= node .husky/vpr-security.mjs || exit $?';
      if(!original.includes(gate))await writeFile(hook,gate+'\n'+original);
      results.push({ integration: 'husky', state: 'ready', detail: 'Staged security gate installed before existing checks; appsettings/environment require owner approval and detected secrets always block' });
      }
    }
  } else results.push({ integration: 'husky', state: 'disabled', detail: 'Not selected' });
  if (enabled.graphify) {
    const graphify = tools.graphify;
    if (!(await exists(graphify))) {
      const uv = await resolveExecutable('uv');
      if (!uv) {
        results.push({ integration: 'graphify', state: 'unavailable', detail: 'Install uv first, then retry provisioning' });
      } else {
        await execute(uv, ['tool', 'install', 'graphifyy==0.9.106']);
      }
    }
    if (await exists(graphify)){
      await execute(graphify,['extract',root,'--code-only','--no-cluster','--max-workers','2','--out',join(root,'.vpr','graphify')]);
      results.push({ integration: 'graphify', state: 'ready', detail: 'Code-only local index created without a model; query it with vpr tools query' });
    }
    else if(!results.some(result=>result.integration==='graphify'))results.push({integration:'graphify',state:'unavailable',detail:'Installation returned without a usable executable; check uv tool PATH or VPR_GRAPHIFY_EXECUTABLE'});
  } else results.push({ integration: 'graphify', state: 'disabled', detail: 'Not selected' });
  if (enabled.archify) {
    let script = tools.archify;
    if(!await exists(script)&&!process.env.VPR_ARCHIFY_HOME){const installed=await installArchify();if(installed)script=join(installed,'archify','bin','archify.mjs');}
    if (await exists(script)) {
      await execute(process.execPath, [script, 'doctor']);
      results.push({ integration: 'archify', state: 'ready', detail: 'Local Archify skill passed doctor' });
    } else results.push({ integration: 'archify', state: 'unavailable', detail: 'Git is required for the pinned Archify installation, or configure an existing VPR_ARCHIFY_HOME' });
  } else results.push({ integration: 'archify', state: 'disabled', detail: 'Not selected' });
  return results;
}
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
