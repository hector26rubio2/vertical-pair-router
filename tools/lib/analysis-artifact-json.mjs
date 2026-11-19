export function parseAnalysisArtifact(text) {
  if(typeof text!=='string'||text.length>200000)return null;
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.summary==='string'&&Array.isArray(value.tasks)&&Array.isArray(value.currentFlows)&&Array.isArray(value.risks);
  try{const value=JSON.parse(text);if(object(value))return value;}catch{}
  // Some native CLIs wrap the requested artifact in Markdown or a preface.
  // Parse balanced objects, respecting strings; never eval generated content.
  let start=-1,depth=0,quoted=false,escaped=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(start<0){if(c==='{'){start=i;depth=1;}continue;}
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{const value=JSON.parse(text.slice(start,i+1));if(object(value))return value;}catch{}start=-1;}
  }
  return null;
}

const str={type:'string'},strings={type:'array',items:str};
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const list=items=>({type:'array',items});
const evidence=list(obj({path:str,line:{type:'integer'},quote:str}));
export const analysisSchema=obj({summary:str,currentFlows:list(obj({name:str,status:str,evidence})),risks:list(obj({title:str,impact:str,evidence,mitigation:str})),tasks:list(obj({id:str,title:str,layer:str,files:strings,dependsOn:strings,acceptance:strings})),openDecisions:strings,migration:strings,rollback:strings,testPlan:list(obj({name:str,layer:str,acceptance:strings}))});
