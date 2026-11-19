// VPR staged security guard v1. No network, inference, credentials or bypass flag.
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';

const protectedName=path=>/(?:^|\/)\.vpr\/(?:graphify|runs|benchmarks|usage)\//iu.test(path)||/(?:^|\/)(?:appsettings(?:[._-].*)?|\.env(?:\..*)?|\.envrc|\.npmrc|\.pypirc|credentials(?:\..*)?|id_rsa|id_ed25519)$/iu.test(path)||/\.(?:pfx|p12|pem|key)$/iu.test(path);
const placeholder=value=>/^(?:\s*|null|undefined|true|false|changeme|replace[_-]?me|redacted|example|dummy|test|<[^>]+>|\$\{[^}]+\}|\$(?:env:)?[A-Z_][A-Z0-9_]*|%[A-Z_]+%)$/iu.test(value)||/^(?:process\.env\.|os\.environ|Environment\.GetEnvironmentVariable)/u.test(value);
const rules=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/gu],
  ['provider-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|sk-(?:ant-[A-Za-z0-9_-]{20,}|proj-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,}))\b/gu],
  ['credential-url',/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?):\/\/[^\s/:"']+:[^\s/@"']+@/gu],
  ['jwt',/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/gu],
];

export function secretFindings(path,content){
  const findings=[];
  const add=(rule,index)=>findings.push({path,rule,line:content.slice(0,index).split('\n').length});
  for(const [rule,pattern] of rules){pattern.lastIndex=0;for(const match of content.matchAll(pattern))add(rule,match.index);}
  const assignments=/["']?(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|auth[_-]?token|secret[_-]?key|signing[_-]?key)["']?\s*[:=]\s*["']?(\$\{[^}]+\}|[^\s"'`,;\}\r\n]+)/giu;
  for(const match of content.matchAll(assignments))if(!placeholder(match[1]))add('sensitive-assignment',match.index);
  return findings;
}

export function approvalText(repository,path,sha256,expiresAt){
  return 'VPR-CONFIG-APPROVAL-V1\n'+JSON.stringify({repository,path,sha256,expiresAt});
}
export function validApproval(approval,{repository,path,sha256,ownerPublicKey,now=Date.now()}){
  try{
    if(!ownerPublicKey||approval.path!==path||approval.sha256!==sha256||typeof approval.expiresAt!=='string'||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=now||Date.parse(approval.expiresAt)>now+86400000)return false;
    const key=createPublicKey(ownerPublicKey);if(key.asymmetricKeyType!=='ed25519')return false;
    return verify(null,Buffer.from(approvalText(repository,path,sha256,approval.expiresAt)),key,Buffer.from(approval.signature,'base64'));
  }catch{return false;}
}

function git(cwd,args){
  const env={...process.env};
  for(const key of Object.keys(env))if(/^GIT_CONFIG(?:_|$)/u.test(key))delete env[key];
  return execFileSync('git',args,{cwd,env,windowsHide:true,timeout:5000,maxBuffer:12*1024*1024,stdio:['ignore','pipe','pipe']});
}
export function checkStagedSecurity(cwd=process.cwd(),{now=Date.now(),base}={}){
  if(base!==undefined&&!/^[a-f0-9]{40,64}$/u.test(base))throw Error('Invalid security comparison base');
  const repository=realpathSync(git(cwd,['rev-parse','--show-toplevel']).toString().trim());
  const gitDir=git(repository,['rev-parse','--absolute-git-dir']).toString().trim();
  let ownerPublicKey=null,approvals=[];
  // Trust is configured outside repository/user/env scopes by the machine owner.
  // No private key, signing operation or local approval issuer is provided.
  try{const path=git(repository,['config','--system','--get','vpr.securityOwnerKey']).toString().trim();ownerPublicKey=readFileSync(path,'utf8');}catch{}
  try{approvals=JSON.parse(readFileSync(join(gitDir,'vpr-config-approvals.json'),'utf8')).approvals;if(!Array.isArray(approvals))approvals=[];}catch{}
  const paths=git(repository,['diff','--cached',...(base?[base]:[]),'--name-only','--diff-filter=ACMR','-z']).toString().split('\0').filter(Boolean);
  const findings=[],requests=[];
  for(const path of paths){
    const size=Number(git(repository,['cat-file','-s',':'+path]).toString().trim());
    if(!Number.isSafeInteger(size)||size>8*1024*1024){findings.push({path,rule:'file-too-large-for-local-scan',line:null});continue;}
    const blob=git(repository,['cat-file','blob',':'+path]),sha256=createHash('sha256').update(blob).digest('hex');
    findings.push(...secretFindings(path,blob.toString('utf8')));
    if(protectedName(path)&&!approvals.some(approval=>validApproval(approval,{repository,path,sha256,ownerPublicKey,now}))){
      const expiresAt=new Date(now+3600000).toISOString();
      findings.push({path,rule:'owner-approval-required',line:null});requests.push({repository,path,sha256,expiresAt,signingText:approvalText(repository,path,sha256,expiresAt)});
    }
  }
  return {passed:findings.length===0,filesScanned:paths.length,findings,approvalRequests:requests,inferenceTokens:0,scope:'Staged Git blobs; heuristic detection cannot identify every secret. Config approval never exempts detected secrets.'};
}

export function securityMain(){
  try{const result=checkStagedSecurity();console.log(JSON.stringify(result,null,2));return result.passed?0:1;}
  catch{console.error('VPR: no se pudo inspeccionar el contenido preparado. Commit bloqueado; no se imprimen contenidos ni secretos.');return 1;}
}
