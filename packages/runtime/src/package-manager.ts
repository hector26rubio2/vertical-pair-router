import {access} from 'node:fs/promises';
import {dirname,join,delimiter} from 'node:path';
import {resolveExecutable} from './resolve-executable.js';

/** Run npm/pnpm/yarn without invoking a Windows .cmd shell or string command. */
export async function resolveProgramCommand(program:string,environment:Readonly<Record<string,string|undefined>>=process.env):Promise<{program:string;prefix:readonly string[]}|null>{
  const native=await resolveExecutable(program,environment);if(native)return {program:native,prefix:[]};
  const scripts:Record<string,string>={npm:'npm/bin/npm-cli.js',pnpm:'pnpm/bin/pnpm.cjs',yarn:'yarn/bin/yarn.js'};
  const script=scripts[program];if(!script)return null;
  const directories=[...(environment.PATH??environment.Path??'').split(delimiter).filter(Boolean),dirname(process.execPath)];
  for(const directory of new Set(directories)){
    const path=join(directory,'node_modules',script);
    try{await access(path);return {program:process.execPath,prefix:[path]};}catch{}
  }
  return null;
}
