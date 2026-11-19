import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexLaunchEnvironment,resolveCodexExecutable} from './codex-launch.js';

test('standalone Codex removes only Desktop launch identity for the official native npm package',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-codex-launch-'));context.after(()=>rm(root,{recursive:true,force:true}));
  const executable=join(root,'vendor','x86_64-pc-windows-msvc','bin','codex.exe');
  await mkdir(join(root,'vendor','x86_64-pc-windows-msvc','bin'),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({name:'@openai/codex',version:'0.170.0-win32-x64',repository:{url:'git+https://github.com/openai/codex.git'}}));
  const environment={VPR_CODEX_CLI:executable,CODEX_WINDOWS_REGISTERED_CORE:'1',CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY:'Desktop',CODEX_APP_RUNTIME_CLI_PATH:'Desktop.exe',CODEX_PERMISSION_PROFILE:':workspace',PATH:'unchanged'};
  const launch=await codexLaunchEnvironment(executable,environment,'win32');
  assert.equal(launch.CODEX_WINDOWS_REGISTERED_CORE,undefined);assert.equal(launch.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY,undefined);
  assert.equal(launch.CODEX_PERMISSION_PROFILE,':workspace');assert.equal(launch.PATH,'unchanged');assert.equal(environment.CODEX_WINDOWS_REGISTERED_CORE,'1');
  assert.equal((await codexLaunchEnvironment(executable,{...environment,VPR_CODEX_CLI:undefined},'win32')).CODEX_WINDOWS_REGISTERED_CORE,undefined);
  assert.deepEqual(await codexLaunchEnvironment(join(root,'Desktop.exe'),environment,'win32'),environment);
  await writeFile(join(root,'package.json'),JSON.stringify({name:'another-package'}));
  assert.deepEqual(await codexLaunchEnvironment(executable,environment,'win32'),environment);
});

test('invalid explicit Codex selection fails closed instead of executing a different installation',async()=>{
  assert.equal(await resolveCodexExecutable({VPR_CODEX_CLI:'relative-codex'}),null);
  assert.equal(await resolveCodexExecutable({VPR_CODEX_CLI:join(tmpdir(),'missing-vpr-codex-cli.exe')}),null);
});

test('Windows npm installation resolves its native Codex binary without executing a command shim',async context=>{
  const root=await mkdtemp(join(tmpdir(),'vpr-codex-npm-'));context.after(()=>rm(root,{recursive:true,force:true}));
  const packageRoot=join(root,'node_modules','@openai','codex'),triple=process.arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
  const bin=join(packageRoot,'vendor',triple,'bin'),executable=join(bin,'codex.exe');
  await mkdir(bin,{recursive:true});await writeFile(join(packageRoot,'package.json'),JSON.stringify({name:'@openai/codex'}));
  await writeFile(executable,'fixture');await import('node:fs/promises').then(fs=>fs.chmod(executable,0o700));
  assert.equal(await resolveCodexExecutable({PATH:root},'win32'),executable);
});
