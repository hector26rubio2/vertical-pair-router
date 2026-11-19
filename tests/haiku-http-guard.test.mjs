import assert from 'node:assert/strict';
import test from 'node:test';
import {countPayload,guardHttp,resolveCountPayload} from '../hooks/haiku-http-guard.js';

test('counter conversion removes transport controls but preserves arbitrary tool input and nested results',()=>{
  const body={model:'haiku',system:[{type:'text',text:'rules',cache_control:{type:'ephemeral',scope:'org'}}],messages:[{role:'assistant',output_config:{effort:'medium'},content:[{type:'tool_use',name:'Read',input:{cache_control:'DOMAIN DATA',output_config:'KEEP'}}]},{role:'user',content:[{type:'tool_result',content:[{type:'text',text:'data',cache_control:{type:'ephemeral'}}]}]}]};
  const copy=countPayload(body);assert.equal(copy.messages[0].output_config,undefined);
  assert.equal(copy.messages[0].content[0].input.cache_control,'DOMAIN DATA');
  assert.equal(copy.messages[0].content[0].input.output_config,'KEEP');assert.equal(copy.system[0].cache_control,undefined);
  assert.equal(copy.messages[1].content[0].content[0].text,'data');assert.equal(body.system[0].cache_control.scope,'org');
});

test('preflight counts the pending payload before dispatch and blocks at 90K, on refusal and on unknown counts',async()=>{
  for(const [ok,tokens,allowed] of [[true,89999,true],[true,90000,false],[true,100001,false],[true,null,false],[false,10,false]]){
    let sent=0,counted=0;
    const next=Object.assign(async()=>{sent++;return {value:{status:200}};},{origin:{plugin:'engine'}});
    const $={session:{authorize:async()=>({kind:'bearer',handle:'opaque-native-handle'})},http:{fetch:async(url,request)=>{
      counted++;assert.ok(url.endsWith('/count_tokens'));assert.equal(request.auth,'opaque-native-handle');assert.equal(JSON.parse(request.body).messages[0].content,'pending message');
      return {ok,text:JSON.stringify({input_tokens:tokens})};
    }}};
    const result=await guardHttp($,{url:'https://api.anthropic.com/v1/messages?beta=true',init:{body:JSON.stringify({model:'claude-haiku-5-5',messages:[{role:'user',content:'pending message'}]})}},next);
    assert.equal(counted,1);assert.equal(sent,allowed?1:0);if(!allowed)assert.ok(result.deny);
  }
});

test('other models pass unchanged and missing native subscription cannot authorize Haiku',async()=>{
  let sent=0;const next=Object.assign(async()=>{sent++;return {};},{origin:{plugin:'engine'}});
  const event={url:'https://api.anthropic.com/v1/messages',init:{body:JSON.stringify({model:'sonnet',messages:[]})}};
  await guardHttp({},event,next);assert.equal(sent,1);
  const blocked=await guardHttp({session:{authorize:async()=>null}},{...event,init:{body:JSON.stringify({model:'haiku',messages:[]})}},next);
  assert.ok(blocked.deny);assert.equal(sent,1);
});

test('thread continuation counts the complete correct agent history and inherits system/tools',()=>{
  const original={role:'user',content:[{type:'text',text:'task'}]},call={role:'assistant',content:[{type:'tool_use',id:'tool-a',name:'Read',input:{file_path:'a.ts'}}]},answer={role:'user',content:[{type:'tool_result',tool_use_id:'tool-a',content:'private source'}]};
  const a={active:true,model:'haiku',messages:[original]},b={active:true,model:'haiku',messages:[{role:'user',content:'different agent'}]};
  resolveCountPayload({model:'haiku',messages:[original],system:'rules',tools:[{name:'Read'}],thread:{type:'create'}},[a,b]);
  a.messages=[original,call,answer];
  const full=resolveCountPayload({model:'haiku',messages:[answer],thread:{type:'continue',previous_message_id:'message-a'}},[a,b]);
  assert.equal(full.messages.length,3);assert.equal(full.messages[0].content[0].text,'task');assert.equal(full.system,'rules');assert.equal(full.tools[0].name,'Read');
  assert.throws(()=>resolveCountPayload({model:'haiku',messages:[answer],thread:{type:'continue'}},[b]),/unavailable/);
  assert.throws(()=>resolveCountPayload({model:'haiku',messages:[answer],thread:{type:'continue'}},[a,{...a}]),/ambiguous/);
  assert.equal(full.messages[2].content[0].content,'private source');
});

test('a multi-round continuation replaces its suffix without duplicating or reordering tool calls',()=>{
  const task={role:'user',content:'task'};
  const call=id=>({role:'assistant',content:[{type:'tool_use',id,name:'Read',input:{file_path:id}}]});
  const result=id=>({role:'user',content:[{type:'tool_result',tool_use_id:id,content:'source '+id}]});
  for(const complete of [true,false]){
    const context={active:true,model:'haiku',prefix:{system:'rules',tools:[]},messages:[task,call('one'),result('one'),call('two'),...(complete?[result('two')]:[])]};
    const payload=resolveCountPayload({model:'haiku',thread:{type:'continue'},messages:[result('one'),call('two'),result('two')]},[context]);
    assert.equal(payload.messages.length,5);assert.deepEqual(payload.messages,[task,call('one'),result('one'),call('two'),result('two')]);
  }
});
