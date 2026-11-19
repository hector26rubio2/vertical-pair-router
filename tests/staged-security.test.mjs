import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {secretFindings,checkStagedSecurity,approvalText,validApproval} from '../packages/quality/src/staged-security.mjs';

test('scanner checks staged content, blocks settings and never prints matched secret values',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-secret-scan-'));context.after(()=>rm(root,{recursive:true,force:true}));
  const git=args=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','pipe']});git(['init']);
  const secret=['ghp','A'.repeat(36)].join('_');
  await writeFile(join(root,'safe.ts'),'export const meaning = 42;\n');git(['add','safe.ts']);
  assert.equal(checkStagedSecurity(root).passed,true);
  await writeFile(join(root,'safe.ts'),secret);assert.equal(checkStagedSecurity(root).passed,true,'unstaged contents are not falsely attributed to this commit');
  git(['add','safe.ts']);let report=checkStagedSecurity(root);assert.equal(report.passed,false);assert.ok(report.findings.some(f=>f.rule==='provider-token'));assert.ok(!JSON.stringify(report).includes(secret));
  await writeFile(join(root,'safe.ts'),'export const meaning = 42;\n');git(['add','safe.ts']);
  await writeFile(join(root,'appsettings.Production.json'),'{}');git(['add','appsettings.Production.json']);
  process.env.VPR_ALLOW_SECRETS='1';process.env.VPR_ALLOW_APPSETTINGS='1';
  try{report=checkStagedSecurity(root);assert.equal(report.passed,false);assert.equal(report.approvalRequests[0].path,'appsettings.Production.json');}finally{delete process.env.VPR_ALLOW_SECRETS;delete process.env.VPR_ALLOW_APPSETTINGS;}
});

test('owner approval is signed for the exact repository/path/blob and expires; no environment boolean can approve',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');const ownerPublicKey=publicKey.export({type:'spki',format:'pem'});
  const now=Date.now(),expiresAt=new Date(now+60000).toISOString(),repository='/isolated/repo',path='appsettings.json',sha256='f'.repeat(64);
  const signature=sign(null,Buffer.from(approvalText(repository,path,sha256,expiresAt)),privateKey).toString('base64');
  const approval={path,sha256,expiresAt,signature},request={repository,path,sha256,ownerPublicKey,now};
  assert.equal(validApproval(approval,request),true);
  for(const update of [{sha256:'e'.repeat(64)},{repository:'/another/repo'},{path:'.env'},{now:now+120000},{ownerPublicKey:null}])assert.equal(validApproval(approval,{...request,...update}),false);
  assert.equal(secretFindings(path,'api_key="'+['sk','proj','x'.repeat(40)].join('-')+'"').length>0,true,'an approved filename still undergoes independent secret detection');
});

test('detects credential assignments and private keys while allowing explicit environment references',()=>{
  assert.equal(secretFindings('source.ts','api_key = process.env.PROVIDER_KEY').length,0);
  assert.equal(secretFindings('config.json','{"password":"${DATABASE_PASSWORD}"}').length,0);
  assert.ok(secretFindings('source.ts',['password','=', 'supersecretvalue'].join(' ')).some(f=>f.rule==='sensitive-assignment'));
  assert.ok(secretFindings('source.ts',['-----BEGIN ','PRIVATE KEY-----'].join('')).some(f=>f.rule==='private-key'));
});
