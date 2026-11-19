import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {resolveProgramCommand} from './package-manager.js';
test('package-manager JS entry fallback preserves argument boundaries without a shell',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-manager-path-'));context.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'node_modules/pnpm/bin'),{recursive:true});
  await writeFile(join(root,'node_modules/pnpm/bin/pnpm.cjs'),'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const command=await resolveProgramCommand('pnpm',{PATH:root,PATHEXT:'.EXE'});assert.ok(command);
  const text=execFileSync(command.program,[...command.prefix,'test','literal & value'],{encoding:'utf8',windowsHide:true});
  assert.deepEqual(JSON.parse(text),['test','literal & value']);
  assert.equal(await resolveProgramCommand('missing-project-command',{PATH:root}),null);
});
