import {isHaiku,HAIKU_GUARD_REASON} from './haiku-context.js';
import {guardHttp} from './haiku-http-guard.js';

export function createContextGuard(){
  let ready=false;
  const contexts=new Map();
  const request=async(api,e,next)=>guardHttp(api,e,next,[...contexts.values()]);
  const settings=async(e,next)=>{
    const result=await next(e);
    if(e.source||next.origin.plugin!=='engine'||e.layers.some(layer=>layer.source==='policy'&&Object.keys(layer.settings??{}).length))return result;
    const settings=result.value??result;if(!settings||typeof settings!=='object')return result;
    const current=settings.modelSettings?.['claude-haiku-5-5']??{};
    const value={...settings,modelSettings:{...settings.modelSettings,'claude-haiku-5-5':{...current,autoCompactWindow:100000}},env:{...settings.env,CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:String(Math.min(Number(settings.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)||90,90))}};
    return result.value?{value}:value;
  };
  const initialize=(policy,auth,base)=>{
    ready=auth?.kind==='bearer'&&policy&&Object.keys(policy).length===0&&(!base||/^https:\/\/api\.anthropic\.com\/?$/u.test(base));
  };
  const step=async function*(e,next,messages){
    if(isHaiku(e.model)&&!ready){
      yield {kind:'text',index:0,text:HAIKU_GUARD_REASON};yield {kind:'stop',stopReason:'end_turn',usage:null};
      return {turnId:e.turnId,index:e.index,answer:HAIKU_GUARD_REASON,toolUses:[],stopReason:'end_turn',usage:null};
    }
    if(!isHaiku(e.model))return yield* next(e);
    if(!Array.isArray(messages))throw Error('Own loop history unavailable');
    const key=e.agentId??'main';
    const context={...contexts.get(key),model:e.model,messages,active:true};contexts.set(key,context);
    try{return yield* next(e);}finally{context.active=false;context.messages=[];}
  };
  const fallback=async function*(e,next){
    if(next.called)return yield* next(e);
    yield {kind:'text',index:0,text:HAIKU_GUARD_REASON};yield {kind:'stop',stopReason:'end_turn',usage:null};
    return {turnId:e.turnId,index:e.index,answer:HAIKU_GUARD_REASON,toolUses:[],stopReason:'end_turn',usage:null};
  };
  return {request,settings,initialize,step,fallback,needsHistory:model=>isHaiku(model)&&ready};
}

export function register(on){
  const guard=createContextGuard();
  on('http.fetch',async($,e,next)=>guard.request({session:{authorize:()=>$.session.authorize()},http:{fetch:(url,init)=>$.http.fetch(url,init)}},e,next)).catch(()=>({deny:'VPR: context guard failed; request blocked'}));
  on('settings.read',async($,e,next)=>guard.settings(e,next));
  on('session.start',async($,e,next)=>{try{guard.initialize(await $.settings.read({source:'policy'}),await $.session.authorize(),await $.env.get('ANTHROPIC_BASE_URL'));}catch{}return next(e);});
  on('turn.step',async function*($,e,next){const messages=guard.needsHistory(e.model)?await $.session.messages({as:'api',...(e.agentId?{agentId:e.agentId}:{})}):null;return yield* guard.step(e,next,messages);}).catch(async function*($,e,next){return yield* guard.fallback(e,next);});
}
