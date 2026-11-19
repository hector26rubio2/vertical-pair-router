import {createContextGuard} from './guard-module.js';

async function bridge(run,root,action,input){
  const result=await run(['node',root+'/hooks/scripts/usage-bridge.mjs',action],{stdin:JSON.stringify(input),timeoutMs:5000});
  if(result.exitCode!==0)throw Error('Local usage collector unavailable');return JSON.parse(result.stdout);
}
async function runWorkflow(run,spawn,root,cwd,sessionId,argument){
  const preview=/^--preview(?:\s|$)/u.test(argument);
  let file=preview?argument.replace(/^--preview\s*/u,''):argument;
  if(file.length>=2&&['"',"'"].includes(file[0])&&file.at(-1)===file[0])file=file.slice(1,-1);
  if(!file||file.includes('\0'))throw Error('A task file is required');
  const candidates=[root+'/bin/vpr.mjs',root+'/../bin/vpr.mjs',root+'/packages/cli/dist/bin.js'];
  const probe=await run(['node','--input-type=module','-e','import {access} from "node:fs/promises"; for(const file of process.argv.slice(1))try{await access(file);console.log(file);process.exit(0);}catch{} process.exit(2);',...candidates],{timeoutMs:5000});
  if(probe.exitCode!==0)throw Error('VPR executable missing from plugin installation');
  // Native process.run is capped at ten minutes. The owned stream keeps
  // cancellation attached to the command while the CLI enforces its own deadline.
  const stream=spawn({argv:['node',probe.stdout.trim(),'agent','run','--project',cwd,'--input',file,...(preview?['--preview']:[])],env:{VPR_PARENT_SESSION:sessionId}});
  let stdout='',finished=false;
  try{
    for(;;){const part=await stream.next();if(part.done){finished=true;return {stdout,exitCode:part.value.code??1};}if(part.value.stream==='stdout'){stdout+=part.value.text;if(stdout.length>1048576)throw Error('Workflow output exceeded the bounded receipt size');}}
  }finally{if(!finished)await stream.return();}
}
export function register(on){
  const guard=createContextGuard();
  on('http.fetch',async($,e,next)=>guard.request({session:{authorize:()=>$.session.authorize()},http:{fetch:(url,init)=>$.http.fetch(url,init)}},e,next)).catch(()=>({deny:'VPR: context guard failed; request blocked'}));
  on('settings.read',async($,e,next)=>guard.settings(e,next));
  let account=null;
  on('session.start',async($,e,next)=>{
    try{guard.initialize(await $.settings.read({source:'policy'}),await $.session.authorize(),await $.env.get('ANTHROPIC_BASE_URL'));}catch{}
    try{account=(await bridge((argv,options)=>$.process.run(argv,options),$.plugin.root,'identify',{})).accountKey;}catch{}
    await $.command.register({name:'vpr-use',description:'Consumo por sesión, cuenta, proveedor y modelo; sin inferencia',argumentHint:'[all|account]',immediate:true});
    await $.command.register({name:'vpr-run',description:'Ejecuta una tarea JSON con proveedores autorizados y registra su consumo',argumentHint:'[--preview] <tarea.json>',immediate:true});
    return next(e);
  });
  on('turn.step',async function*($,e,next){
    const started=Date.now();
    const messages=guard.needsHistory(e.model)?await $.session.messages({as:'api',...(e.agentId?{agentId:e.agentId}:{})}):null;
    const result=yield* guard.step(e,next,messages);
    if(result?.usage){const u=result.usage;try{await bridge((argv,options)=>$.process.run(argv,options),$.plugin.root,'record',{provider:'claude',sessionId:await $.session.id(),accountKey:account,id:e.turnId+':'+e.index+':'+(e.agentId??'main'),model:u.model,agent:e.agentId??'main',role:e.agentId?'subagent':'main',wallMs:Math.max(0,Date.now()-started),usage:u});}catch{$.ui.log('VPR: no se pudo guardar la medición local.');}}
    return result;
  }).catch(async function*($,e,next){return yield* guard.fallback(e,next);});
  on('session.measure',async($,e,next)=>{
    if(account)try{await bridge((argv,options)=>$.process.run(argv,options),$.plugin.root,'observe',{provider:'claude',accountKey:account,context:e.context,windows:e.rateLimits});}catch{}
    return next(e);
  });
  on('command.run',{command:'vpr-use'},async($,e)=>{
    const live=await $.session.usage();
    const parts=e.args.trim().split(/\s+/u),scope=parts.includes('all')?'machine':parts.includes('account')?'account':'session';
    let report;try{report=await bridge((argv,options)=>$.process.run(argv,options),$.plugin.root,'report',{scope,sessionId:await $.session.id(),account,detail:parts.includes('detail')});}catch{report={text:'VPR: registro local no disponible; consumo desconocido.'};}
    const limits=live.rateLimits.map(w=>w.kind+': '+Math.max(0,100-w.percentUsed)+'% restante'+(w.resetsAt?' · reinicia '+w.resetsAt:'')).join('\n')||'Cuota de cuenta: no disponible';
    const text=report.text+'\nModelo actual: '+await $.session.model()+'\nContexto actual: '+(live.context.tokens??'N/D')+' / '+live.context.window+' tokens\n'+limits+'\nCosto estimado del host Claude: '+(live.cost?.usd??'N/D')+' USD. No se suma otra vez al desglose.';
    // ui.log is display-only in the native contract. Command text would enter
    // later model prompts even with an empty context array.
    for(let at=0;at<text.length;at+=1800)$.ui.log(text.slice(at,at+1800));
    return {context:[],exitCode:0};
  });
  on('command.run',{command:'vpr-run'},async($,e)=>{
    if(!e.args.trim()){$.ui.log('Uso: /vpr-run ruta/tarea.json');return {context:[],exitCode:2};}
    const result=await runWorkflow((argv,options)=>$.process.run(argv,options),request=>$.process.spawn(request),$.plugin.root,await $.session.cwd(),await $.session.id(),e.args.trim());
    try{const receipt=JSON.parse(result.stdout);$.ui.log('VPR: '+(receipt.state??receipt.decision?.status??'desconocido')+' · '+(receipt.receipt??'sin ejecución')+'\nUsa /vpr-use para el desglose de consumo.');if(typeof receipt.reviewSummary==='string')for(let at=0;at<receipt.reviewSummary.length;at+=1800)$.ui.log(receipt.reviewSummary.slice(at,at+1800));}
    catch{$.ui.log('VPR no completó la ejecución. Comprueba el perfil, el archivo de tarea y los permisos del host.');}
    return {context:[],exitCode:result.exitCode??1};
  });
}
