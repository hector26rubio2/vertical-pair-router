import ts from 'typescript';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
const at=process.argv.indexOf('--report');if(at<0)throw Error('--report required');
const path=resolve(process.argv[at+1]),report=JSON.parse(await readFile(path,'utf8'));
const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
async function functions(directory){const values=new Map();for(const name of await readdir(directory)){if(!name.endsWith('.ts')||name.endsWith('.test.ts'))continue;
  const text=(await readFile(join(directory,name),'utf8')).replaceAll('\r\n','\n'),source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);
  for(const node of source.statements)if(ts.isFunctionDeclaration(node)&&node.name&&node.body)values.set(node.name.text,printer.printNode(ts.EmitHint.Unspecified,node.body,source));
}return values;}
const original=await functions(join(dirname(path),'frozen/packages/dashboard/src'));
for(const row of report.rows){const candidate=await functions(join(row.project,'packages/dashboard/src'));
  row.structuralReview={method:'Compare original top-level function bodies after TypeScript printing, excluding comments and normalizing line endings; not a complete semantic proof',
    unchangedBodies:[...original].filter(([name,body])=>candidate.get(name)===body).map(([name])=>name),
    changedBodies:[...original].filter(([name,body])=>candidate.has(name)&&candidate.get(name)!==body).map(([name])=>name),
    missingFunctions:[...original.keys()].filter(name=>!candidate.has(name))};
}
await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.rows.map(row=>({arm:row.arm,review:row.structuralReview})),null,2));
