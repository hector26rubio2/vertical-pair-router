import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from '../hooks/guard-module.js';
import {haikuContextDecision} from '../hooks/haiku-context.js';
import {runMeasuredClaude} from '../tools/lib/run-measured-claude.mjs';

test('only a verified next request permits Haiku; historical/estimated counts cannot authorize it',()=>{
  for(const measurement of [undefined,{source:'last-response',tokens:10},{source:'local-estimate',tokens:10},{source:'exact-next-request',tokens:NaN}])
    assert.equal(haikuContextDecision('claude-haiku-5-5',measurement).action,'block');
  assert.equal(haikuContextDecision('haiku',{source:'exact-next-request',tokens:89999}).action,'continue');
  assert.equal(haikuContextDecision('haiku',{source:'exact-next-request',tokens:90000}).action,'compact');
  assert.equal(haikuContextDecision('haiku',{source:'exact-next-request',tokens:100000}).action,'compact');
  assert.equal(haikuContextDecision('haiku',{source:'exact-next-request',tokens:100001}).action,'block');
  assert.equal(haikuContextDecision('claude-sonnet-5-5').action,'continue');
});

test('native hook blocks before dispatch for main and subagents, independently of meter capture',async()=>{
  const handlers=new Map();register((name,...args)=>{handlers.set(name,args.at(-1));return {catch(handler){handlers.set(name+':catch',handler);}};});
  for(const agentId of [undefined,'worker-1']){
    let calls=0;
    const e={model:'claude-haiku-5-5',turnId:'test',index:0,agentId};
    const iterator=handlers.get('turn.step')({ui:{log(){}}},e,async function*(){calls++;});
    const text=await iterator.next();assert.equal(text.value.kind,'text');
    const stop=await iterator.next();assert.equal(stop.value.kind,'stop');
    const result=await iterator.next();
    assert.equal(calls,0);assert.equal(result.done,true);assert.equal(result.value.usage,null);
    assert.equal(result.value.toolUses.length,0);
  }
});

test('a failed native guard still blocks rather than dispatching the request',async()=>{
  const handlers=new Map();register((name,...args)=>{handlers.set(name,args.at(-1));return {catch(handler){handlers.set(name+':catch',handler);}};});
  let calls=0;const next=async function*(){calls++;};next.called=false;
  const iterator=handlers.get('turn.step:catch')({}, {turnId:'broken',index:0,model:'haiku'},next);
  for await(const chunk of iterator)assert.ok(['text','stop'].includes(chunk.kind));
  assert.equal(calls,0);
});

test('measured launcher refuses Haiku before starting any provider process',async()=>{
  const result=await runMeasuredClaude({executable:'this-executable-must-never-start',cwd:process.cwd(),args:['--model','haiku'],prompt:'no execution'});
  assert.equal(result.stopped,'context-guard-unverified');assert.equal(result.stdoutBytes,0);
  assert.equal(result.completeAccounting,false);assert.equal(result.models.length,0);
});
