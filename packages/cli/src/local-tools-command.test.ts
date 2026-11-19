import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runCli} from './cli.js';

test('init previews repeatable integration choices without writing or installing',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-init-tools-'));context.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'package.json'),JSON.stringify({name:'pilot',packageManager:'npm@11.6.0'}));
  let output='';const io={stdout:(value:string)=>{output+=value;},stderr:()=>{}};
  assert.equal(await runCli(['init','--project',root,'--integrations','husky,graphify','--technologies','typescript,angular'],io),0);
  const receipt=JSON.parse(output);assert.deepEqual(receipt.profile.setup.integrations,{husky:true,graphify:true,archify:false});assert.equal(receipt.applied,false);
  await assert.rejects(access(join(root,'.vpr/profile.json')));
  await assert.rejects(runCli(['init','--project',root,'--integrations','arbitrary-command'],io));
});

test('init preserves an existing Git hooks path instead of overwriting it with Husky',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-preserve-hooks-'));context.after(()=>rm(root,{recursive:true,force:true}));
  execFileSync('git',['init'],{cwd:root,stdio:'ignore'});execFileSync('git',['config','core.hooksPath','company-hooks'],{cwd:root});
  await writeFile(join(root,'package.json'),JSON.stringify({name:'pilot',packageManager:'npm@11.6.0',scripts:{test:'node --test'}}));
  let output='';const io={stdout:(value:string)=>{output+=value;},stderr:()=>{}};
  await runCli(['init','--project',root,'--integrations','husky','--apply'],io);
  assert.equal(execFileSync('git',['config','--get','core.hooksPath'],{cwd:root,encoding:'utf8'}).trim(),'company-hooks');
  assert.equal(JSON.parse(output).integrations.find((r:{integration:string})=>r.integration==='husky').state,'unavailable');
  assert.match(JSON.parse(output).integrations.find((r:{integration:string})=>r.integration==='husky').detail,/Existing core.hooksPath/);
});

test('local retrieval reports missing graph and diagram outputs cannot escape through links',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-local-tools-')),outside=await mkdtemp(join(tmpdir(),'vpr-tools-outside-'));
  context.after(()=>Promise.all([rm(root,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})]));
  let output='';const io={stdout:(value:string)=>{output+=value;},stderr:()=>{}};
  assert.equal(await runCli(['tools','query','--project',root,'--question','imports'],io),3);assert.equal(JSON.parse(output).inferenceTokens,0);
  await writeFile(join(root,'diagram.json'),'{}');await mkdir(join(root,'safe'));
  await symlink(outside,join(root,'redirect'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(runCli(['tools','diagram','--project',root,'--type','architecture','--input','diagram.json','--out','redirect/new/result.html'],io),/escapes/);
  await assert.rejects(access(join(outside,'new')));
  await writeFile(join(root,'safe','existing.html'),'OWNER OUTPUT');
  await assert.rejects(runCli(['tools','diagram','--project',root,'--type','architecture','--input','diagram.json','--out','safe/existing.html'],io),/exists/);
  assert.equal(await readFile(join(root,'safe','existing.html'),'utf8'),'OWNER OUTPUT');
});
