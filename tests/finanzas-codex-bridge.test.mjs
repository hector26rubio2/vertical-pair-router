import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

test('oversized plans get one actionable correction without dispatching or persisting plan contents',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vpr-native-bridge-'));
  let child;
  try{
    const project=join(dir,'project');await mkdir(project);
    await writeFile(join(project,'SOURCE-MANIFEST.json'),JSON.stringify({files:[{path:'source.txt'}]}));
    await writeFile(join(project,'source.txt'),'Synthetic local fixture only');
    await writeFile(join(project,'ANALYSIS-CONTRACT.txt'),'Synthetic JSON contract');
    const receipt=join(dir,'receipt.json'),manifest=join(dir,'manifest.json');
    await writeFile(manifest,JSON.stringify({project,executable:process.execPath,receipt,model:'gpt-6-luna',authorization:'owner-authorized-native-read-only-finanzas-analysis'}));
    child=spawn(process.execPath,[resolve('tools/lib/finanzas-codex-analysis-bridge.mjs'),'--manifest',manifest],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const pending=new Map();let next=0;
    const reader=createInterface({input:child.stdout});reader.on('line',line=>{const value=JSON.parse(line);pending.get(value.id)?.(value);pending.delete(value.id);});
    const call=params=>new Promise((done,reject)=>{const id=++next;const timer=setTimeout(()=>reject(Error('Bridge timeout')),3000);pending.set(id,value=>{clearTimeout(timer);done(value);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params})+'\n');});
    const plan='PRIVATE_PLAN_'.repeat(600);
    const first=await call({name:'execute',arguments:{plan}});
    const firstData=JSON.parse(first.result.content[0].text);
    assert.equal(firstData.modelDispatched,false);assert.equal(firstData.correctionAllowed,true);assert.equal(firstData.maxCharacters,6000);
    const second=await call({name:'execute',arguments:{plan}});
    assert.equal(JSON.parse(second.result.content[0].text).correctionAllowed,false);
    const blocked=await call({name:'execute',arguments:{plan:'A valid but now blocked plan.'}});
    assert.equal(blocked.error.code,-32000);
    const metadata=await readFile(receipt,'utf8');assert.ok(!metadata.includes('PRIVATE_PLAN'));assert.equal(JSON.parse(metadata).modelDispatched,false);
    child.stdin.end();await new Promise(done=>child.once('close',done));
  }finally{child?.kill();await rm(dir,{recursive:true,force:true});}
});
