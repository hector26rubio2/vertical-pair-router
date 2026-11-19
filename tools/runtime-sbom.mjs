import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function runtimeSbom(source){
  const bytes=await readFile('tools/plugin-runtime/npm-shrinkwrap.json');
  const lock=JSON.parse(bytes),root='pkg:npm/'+source.name+'@'+source.version;
  const components=Object.entries(lock.packages).filter(([path])=>path).map(([path,value])=>{
    const name=value.name??path.split('node_modules/').at(-1),ref='pkg:npm/'+name+'@'+value.version;
    return {type:'library',name,version:value.version,'bom-ref':ref,scope:value.optional?'optional':'required',...(value.license?{licenses:[{license:{id:value.license}}]}:{}),properties:[{name:'vpr:lockfile-integrity',value:value.integrity??'unavailable'}]};
  });
  return {bomFormat:'CycloneDX',specVersion:'1.5',version:1,metadata:{component:{type:'application',name:source.name,version:source.version,'bom-ref':root},properties:[{name:'vpr:inventory-basis',value:'Pinned runtime lockfile, including optional platforms; not a claim that every component is installed.'},{name:'vpr:runtime-lock-sha256',value:createHash('sha256').update(bytes).digest('hex')}]},components};
}
