import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {checkStagedSecurity} from './lib/bootstrap-quality.mjs';
const event=process.env.GITHUB_EVENT_PATH?JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8')):{};
let base=event.pull_request?.base?.sha??event.before;
if(!base||/^0+$/u.test(base))base=execFileSync('git',['hash-object','-t','tree','--stdin'],{input:'',encoding:'utf8',windowsHide:true}).trim();
const result=checkStagedSecurity(process.cwd(),{base});console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
