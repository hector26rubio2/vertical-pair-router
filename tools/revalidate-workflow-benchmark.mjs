import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {workflowTasks,workflowAcceptance} from './lib/workflow-benchmark-tasks.mjs';
const flag=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--amend-acceptance')||!process.argv.includes('--report')||!process.argv.includes('--task')||!process.argv.includes('--reason'))throw Error('Explicit report, task and amendment reason required');
const path=resolve(flag('--report')),report=JSON.parse(await readFile(path,'utf8')),task=workflowTasks.find(task=>task.id===flag('--task'));
if(!task||report.suite!=='workflows'||report.tasks.find(t=>t.id===task.id)?.requirement!==task.requirement)throw Error('Requirement changed: start a new experiment');
const external=join(dirname(path),task.id+'-acceptance.mjs'),hash=text=>createHash('sha256').update(text).digest('hex');
const previousHash=hash(await readFile(external)),source=workflowAcceptance(task),nextHash=hash(source);
if(previousHash===nextHash)throw Error('No acceptance amendment to record');
await writeFile(external,source);
for(const row of report.rows.filter(row=>row.taskId===task.id)){
  const child=spawn(process.execPath,['--test','--test-reporter=tap','--test-timeout=5000',external],{cwd:row.project,env:{...process.env,VPR_BENCH_PROJECT:row.project},windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',chunk=>text+=chunk);child.stderr.on('data',()=>{});
  const start=performance.now(),timer=setTimeout(()=>child.kill(),10000),exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);}).finally(()=>clearTimeout(timer));
  const number=key=>Number(text.match(new RegExp('# '+key+' (\\d+)'))?.[1]??0);
  row.acceptanceAmendments??=[];row.acceptanceAmendments.push({at:new Date().toISOString(),reason:flag('--reason'),previousHash,nextHash,previousChecks:row.checks.external,implementationRerun:false,inferenceTokens:0});
  row.checks.external={exitCode,passed:number('pass'),failed:number('fail'),durationMs:Math.round(performance.now()-start)};
  row.acceptanceHash=nextHash;row.acceptanceUnchanged=true;
  row.status=exitCode===0&&row.checks.external.passed===task.checks.length&&row.checks.own.exitCode===0&&row.checks.own.passed>0&&row.allowedChanges&&row.delegationVerified&&row.modelIntegrity&&row.receipt.completeAccounting&&row.receipt.terminalReceipt?.success?'accepted':'incomplete';
}
report.specHashAmendments??=[];report.specHashAmendments.push({previousHash:report.specHash,nextHash:hash(JSON.stringify(workflowTasks)),reason:flag('--reason')});report.specHash=hash(JSON.stringify(workflowTasks));
await writeFile(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.rows.filter(row=>row.taskId===task.id).map(row=>({task:row.taskId,status:row.status,checks:row.checks.external,implementationRerun:false}))));
