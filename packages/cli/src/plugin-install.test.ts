import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlugin} from './plugin-install.js';
const own={name:'vpr-local',plugins:[{name:'vertical-pair-router'}]};
test('an install location migration preserves unrelated catalog entries',async()=>{
  const calls:string[][]=[];
  const code=await installPlugin('unit-double','new',{stdout:()=>{},stderr:()=>{}},{catalog:async path=>path==='new'?own:{name:'vpr-local',plugins:[{name:'vertical-pair-router'},{name:'owner-plugin'}]},run:async args=>{
    calls.push([...args]);if(args.includes('install'))return {code:126,stdout:JSON.stringify({failureCode:'name_taken'}),stderr:''};
    return {code:0,stdout:JSON.stringify(args.includes('marketplace')?[{name:'vpr-local',source:'directory',path:'old'}]:[{id:'vertical-pair-router@vpr-local'}]),stderr:''};
  }});
  assert.equal(code,126);assert.ok(!calls.some(args=>args.includes('remove')));
});
test('a failed source migration restores the prior VPR-only registration',async()=>{
  const calls:string[][]=[];let attempts=0;
  const code=await installPlugin('unit-double','new',{stdout:()=>{},stderr:()=>{}},{catalog:async()=>own,run:async args=>{
    calls.push([...args]);if(args.includes('install')){attempts++;return attempts===1?{code:126,stdout:JSON.stringify({failureCode:'name_taken'}),stderr:''}:args.includes('new')?{code:1,stdout:'{}',stderr:''}:{code:0,stdout:'{}',stderr:''};}
    return {code:0,stdout:JSON.stringify(args.includes('remove')?{}:args.includes('marketplace')?[{name:'vpr-local',source:'directory',path:'old'}]:[{id:'vertical-pair-router@vpr-local'}]),stderr:''};
  }});
  assert.equal(code,1);assert.ok(calls.some(args=>args.includes('remove')));assert.ok(calls.at(-1)?.includes('old'));
});
