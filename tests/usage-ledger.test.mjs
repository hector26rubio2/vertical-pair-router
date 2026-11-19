import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {accountKey,recordUsage,readUsage,formatUsage} from '../packages/runtime/src/usage-ledger.mjs';
import {register} from '../hooks/usage.js';

test('deduplicates replay, separates accounts and links delegated usage without private content',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-usage-'));process.env.VPR_USAGE_HOME=root;context.after(async()=>{delete process.env.VPR_USAGE_HOME;await rm(root,{recursive:true,force:true});});
  const personal=await accountKey('claude','personal@example.test'),company=await accountKey('claude','company@example.test');assert.notEqual(personal,company);
  const row={provider:'claude',sessionId:'s1',id:'call1',model:'claude-haiku-5-5',accountKey:personal,inputTokens:3,outputTokens:4,cacheReadTokens:10,cacheWriteTokens:5,inputSemantics:'uncached',complete:true,privatePrompt:'DO NOT STORE',cost:{min:.01,max:.02}};
  await Promise.all([recordUsage(row),recordUsage(row)]);
  await recordUsage({...row,id:'call2',sessionId:'s2',accountKey:company});
  await recordUsage({...row,id:'call3',sessionId:'worker',parentSessionId:'s1',provider:'codex',model:'gpt-6.1-terra'});
  const session=await readUsage({sessionId:'s1'});assert.equal(session.recordCount,2);assert.equal(session.groups.find(row=>row.provider==='claude').inputTokens,3);
  const companyOnly=await readUsage({scope:'account',account:company});assert.equal(companyOnly.recordCount,1);
  assert.equal((await readUsage({scope:'account'})).reason,'Account identity unavailable; no accounts were combined');
  const files=await readdir(join(root,'usage/records'));const content=(await Promise.all(files.map(name=>readFile(join(root,'usage/records',name),'utf8')))).join('');assert.ok(!content.includes('@example'));assert.ok(!content.includes('DO NOT STORE'));
});

test('native use display does not inject its output or trigger a context-count request',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-use-command-'));process.env.VPR_USAGE_HOME=root;context.after(async()=>{delete process.env.VPR_USAGE_HOME;await rm(root,{recursive:true,force:true});});
  const hooks=new Map();register((name,...args)=>{hooks.set(name==='command.run'?name+':'+args[0].command:name,args.at(-1));return {catch(){}};});const shown=[];
  const api={plugin:{root:'.'},process:{run:async(argv,options)=>{const action=argv.at(-1),input=JSON.parse(options.stdin);if(action==='record'){const u=input.usage;await recordUsage({...input,inputTokens:u.input_tokens,outputTokens:u.output_tokens,cacheReadTokens:u.cache_read_input_tokens,cacheWriteTokens:u.cache_creation_input_tokens,complete:true});return {exitCode:0,stdout:'{}'};}return {exitCode:0,stdout:JSON.stringify({text:formatUsage(await readUsage(input))})};}},session:{id:async()=> 'session',usage:async(...args)=>{assert.deepEqual(args,[]);return {context:{window:100000,tokens:1200},rateLimits:[{kind:'five_hour',percentUsed:20}],cost:{usd:.1}};}},ui:{log:text=>shown.push(text)}};
  api.session.model=async()=> 'claude-haiku-5-5';
  const result=await hooks.get('command.run:vpr-use')(api,{args:''});assert.equal(result.text,undefined);assert.deepEqual(result.context,[]);assert.ok(shown.join('').includes('80% restante'));assert.ok(shown.join('').includes('Modelo actual: claude-haiku-5-5'));
  const step=hooks.get('turn.step')(api,{turnId:'turn1',index:0},async function*(){return {answer:'PRIVATE CODE',usage:{model:'claude-haiku-5-5',input_tokens:1,output_tokens:2,cache_read_input_tokens:3,cache_creation_input_tokens:4}};});
  for await(const _ of step){}const report=await readUsage({sessionId:'session'});assert.equal(report.recordCount,1);assert.equal(report.groups[0].outputTokens,2);
});

test('native workflow preview uses the executable inside the copied plugin without inference',async()=>{
  const hooks=new Map();register((name,...args)=>{hooks.set(name==='command.run'?name+':'+args[0].command:name,args.at(-1));return {catch(){}};});
  const calls=[],shown=[];
  const api={plugin:{root:'/cached/plugin'},process:{run:async(argv,options)=>{calls.push({argv,options});return {exitCode:0,stdout:'/cached/plugin/bin/vpr.mjs\n'};},spawn:async function*(request){calls.push({argv:request.argv,options:request});yield {stream:'stdout',text:JSON.stringify({dispatched:false,decision:{status:'ready'}})};return {code:0,signal:null};}},session:{cwd:async()=>'/project',id:async()=> 'parent'},ui:{log:text=>shown.push(text)}};
  const result=await hooks.get('command.run:vpr-run')(api,{args:'--preview "tasks/path with spaces.json"'});
  assert.equal(calls.length,2);assert.ok(calls[0].argv.includes('/cached/plugin/bin/vpr.mjs'));
  assert.deepEqual(calls[1].argv,['node','/cached/plugin/bin/vpr.mjs','agent','run','--project','/project','--input','tasks/path with spaces.json','--preview']);
  assert.deepEqual(result.context,[]);assert.equal(result.exitCode,0);
});
