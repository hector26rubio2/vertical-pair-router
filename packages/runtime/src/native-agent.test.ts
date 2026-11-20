import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {allowedProjectPath,runNativeAgent} from './native-agent.js';
test('file permission checks refuse traversal and paths outside the declared implementation scope',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-native-path-'));context.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'src'));
  assert.equal(await allowedProjectPath(root,'src/new-file.ts',['src']),true);
  assert.equal(await allowedProjectPath(root,'test/acceptance.ts',['src']),false);
  assert.equal(await allowedProjectPath(root,'../escape.ts',['.']),false);
});
test('a pre-cancelled native request never resolves or starts a provider executable',async()=>{
  const controller=new AbortController();controller.abort();
  const result=await runNativeAgent({model:{id:'worker',provider:'claude',model:'haiku',roles:['coding'],tier:'light'},cwd:process.cwd(),prompt:'no execution',sessionId:'test',phase:'implement',writeFiles:true,allowedPaths:['src'],allowShell:false,timeoutMs:1000,signal:controller.signal});
  assert.equal(result.failure,'cancelled');assert.equal(result.wallMs,0);assert.deepEqual(result.usage,[]);
});
test('invalid native turn bounds fail before any provider executable is resolved', async () => {
  await assert.rejects(runNativeAgent({model: {id: 'test', provider: 'claude', model: 'sonnet', roles: ['coding'], tier: 'standard'},
    cwd: process.cwd(), prompt: 'never execute', sessionId: 'bounds', phase: 'implement', writeFiles: true,
    allowedPaths: ['src'], allowShell: false, timeoutMs: 1000, maxTurns: 0}), /bounded/);
});
