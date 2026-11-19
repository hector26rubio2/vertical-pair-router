import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSourceSize} from '../tools/lib/source-size.mts';

test('source limits flag code lines but explicitly exclude generated directories and data',()=>{
  assert.equal(inspectSourceSize('tools/example.mjs','x'.repeat(301))[0].rule,'line-length');
  assert.equal(inspectSourceSize('packages/core/src/example.ts','x'.repeat(300)).length,0);
  for(const path of ['packages/core/dist/example.js','tools/generated/example.mjs','tools/fixtures/data.json']){
    assert.deepEqual(inspectSourceSize(path,'x'.repeat(1000)),[]);
  }
});

test('function size counts executable statements and not embedded template line count',()=>{
  const code='function big(){ const a=1; const b=2; return a+b; }';
  assert.equal(inspectSourceSize('tools/example.mjs',code,{maxFunctionStatements:2})[0].rule,'function-size');
  const template='function view(){ return `'+Array(1000).fill('<p>static</p>').join('\n')+'`; }';
  assert.deepEqual(inspectSourceSize('tools/view.mjs',template,{maxFunctionStatements:2}),[]);
});
