import {readFile} from 'node:fs/promises';
import {dirname,isAbsolute,resolve,join,delimiter} from 'node:path';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {resolveExecutable} from './resolve-executable.js';

/** An explicit standalone CLI selection never silently falls back to Desktop. */
export async function resolveCodexExecutable(environment:NodeJS.ProcessEnv=process.env,platform=process.platform){
  const selected=environment.VPR_CODEX_CLI;
  if(selected)return isAbsolute(selected)?resolveExecutable(selected,environment):null;
  if(platform==='win32'){
    // npm's Windows .cmd launcher is not an executable and must not be passed
    // through a shell. Resolve its official native optional dependency instead.
    const nodeDirectory=dirname(process.execPath);
    const directories=[...(environment.PATH??environment.Path??'').split(delimiter).filter(Boolean),nodeDirectory,
      // Volta keeps globally installed packages outside its selected Node image.
      resolve(nodeDirectory,'../../packages/@openai/codex')];
    for(const directory of new Set(directories)){
      const root=join(directory,'node_modules','@openai','codex');
      let manifest;try{manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));}catch{continue;}
      if(manifest.name!=='@openai/codex')continue;
      const arch=process.arch==='arm64'?'arm64':'x64',triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
      let vendor=join(root,'vendor');
      try{vendor=join(dirname(createRequire(join(root,'package.json')).resolve('@openai/codex-win32-'+arch+'/package.json')),'vendor');}catch{}
      const binary=await resolveExecutable(join(vendor,triple,'bin','codex.exe'),environment);if(binary)return binary;
    }
  }
  return resolveExecutable('codex',environment);
}

export async function codexLaunchEnvironment(executable:string,environment:NodeJS.ProcessEnv,platform=process.platform){
  const env={...environment};
  if(platform!=='win32')return env;
  // The independent official npm binary has no MSIX package identity. Keep the
  // configured sandbox/managed policy; remove only inherited Desktop launch hints.
  const packageRoot=dirname(dirname(dirname(dirname(executable))));
  let manifest;try{manifest=JSON.parse(await readFile(resolve(packageRoot,'package.json'),'utf8'));}catch{return env;}
  const officialPlatformPackage=/^@openai\/codex-win32-(?:x64|arm64)$/u.test(String(manifest.name))||
    (manifest.name==='@openai/codex'&&/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)*-win32-(?:x64|arm64)$/u.test(String(manifest.version))&&manifest.repository?.url==='git+https://github.com/openai/codex.git');
  if(!officialPlatformPackage)return env;
  for(const key of ['CODEX_WINDOWS_REGISTERED_CORE','CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY','CODEX_APP_RUNTIME_CLI_PATH'])delete env[key];
  return env;
}

/** Fixed local command, no inference. Never changes provisioning or permissions. */
export function probeCodexWindowsExecution(executable:string,cwd:string,env:NodeJS.ProcessEnv,signal?:AbortSignal):Promise<{ready:boolean;diagnostic:string|null}>{
  return new Promise(resolveResult=>{
    execFile(executable,['--no-daemon','sandbox','--include-managed-config','--permission-profile',':workspace','--sandbox-state-disable-network','-C',cwd,'cmd.exe','/d','/c','echo','VPR_EXECUTION_READY'],
      {cwd,env,windowsHide:true,timeout:15000,maxBuffer:32768,...(signal?{signal}:{})},(error,stdout,stderr)=>{
        if(!error&&stdout.trim()==='VPR_EXECUTION_READY')return resolveResult({ready:true,diagnostic:null});
        const reason=/registered Core launch requires an installed app/u.test(stderr)?'Codex Desktop CLI lacks Windows package identity; select the official standalone CLI with VPR_CODEX_CLI':
          /setup|provision|registration/iu.test(stderr)?'Codex Windows execution provisioning is not ready; run the native Codex diagnostic':
          'Codex Windows execution preflight failed; inspect the native CLI locally';
        resolveResult({ready:false,diagnostic:reason});
      });
  });
}
