import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveProgramCommand} from '@vpr/runtime';
const archive=resolve(process.argv[2]),pnpm=await resolveProgramCommand('pnpm');assert.ok(pnpm);
const root=await mkdtemp(join(tmpdir(),'vpr-pnpm-install-'));
try{
 await writeFile(join(root,'package.json'),JSON.stringify({name:'vpr-pnpm-archive-proof',private:true,packageManager:'pnpm@11.1.2'}));
 const call=args=>execFileSync(pnpm.program,[...pnpm.prefix,'--dir',root,...args],{cwd:root,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:2097152});
 call(['add','--ignore-scripts',archive]);
 const result=JSON.parse(call(['exec','vpr','tools','doctor','--project',root]));assert.equal(result.inferenceTokens,0);
 const plugin=call(['exec','vpr','plugin','path']).trim(),manifest=JSON.parse(await readFile(join(plugin,'.claude-plugin/plugin.json'),'utf8'));assert.equal(manifest.name,'vertical-pair-router');
 console.log(JSON.stringify({passed:true,platform:process.platform,version:manifest.version,checks:['pnpm-archive-install','installed-vpr-bin','plugin-root-resolution'],inferenceTokens:0}));
}finally{
 const local=relative(await realpath(tmpdir()),await realpath(root));assert.ok(local&&!local.startsWith('..')&&!/^[a-z]:/iu.test(local));await rm(root,{recursive:true,force:true});
}
