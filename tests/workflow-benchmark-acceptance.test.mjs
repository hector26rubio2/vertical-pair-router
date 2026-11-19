import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {workflowTasks,workflowAcceptance} from '../tools/lib/workflow-benchmark-tasks.mjs';
const execute=promisify(execFile);
test('every workflow acceptance generator emits syntactically valid executable checks',()=>{
  for(const task of workflowTasks){const source=workflowAcceptance(task).replace(/^import[^\n]*\n/gmu,'');assert.doesNotThrow(()=>new Script('(async()=>{'+source+'})'),task.id);}
});
test('project analysis accepts grounded findings without falsely flagging unchanged source',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-analysis-check-'));context.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'src'));const task=workflowTasks.find(task=>task.id==='W07');
  for(const [name,text]of Object.entries(task.files))await writeFile(join(root,name),text);
  await writeFile(join(root,'src/solution.mjs'),`export function analyzeProject(){return {layers:['http','service','repository'],dataFlow:['src/server.mjs','src/service.mjs','src/repository.mjs'],findings:[{id:'sql-injection',file:'src/repository.mjs',symbol:'findUser',remedy:'parameterized-query'}],proposedTasks:['parameterize-query','add-injection-regression']};}`);
  await writeFile(join(root,'acceptance.mjs'),workflowAcceptance(task));
  const env={...process.env,VPR_BENCH_PROJECT:root};delete env.NODE_TEST_CONTEXT;
  const good=await execute(process.execPath,['--test','--test-reporter=tap','acceptance.mjs'],{cwd:root,env,timeout:10000,windowsHide:true});
  assert.match(good.stdout,/# pass 3\b/u);
  await writeFile(join(root,'src/solution.mjs'),'export function analyzeProject(){return {layers:[],dataFlow:[],findings:[],proposedTasks:[]};}');
  await assert.rejects(execute(process.execPath,['--test','--test-reporter=tap','acceptance.mjs'],{cwd:root,env,timeout:10000,windowsHide:true}),error=>error.code===1&&/# fail [1-9]/u.test(error.stdout));
});
