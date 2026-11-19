import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyFinanzasAnalysis(project, frozen, manifest, paths,additionalFiles=[]){
  const start=performance.now(),checks=[];let value;
  try{value=JSON.parse(await readFile(join(project,'analysis/report.json'),'utf8'));}catch{}
  checks.push({name:'parseable-report',passed:!!value});
  const evidence=async evidence=>Array.isArray(evidence)&&evidence.length>0&&(await Promise.all(evidence.map(async c=>{
    if(!c||!paths.includes(c.path)||!Number.isInteger(c.line)||c.line<1||typeof c.quote!=='string'||c.quote.trim().length<8||c.quote.length>180)return false;
    const lines=(await readFile(join(frozen,c.path),'utf8')).split(/\r?\n/u);return lines[c.line-1]?.includes(c.quote)===true;
  }))).every(Boolean);
  checks.push({name:'three-cited-current-flows',passed:Array.isArray(value?.currentFlows)&&value.currentFlows.length>=3&&(await Promise.all(value.currentFlows.map(f=>evidence(f.evidence)))).every(Boolean)});
  checks.push({name:'five-grounded-risks',passed:Array.isArray(value?.risks)&&value.risks.length>=5&&(await Promise.all(value.risks.map(r=>evidence(r.evidence)))).every(Boolean)});
  const tasks=value?.tasks,ids=new Set(Array.isArray(tasks)?tasks.map(t=>t.id):[]);
  const dependencies=Array.isArray(tasks)&&tasks.length>=8&&ids.size===tasks.length&&tasks.every(t=>typeof t.id==='string'&&t.title&&t.layer&&Array.isArray(t.files)&&t.files.every(file=>typeof file==='string')&&Array.isArray(t.dependsOn)&&t.dependsOn.every(id=>ids.has(id)&&id!==t.id)&&Array.isArray(t.acceptance)&&t.acceptance.length);
  const done=new Set();if(dependencies)for(let i=0;i<tasks.length;i++)for(const t of tasks)if(t.dependsOn.every(id=>done.has(id)))done.add(t.id);
  checks.push({name:'executable-task-dag',passed:!!dependencies&&done.size===tasks.length});
  checks.push({name:'open-decisions',passed:Array.isArray(value?.openDecisions)&&value.openDecisions.length>=3});
  checks.push({name:'migration-and-rollback',passed:Array.isArray(value?.migration)&&value.migration.length>0&&Array.isArray(value?.rollback)&&value.rollback.length>0});
  checks.push({name:'cross-layer-tests',passed:Array.isArray(value?.testPlan)&&value.testPlan.length>=3&&value.testPlan.every(t=>t.name&&t.layer&&t.acceptance)});
  const unchanged=(await Promise.all(manifest.files.map(async file=>hash(await readFile(join(project,file.path)))===file.sha256))).every(Boolean);
  async function allFiles(dir,prefix=''){const files=[];for(const item of await readdir(dir,{withFileTypes:true})){const name=prefix+item.name;if(item.isSymbolicLink())return ['UNEXPECTED_SYMLINK'];if(item.isDirectory())files.push(...await allFiles(join(dir,item.name),name+'/'));else files.push(name);}return files;}
  const allowed=new Set([...paths,'SOURCE-MANIFEST.json','ANALYSIS-CONTRACT.txt','analysis/report.json',...additionalFiles]);
  checks.push({name:'source-and-write-scope-preserved',passed:unchanged&&(await allFiles(project)).every(p=>allowed.has(p))});
  return {exitCode:checks.every(c=>c.passed)?0:1,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,durationMs:Math.round(performance.now()-start),details:checks,kind:'structured-analysis-not-code-quality'};
}
