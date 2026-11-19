import {readdir,readFile,readlink,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative,resolve} from 'node:path';

const skipped=new Set(['node_modules','.git','.vpr','.venv','venv','dist','coverage','.next','.angular','obj','target']);
const testFile=(path:string)=>/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/iu.test(path);
export async function nativeWorkspace(root:string,extraPaths:readonly string[]){
  const files=new Map<string,string>();let size=0,entries=0;
  const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
  async function file(path:string){
    const metadata=await stat(join(root,path));if(!metadata.isFile())return;
    size+=metadata.size;if(size>268435456)throw Error('Workspace snapshot exceeds 256 MiB');
    files.set(path,hash(await readFile(join(root,path))));
  }
  async function visit(directory:string){
    for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
      if(++entries>20000)throw Error('Workspace snapshot exceeds 20000 entries');
      const path=(directory?directory+'/':'')+entry.name;
      if(entry.isSymbolicLink())files.set(path,'link:'+hash(await readlink(join(root,path))));
      else if(entry.isDirectory()){if(!skipped.has(entry.name))await visit(path);}
      else if(entry.isFile())await file(path);
    }
  }
  await visit('');
  for(const path of extraPaths){
    const local=relative(root,resolve(root,path)).replaceAll('\\','/');
    if(local==='..'||local.startsWith('../')||/^[a-z]:/iu.test(local))continue;
    try{await file(local);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;files.set(local,'missing');}
  }
  return files;
}

export function verifyNativeWorkspace(before:ReadonlyMap<string,string>,after:ReadonlyMap<string,string>,allowed:readonly string[],protectedPaths:readonly string[],allowTestChanges=false){
  const changes=[...new Set([...before.keys(),...after.keys()])].filter(path=>before.get(path)!==after.get(path));
  const normalized=allowed.map(path=>path.replaceAll('\\','/').replace(/^\.\//u,'').replace(/\/$/u,''));
  const protectedSet=new Set(protectedPaths.map(path=>path.replaceAll('\\','/')));
  const rejected=changes.filter(path=>protectedSet.has(path)||(!allowTestChanges&&before.has(path)&&testFile(path))||!normalized.some(prefix=>prefix==='.'||path===prefix||path.startsWith(prefix+'/')));
  return {passed:rejected.length===0,changedPaths:changes,rejectedPaths:rejected};
}
