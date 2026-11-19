import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyFinanzasAnalysis} from '../tools/lib/finanzas-analysis-acceptance.mjs';

test('analysis acceptance permits decision tasks without files, but rejects invented citations, cycles and source changes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vpr-finanzas-acceptance-'));
  try{
    const frozen=join(dir,'frozen'),project=join(dir,'project'),source='export const original = true;\n';
    await mkdir(frozen);await mkdir(join(project,'analysis'),{recursive:true});
    await writeFile(join(frozen,'source.ts'),source);await writeFile(join(project,'source.ts'),source);
    const manifest={files:[{path:'source.ts',sha256:createHash('sha256').update(source).digest('hex')}]};
    const citation={path:'source.ts',line:1,quote:'export const original'};
    const artifact={summary:'Real source analysis',currentFlows:Array.from({length:3},()=>({evidence:[citation]})),risks:Array.from({length:5},()=>({evidence:[citation]})),tasks:Array.from({length:8},(_,i)=>({id:'T'+i,title:'Decision or implementation',layer:i?'api':'owner-decision',files:i?['source.ts']:[],dependsOn:i?['T'+(i-1)]:[],acceptance:['Agreed acceptance']})),openDecisions:['a','b','c'],migration:['additive'],rollback:['feature flag'],testPlan:Array.from({length:3},(_,i)=>({name:'scenario'+i,layer:'api',acceptance:['Verified']}))};
    const run=async()=>{await writeFile(join(project,'analysis/report.json'),JSON.stringify(artifact));return verifyFinanzasAnalysis(project,frozen,manifest,['source.ts']);};
    assert.equal((await run()).passed,8);
    artifact.risks[0]={evidence:[{...citation,line:2}]};
    assert.equal((await run()).details.find(c=>c.name==='five-grounded-risks').passed,false);
    artifact.risks[0]={evidence:[citation]};artifact.tasks[0].dependsOn=['T7'];
    assert.equal((await run()).details.find(c=>c.name==='executable-task-dag').passed,false);
    artifact.tasks[0].dependsOn=[];await writeFile(join(project,'source.ts'),'changed');
    assert.equal((await run()).details.find(c=>c.name==='source-and-write-scope-preserved').passed,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
