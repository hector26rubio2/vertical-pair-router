import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { benchmarkTasks, acceptanceSource } from '../tools/lib/benchmark-tasks.mjs';
const execute = promisify(execFile);
const solutions = {
  T01: `export function normalizeSku(value) { if(typeof value!=='string') throw new TypeError(); return value.trim().replace(/\\s+/gu,'-').toLowerCase(); }`,
  T02: `export function orderTasks(tasks) {
    const ids=new Set(tasks.map(t=>t.id)); if(ids.size!==tasks.length||tasks.some(t=>t.deps.some(d=>!ids.has(d)))) throw Error();
    const done=new Set(),result=[]; while(done.size<tasks.length) { const t=tasks.find(t=>!done.has(t.id)&&t.deps.every(d=>done.has(d))); if(!t) throw Error(); done.add(t.id);result.push(t.id); } return result;
  }`,
  T03: `export function planWaves(tasks,capacity) {
    if(!Number.isSafeInteger(capacity)||capacity<=0) throw Error();
    const ids=new Set(tasks.map(t=>t.id)); if(ids.size!==tasks.length||tasks.some(t=>t.deps.some(d=>!ids.has(d)))) throw Error();
    const done=new Set(),waves=[]; while(done.size<tasks.length) {
      const chosen=[]; for(const t of tasks) if(chosen.length<capacity&&!done.has(t.id)&&t.deps.every(d=>done.has(d))&&!chosen.some(c=>c.paths.some(a=>t.paths.some(b=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/'))))) chosen.push(t);
      if(!chosen.length) throw Error(); waves.push(chosen.map(t=>t.id)); for(const t of chosen)done.add(t.id);
    } return waves;
  }`
};
for (const task of benchmarkTasks) test(`external ${task.id} accepts correct implementation and rejects a stub`, async context => {
  const dir = await mkdtemp(join(tmpdir(), 'vpr-acceptance-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir,'src'));
  await writeFile(join(dir,'acceptance.mjs'),acceptanceSource(task));
  await writeFile(join(dir,'src/solution.mjs'),solutions[task.id]);
  const options={ cwd:dir, env:{...process.env,VPR_BENCH_PROJECT:dir}, timeout:10000, windowsHide:true };
  // A nested runner otherwise inherits the parent's binary test channel and
  // suppresses the requested textual reporter.
  delete options.env.NODE_TEST_CONTEXT;
  const args=['--test','--test-reporter=tap','acceptance.mjs'];
  const good=await execute(process.execPath,args,options);
  assert.match(good.stdout,new RegExp('# pass '+task.cases.length+'\\b'));
  await writeFile(join(dir,'src/solution.mjs'),`export function ${task.entry}(){ throw new Error('not implemented'); }`);
  await assert.rejects(execute(process.execPath,args,options), error => error.code===1 && /# fail [1-9]/u.test(error.stdout));
});
