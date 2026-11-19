import {mkdir,cp,readFile,writeFile,readdir,symlink} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {resolveExecutable} from '../packages/runtime/dist/index.js';
import {measuredRecipes as claudeRecipes,codexMeasuredRecipes,recipeModels,measuredRecipePhase,mergeRecipeReceipts,reviewSchema} from './lib/measured-recipes.mjs';
import {verifyFinanzasAnalysis} from './lib/finanzas-analysis-acceptance.mjs';
if(!process.argv.includes('--approve-provider'))throw Error('Explicit native model authorization required');
const flag=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
const measuredRecipes=process.argv.includes('--include-codex')?[...claudeRecipes,...codexMeasuredRecipes]:claudeRecipes;
const kind=flag('--kind');if(!['code','analysis'].includes(kind))throw Error('--kind code|analysis required');
const root=resolve('.'),source=resolve(flag('--snapshot')),directory=resolve(flag('--resume')??join(root,'.tmp','finanzas-recipes-'+kind+'-'+Date.now()+'-'+randomUUID()));
if(dirname(directory)!==join(root,'.tmp'))throw Error('Isolated benchmark directory required');await mkdir(directory,{recursive:true});
const frozen=join(source,'frozen'),prices=JSON.parse(await readFile('docs/research/model-price-catalog.json','utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const component='src/app/features/movements/importar/importar-movimientos.ts',parser='src/app/features/movements/importar/extracto-parse.ts',ownSpec='src/app/features/movements/importar/importar-movimientos.vpr-agent.spec.ts',externalSpec='src/app/features/movements/importar/vpr-acceptance.spec.ts';
const extras=['TASK.txt','CHECK-EVIDENCE.json','CHANGESET.patch'];
const sourceManifest=JSON.parse(await readFile(join(source,kind==='code'?'source-manifest.json':'frozen/SOURCE-MANIFEST.json'),'utf8'));
const originalAnalysis=kind==='analysis'?JSON.parse(await readFile(join(source,'report.json'),'utf8')):null;
const requirement=kind==='analysis'?originalAnalysis.tasks[0].requirement:
  'Corregir el flujo existente de importación CSV de movimientos en Angular. Investiga la causa, preserva el contrato web/API y los tests originales. La vista previa debe usar la cuenta seleccionada y actualizar duplicados al cambiarla, interpretar correctamente el signo del view model y del CSV y no omitir movimientos de otras cuentas. Tras un éxito parcial conserva filas pendientes y permite reintentar sólo fallos sin cambiar sus claves ni duplicar éxitos. Dos filas originales distintas, aunque tengan igual contenido, conservan identidad distinta. El contador de fallos debe reflejar el resultado y el modal no se cierra mientras haya pendientes. Mantén máximo cuatro peticiones simultáneas y la cuenta elegida al confirmar. No conviertas este flujo en importación JSON ni prometas atomicidad del lote del servidor. No cambies API, dependencias, permisos ni tests existentes. Implementa el cambio mínimo y añade pruebas propias. Sólo puedes editar los archivos autorizados en TASK.txt. Las pruebas externas, regresiones, compilación y revisión fresca del diff determinan la aceptación. No ejecutes comandos, instales dependencias ni hagas commits. No modifiques ningún proyecto original.';
const taskId=kind==='code'?'F02':'F01B';
const paths=sourceManifest.files.map(f=>f.path);
const task={id:taskId,name:kind==='code'?'Corregir importación real: cuenta, errores parciales e idempotencia':'Análisis full stack de Finanzas con roles separados y revisión común',level:kind==='code'?'medio-alto · flujo asíncrono financiero':'complejo · análisis full stack',kind:kind==='code'?'bugfix':'requirements',executionRole:kind==='code'?'coding':'inventory',requirement,testCount:kind==='code'?9:8,sourceFiles:paths.length,sourceCharacters:kind==='analysis'?originalAnalysis.tasks[0].sourceCharacters:null,pairedTaskId:kind==='analysis'?'F01':undefined,protocol:'staged-recipe-v1',expectedArms:measuredRecipes.map(r=>r.id+'-reviewed'),qualityScope:'Original regression suite, external tests, full build for coding, fresh route-blinded Sonnet review; bounded contract only.'};
const reportPath=join(directory,'report.json');
const report=flag('--resume')?JSON.parse(await readFile(reportPath,'utf8')):{schemaVersion:1,at:new Date().toISOString(),prices,scenario:'Fixed role recipes, separate native sessions; same acceptance and common fresh Sonnet review included in ALL costs. One trial per recipe, not automatic RAG dispatch.',protocol:'staged-recipe-v1',tasks:[task],rows:[],meteringInferenceTokens:0};
report.contextGuard={policy:'provider-preflight-90k/native-window-100k',countingInferenceTokens:0,dispatchThresholdExclusive:90000,basePriceThreshold:100000,advisorDisabled:true};
report.validationPolicy=kind==='code'&&process.argv.includes('--repair')?'common-review-up-to-one-correction':'common-review-first-pass';
report.study=flag('--study')??'development-trial';
let saving=Promise.resolve();const save=()=>{const text=JSON.stringify(report,null,2);saving=saving.then(()=>writeFile(reportPath,text));return saving;};
const executable=await resolveExecutable('claude');if(!executable)throw Error('Native Claude required');
async function command(cwd,args,log,timeoutMs=240000){
  const start=performance.now(),env={...process.env,NG_CLI_ANALYTICS:'false',CI:'true',FORCE_COLOR:'0'};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let text='',timedOut=false;
  const stop=()=>{timedOut=true;if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).once('error',()=>child.kill());else try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}};
  const timer=setTimeout(stop,timeoutMs);for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(text.length<500000)text+=chunk.toString();});
  const exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);}).finally(()=>clearTimeout(timer));await writeFile(log,text);
  return {exitCode,durationMs:Math.round(performance.now()-start),timedOut};
}
const selected=flag('--arms')?.split(',');if(selected?.some(id=>!measuredRecipes.some(r=>r.id===id)))throw Error('Unknown recipe');
const attempt=Number(flag('--attempt')??1);if(!Number.isInteger(attempt)||attempt<1||attempt>20)throw Error('Invalid attempt number');
for(const recipe of measuredRecipes.filter(r=>!selected||selected.includes(r.id))){
  const strategyArm=recipe.id+'-reviewed',arm=strategyArm+(attempt>1?'-attempt-'+attempt:'');if(report.rows.some(r=>r.arm===arm))continue;
  const project=join(directory,'case-'+randomUUID());
  await cp(frozen,project,{recursive:true,filter:path=>!['node_modules','dist','.angular'].includes(path.split(/[\\/]/u).at(-1))});
  if(kind==='code'){
    await symlink(join(sourceManifest.source,'node_modules'),join(project,'node_modules'),process.platform==='win32'?'junction':'dir');
    await cp(join(frozen,externalSpec),join(project,externalSpec));
  }else await mkdir(join(project,'analysis'),{recursive:true});
  const allowedWrites=kind==='code'?[component,parser,ownSpec]:['analysis/report.json'];
  await writeFile(join(project,'TASK.txt'),requirement+'\nAllowed writes: '+allowedWrites.join(', ')+'\nEntry points: '+(kind==='code'?[component,parser,'src/app/core/state/view-model.ts','src/app/core/api/ledger.api.ts'].join(', '):'SOURCE-MANIFEST.json, ANALYSIS-CONTRACT.txt')+'\nNo further agents, providers, shell, network or source edits outside the scope.');
  const row={taskId,arm,strategyArm,project,protocol:'staged-recipe-v1',requestedRecipe:recipe.steps,coordinatorModel:recipe.steps.length>1?recipeModels[recipe.steps[0][1]]:null,technicalPlannerModel:recipe.steps.find(s=>s[0]==='technical-plan')?recipeModels.sonnet:null,executorModel:recipeModels[recipe.steps.at(-1)[1]],reviewerModel:recipeModels.sonnet,requiredModelIds:[...new Set([...recipe.steps.map(s=>recipeModels[s[1]]),recipeModels.sonnet])],executionRole:task.executionRole,status:'running',startedAt:new Date().toISOString(),acceptanceHash:kind==='analysis'?hash(await readFile(join(frozen,'ANALYSIS-CONTRACT.txt'))):hash(await readFile(join(frozen,externalSpec))),semanticReview:'pending',phases:[],routeChosenBy:'fixed experimental recipe; not autonomous RAG'};
  report.rows.push(row);await save();console.log(JSON.stringify({phase:'running',taskId,arm,report:reportPath}));
  row.validationPolicy=report.validationPolicy;row.study=report.study;
  let handoff='',failed=false;
  for(const [phase,family] of recipe.steps){
    const prompt=`Phase ${phase}. Read TASK.txt and the relevant source. ${phase==='implement'?'Execute the requested change/artifact and add own tests when coding. Do not run commands. Respect all protected tests.':'READ ONLY. '+(phase==='architecture'?'Define architecture, invariants, risks and work boundaries. Do not duplicate detailed implementation.':phase==='technical-plan'?'Refine the architecture into a concrete technical handoff and acceptance. Do not edit code.':'Analyze the task and give an implementable handoff. Do not edit code.')+' Finish with a concise handoff, at most 6000 characters.'}\nTask:\n${requirement}\nPrevious handoff:\n${handoff||'None; solve the task yourself.'}`;
    const value=await measuredRecipePhase({executable,cwd:project,model:recipeModels[family],phase,prompt,allowedWrites:phase==='implement'?allowedWrites:[],timeoutMs:phase==='implement'?300000:180000,onSnapshot(receipt){row.currentPhase={phase,model:recipeModels[family],receipt};void save();}});
    row.phases.push(value);delete row.currentPhase;await writeFile(join(directory,arm+'-'+phase+'-answer.txt'),value.answer);await save();
    if(!value.receipt.completeAccounting||!value.receipt.terminalReceipt?.success){failed=true;break;}
    handoff=(handoff+'\n'+value.answer).slice(-16000);
  }
  row.checks={own:{exitCode:null,passed:null,kind:'not-run',durationMs:0},external:{exitCode:null,passed:null,kind:'not-run',durationMs:0}};
  row.checkHistory=[];
  const validationRounds=kind==='code'&&process.argv.includes('--repair')?2:1;
  for(let validationRound=0;!failed&&validationRound<validationRounds;validationRound++){
    const checkArm=arm+'-validation-'+validationRound;
    if(validationRound>0){
      const repair=await measuredRecipePhase({executable,cwd:project,model:row.executorModel,phase:'implement',prompt:'Corrective execution, same task and unchanged acceptance. Read TASK.txt, CHECK-EVIDENCE.json, CHANGESET.patch and the affected source/tests. The previous check and fresh review are feedback, not permission to weaken tests or change contracts. Fix only authorized files and add meaningful tests as necessary. Preserve all original/external tests. Do not run commands, install, commit or delegate. Return a short summary after applying the repair.',allowedWrites,timeoutMs:300000,onSnapshot(receipt){row.currentPhase={phase:'repair',model:row.executorModel,receipt};void save();}});
      repair.iteration=validationRound;row.phases.push(repair);delete row.currentPhase;await save();
      if(!repair.receipt.completeAccounting||!repair.receipt.terminalReceipt?.success){failed=true;break;}
    }
    if(kind==='analysis')row.checks.external=await verifyFinanzasAnalysis(project,frozen,sourceManifest,paths,extras);
    else{
      const jsonPath=join(directory,checkArm+'-tests.json'),ng=join(project,'node_modules/@angular/cli/bin/ng.js');
      const test=await command(project,[ng,'test','--watch=false','--include','src/app/features/movements/importar/*.spec.ts','--progress=false','--reporters=json','--output-file',jsonPath],join(directory,checkArm+'-tests.log'));
      let result;try{result=JSON.parse(await readFile(jsonPath,'utf8'));}catch{}
      const tests=(result?.testResults??[]).flatMap(r=>r.assertionResults??[]),external=tests.filter(t=>t.fullName?.includes('VPR aceptación externa'));
      row.checks.external={...test,passed:external.filter(t=>t.status==='passed').length,failed:external.filter(t=>t.status!=='passed').length,kind:'external-component-api-mock-tests',testNames:external.map(t=>({name:t.title,passed:t.status==='passed'}))};
      const build=await command(project,[ng,'build','--configuration','development','--progress=false'],join(directory,checkArm+'-build.log'));
      row.checks.own={...build,passed:tests.filter(t=>!t.fullName?.includes('VPR aceptación externa')&&t.status==='passed').length,failed:tests.filter(t=>!t.fullName?.includes('VPR aceptación externa')&&t.status!=='passed').length,kind:'original-regressions-and-full-angular-build',testExitCode:test.exitCode,totalTests:tests.length};
    }
    const changed=[];for(const file of sourceManifest.files){const after=await readFile(join(project,file.path)).catch(()=>null);if(!after||hash(after)!==file.sha256)changed.push(file.path);}
    if(kind==='code'&&await readFile(join(project,ownSpec)).then(()=>true,()=>false))changed.push(ownSpec);
    row.changedPaths=changed;row.allowedChanges=kind==='analysis'?changed.length===0:changed.every(path=>[component,parser,ownSpec].includes(path));
    row.acceptanceUnchanged=kind==='analysis'||hash(await readFile(join(project,externalSpec)))===row.acceptanceHash;
    row.localChecksTotalMs=(row.localChecksTotalMs??0)+(row.checks.own.durationMs??0)+(row.checks.external.durationMs??0);
    const patch=changed.map(path=>path===ownSpec?'NEW FILE '+path+'\n':spawnSync('git',['diff','--no-index','--no-ext-diff','--unified=4','--',join(frozen,path),join(project,path)],{cwd:project,encoding:'utf8',windowsHide:true,maxBuffer:500000}).stdout??'').join('\n');
    const logs=kind==='code'?await Promise.all(['tests','build'].map(name=>readFile(join(directory,checkArm+'-'+name+'.log'),'utf8').then(text=>text.slice(-10000),()=>''))):[];
    await writeFile(join(project,'CHANGESET.patch'),patch);
    const evidence=JSON.stringify({checks:row.checks,changedPaths:changed,allowedChanges:row.allowedChanges,acceptanceUnchanged:row.acceptanceUnchanged,outputExcerpts:logs});
    await writeFile(join(project,'CHECK-EVIDENCE.json'),evidence.replaceAll(directory,'<benchmark-output>').replaceAll(arm,'trial'));
    const review=await measuredRecipePhase({executable,cwd:project,model:recipeModels.sonnet,phase:'review',schema:reviewSchema,prompt:'Fresh independent review. The route and author models are intentionally not provided. Read TASK.txt, CHECK-EVIDENCE.json, the affected source and tests'+(kind==='analysis'?', analysis/report.json and original source evidence':'')+'. Assess correctness, architecture safety, scope, errors and regression coverage. Do not edit files. Approve only if acceptance is actually satisfied and no critical/high defects are found. Return concrete findings with exact current file path, 1-based line and short verbatim quote (8..180 chars), not speculation. Distinguish proposed tests from executed checks. Add limitations; API mocks do not prove database integration. Return the required structured JSON.',timeoutMs:180000});
    review.iteration=validationRound;row.phases.push(review);row.qualityReview=review.structured;await writeFile(join(directory,checkArm+'-quality.json'),JSON.stringify(review.structured??{parseFailure:true,answer:review.answer}));
    row.checkHistory.push({iteration:validationRound,checks:row.checks,qualityReview:row.qualityReview,allowedChanges:row.allowedChanges,acceptanceUnchanged:row.acceptanceUnchanged});
    await writeFile(join(project,'CHECK-EVIDENCE.json'),JSON.stringify({checks:row.checks,changedPaths:changed,allowedChanges:row.allowedChanges,acceptanceUnchanged:row.acceptanceUnchanged,outputExcerpts:logs,reviewFeedback:row.qualityReview}).replaceAll(directory,'<benchmark-output>').replaceAll(arm,'trial'));
    const approved=review.structured?.approved===true&&!review.structured?.findings?.some(f=>['critical','high'].includes(f.severity));
    if(row.checks.external.exitCode===0&&row.checks.external.passed===task.testCount&&(kind==='analysis'||(row.checks.own.exitCode===0&&row.checks.own.testExitCode===0&&row.checks.own.passed>=12))&&row.allowedChanges&&row.acceptanceUnchanged&&approved)break;
  }
  const merged=mergeRecipeReceipts(row.phases,prices);Object.assign(row,merged);
  row.phaseCosts=row.phases.map(p=>({phase:p.phase,model:p.model,iteration:p.iteration??0,...mergeRecipeReceipts([p],prices)}));
  const quality=row.qualityReview;
  row.qualityGate=!!quality&&quality.approved===true&&Array.isArray(quality.findings)&&!quality.findings.some(f=>['critical','high'].includes(f.severity));
  row.delegationVerified=!failed&&recipe.steps.every(([phase,family])=>row.phases.some(p=>p.phase===phase&&p.model===recipeModels[family]&&p.receipt.terminalReceipt?.success));
  row.status=!failed&&row.receipt.completeAccounting&&row.delegationVerified&&row.checks.external.exitCode===0&&row.checks.external.passed===task.testCount&&(kind==='analysis'||(row.checks.own.exitCode===0&&row.checks.own.testExitCode===0&&row.checks.own.passed>=12))&&row.allowedChanges&&row.acceptanceUnchanged&&row.qualityGate?'accepted':'incomplete';
  row.semanticReview=row.qualityGate?'passed':'changes-requested';row.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({phase:'measured',taskId,arm,status:row.status,cost:row.totalCost,tokens:row.receipt.totals,checks:row.checks,quality:row.qualityGate}));
  if(row.phases.some(phase=>phase.receipt.stopped==='provider-limit')){row.availabilityFailure='provider-limit';await save();process.exitCode=3;break;}
  if(row.phases.some(phase=>phase.answer.includes('provider could not count next Haiku request'))){row.integrationFailure='context-preflight-unsupported';await save();process.exitCode=4;break;}
}
await saving;console.log(JSON.stringify({report:reportPath}));
