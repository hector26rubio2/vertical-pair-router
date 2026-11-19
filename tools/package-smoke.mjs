import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,cp,readFile,realpath} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
const cli=resolve(process.argv[2]??'.tmp/package-smoke/node_modules/vertical-pair-router/bin/vpr.mjs');
const root=await mkdtemp(join(tmpdir(),'vpr-archive-smoke-'));
try{
  await writeFile(join(root,'package.json'),JSON.stringify({name:'archive-smoke'}));
  const call=args=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576}));
  const doctor=call(['tools','doctor','--project',root]);assert.equal(doctor.inferenceTokens,0);assert.equal(typeof doctor.graphify.available,'boolean');
  const preview=call(['init','--project',root,'--integrations','none']);assert.equal(preview.applied,false);
  const applied=call(['init','--project',root,'--integrations','none','--apply']);assert.equal(applied.applied,true);
  const packageRoot=resolve(cli,'../..');
  const isolatedPlugin=join(root,'cached-plugin');
  await cp(join(packageRoot,'plugin'),isolatedPlugin,{recursive:true});
  const lock=JSON.parse(await readFile(join(isolatedPlugin,'npm-shrinkwrap.json'),'utf8'));
  const manifest=JSON.parse(await readFile(join(isolatedPlugin,'package.json'),'utf8'));
  assert.deepEqual(lock.packages[''].dependencies,manifest.dependencies);
  // Reproduce the no-scripts, frozen dependency install used by Claude's cache.
  const {resolveProgramCommand}=await import('../packages/runtime/dist/package-manager.js');
  const npm=await resolveProgramCommand('npm');assert.ok(npm,'npm must be available for the cached plugin install');
  execFileSync(npm.program,[...npm.prefix,'ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:isolatedPlugin,windowsHide:true,timeout:120000,maxBuffer:1048576});
  const cachedCli=join(isolatedPlugin,'bin/vpr.mjs');
  const cachedDoctor=JSON.parse(execFileSync(process.execPath,[cachedCli,'tools','doctor','--project',root],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true}));
  assert.equal(cachedDoctor.inferenceTokens,0);
  assert.equal(await realpath(resolve(execFileSync(process.execPath,[cachedCli,'plugin','path'],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true}).trim())),await realpath(isolatedPlugin));
  const prices=JSON.parse(execFileSync(process.execPath,[cachedCli,'models','prices','--provider','claude'],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true}));assert.equal(prices.inferenceTokens,0);assert.ok(prices.catalog.cards.length);
  console.log(JSON.stringify({passed:true,archiveCli:cli,checks:['single-json-output','tools-doctor','init-preview','init-apply','copied-plugin-frozen-dependencies','copied-plugin-cli','copied-plugin-catalogs'],inferenceTokens:0}));
}finally{const local=relative(await realpath(tmpdir()),await realpath(root));assert.ok(local&&!local.startsWith('..')&&!/^[a-z]:/iu.test(local));await rm(root,{recursive:true,force:true});}
