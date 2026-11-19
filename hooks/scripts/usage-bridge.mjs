import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {accountKey,recordUsage,readUsage,formatUsage,claudeReferenceCost,recordAccountObservation} from '../lib/usage-ledger.mjs';
let content='';for await(const chunk of process.stdin){content+=chunk.toString();if(content.length>32768)throw Error('Usage input too large');}
const input=JSON.parse(content||'{}'),action=process.argv[2];
if(action==='identify'){
  let key=null;try{const result=await promisify(execFile)('claude',['auth','status'],{windowsHide:true,timeout:3500,maxBuffer:65536});const status=JSON.parse(result.stdout);if(status.loggedIn&&status.authMethod==='claude.ai'&&typeof status.email==='string')key=await accountKey('claude',status.email+'|'+(status.orgId??''));}catch{}
  console.log(JSON.stringify({accountKey:key}));
}else if(action==='record'){
  if(process.env.VPR_CAPTURE_DISABLED==='1'){console.log('{}');process.exit(0);}
  let prices=null;for(const relative of ['../../data/model-prices.json','../../../data/model-prices.json','../../docs/research/model-price-catalog.json'])try{prices=JSON.parse(await readFile(new URL(relative,import.meta.url),'utf8'));break;}catch{}
  const u=input.usage??{};await recordUsage({...input,inputTokens:u.input_tokens,outputTokens:u.output_tokens,cacheReadTokens:u.cache_read_input_tokens,cacheWriteTokens:u.cache_creation_input_tokens,inputSemantics:'uncached',cost:claudeReferenceCost(input.model,u,prices),complete:true});console.log('{}');
}else if(action==='report'){const report=await readUsage(input);console.log(JSON.stringify({text:formatUsage(report)}));}
else if(action==='observe'){await recordAccountObservation(input);console.log('{}');}
else throw Error('Unknown usage operation');
