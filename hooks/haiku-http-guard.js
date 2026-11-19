import {isHaiku,HAIKU_COMPACT_AT} from './haiku-context.js';

// Cache placement and effort are controls, not prompt text. Preserve tool input
// objects verbatim: recursively deleting arbitrary keys could undercount data.
function countBlocks(value){
  return Array.isArray(value)?value.map(({cache_control,...block})=>block.type==='tool_result'?{...block,content:countBlocks(block.content)}:block):value;
}
export function countPayload(body){
  const payload={};
  for(const key of ['model','messages','system','tools','tool_choice','thinking','output_config'])if(body[key]!==undefined)payload[key]=body[key];
  if(!Array.isArray(payload.messages))throw Error('Missing request messages');
  payload.messages=payload.messages.map(message=>({role:message.role,content:countBlocks(message.content)}));
  if(payload.system!==undefined)payload.system=countBlocks(payload.system);
  if(payload.tools!==undefined)payload.tools=payload.tools.map(({cache_control,...tool})=>tool);
  if(payload.thinking&&typeof payload.thinking==='object'){
    const {display,...thinking}=payload.thinking;payload.thinking=thinking;
  }
  return payload;
}

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function normalizedMessages(messages){
  return countPayload({messages}).messages.map(message=>({...message,content:typeof message.content==='string'?[{type:'text',text:message.content}]:message.content}));
}
function matchesTail(full,tail){
  return full.length>=tail.length&&JSON.stringify(canonical(full.slice(full.length-tail.length)))===JSON.stringify(canonical(tail));
}
export function resolveCountPayload(body,contexts=[]){
  const payload=countPayload(body),tail=normalizedMessages(body.messages);
  const active=contexts.filter(context=>context.active&&isHaiku(context.model));
  const ids=new Set((Array.isArray(tail[0]?.content)?tail[0].content:[]).filter(block=>block.type==='tool_result').map(block=>block.tool_use_id));
  const candidates=active.filter(context=>matchesTail(normalizedMessages(context.messages),tail)||
    (ids.size>0&&[...ids].every(id=>context.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_use'&&block.id===id)))));
  if(body.thread?.type==='continue'){
    // A continuation carries ONLY new messages. Counting that suffix would
    // underestimate context and can also begin with an unpaired tool_result.
    if(candidates.length!==1||!candidates[0].prefix)throw Error('Thread history unavailable or ambiguous');
    const context=candidates[0];
    let messages=context.messages;
    if(!matchesTail(normalizedMessages(messages),tail)){
      // A suffix may span several tool rounds. Replacing individual results
      // duplicates/reorders the intervening assistant calls. Splice at the
      // first result's originating assistant, then use the actual full suffix.
      let boundary=-1;
      if(ids.size)for(let index=messages.length-1;index>=0;index--){const message=messages[index];if(message.role==='assistant'&&[...ids].every(id=>Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_use'&&block.id===id))){boundary=index+1;break;}}
      else for(let index=messages.length-1;index>=0;index--)if(JSON.stringify(canonical(normalizedMessages([messages[index]])[0]))===JSON.stringify(canonical(tail[0]))){boundary=index;break;}
      if(boundary<0)throw Error('Thread suffix boundary unavailable');
      messages=[...messages.slice(0,boundary),...body.messages];
    }
    return countPayload({...context.prefix,...body,messages,system:context.prefix.system,tools:context.prefix.tools});
  }
  if(body.thread?.type==='create'&&(candidates.length===1||active.length===1)){
    (candidates.length===1?candidates[0]:active[0]).prefix={...(body.system!==undefined?{system:body.system}:{}),...(body.tools!==undefined?{tools:body.tools}:{})};
  }
  return payload;
}

export async function guardHttp(api,e,next,contexts=[]){
  if(next.origin.plugin!=='engine'||!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/u.test(e.url))return next(e);
  let body;try{body=JSON.parse(e.init?.body);}catch{return {deny:'VPR: request body could not be counted; no message sent'};}
  if(!isHaiku(body.model))return next(e);
  let payload;try{payload=resolveCountPayload(body,contexts);}catch{return {deny:'VPR: complete thread context unavailable or ambiguous; no message sent'};}
  const auth=await api.session.authorize();
  if(!auth||auth.kind!=='bearer')return {deny:'VPR: native subscription authorization unavailable for context preflight'};
  const headers={'content-type':'application/json','anthropic-version':'2026-10-21'};
  for(const [key,value] of Object.entries(e.init?.headers??{}))if(key.toLowerCase()==='anthropic-beta')headers[key]=value;
  const counted=await api.http.fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',auth:auth.handle,headers,body:JSON.stringify(payload)});
  let tokens;try{tokens=JSON.parse(counted.text).input_tokens;}catch{}
  if(!counted.ok||!Number.isSafeInteger(tokens)||tokens<0){
    let field='unknown',reason='unsupported-input';try{
      const error=JSON.parse(counted.text).error?.message??'';field=error.match(/^[a-z][a-z0-9_.\[\]-]{0,100}(?=:)/iu)?.[0]??'unknown';
      if(/empty/iu.test(error))reason='empty-block';
      else if(/extra inputs/iu.test(error))reason='unsupported-field';
      else if(/Input tag/iu.test(error))reason='unsupported-block-type';
    }catch{}
    const first=body.messages?.[0]?.content?.[0];
    const shape=first&&typeof first==='object'?String(first.type??'unknown').replace(/[^a-z_0-9]/giu,'').slice(0,40)+':'+Object.keys(first).filter(key=>/^[a-z_]{1,40}$/iu.test(key)).join(',')+':textLength='+String(typeof first.text==='string'?first.text.length:'N/A'):'scalar';
    return {deny:'VPR: provider could not count next Haiku request (status '+counted.status+', field '+field+', reason '+reason+', shape '+shape+'); no message sent'};
  }
  // Provider counts are estimates. Keep 10K below the expensive tier rather
  // than treating the 100K price boundary as a dispatch target.
  if(tokens>=HAIKU_COMPACT_AT)return {deny:'VPR: next Haiku request reaches '+tokens+' estimated input tokens; compact or checkpoint before continuing. No message sent.'};
  return next(e);
}
