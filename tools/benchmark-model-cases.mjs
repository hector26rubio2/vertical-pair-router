import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Script, createContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { resolveExecutable } from '../packages/runtime/dist/index.js';
import { probeClaude } from './lib/native-claude-probe.mjs';

if (!process.argv.includes('--approve-provider')) throw new Error('--approve-provider required');
const executable = await resolveExecutable('claude');
if (!executable) throw new Error('Claude Code unavailable');
const cwd = await mkdtemp(join(tmpdir(), 'vpr-model-cases-'));
const tasks = [
  { id: 'sku-normalization', complexity: 'simple', name: 'normalizeSku', requirement: 'normalizeSku(value): require a string or throw TypeError. Trim ends, collapse whitespace runs to one hyphen, lowercase. Return string.', cases: [[[' A   B '], 'a-b'], [['X\tY'], 'x-y'], [[''], ''], [[null], 'throws']] },
  { id: 'dependency-order', complexity: 'normal', name: 'orderTasks', requirement: 'orderTasks(tasks): input array of {id:string,deps:string[]}. Reject duplicate IDs, unknown dependencies and cycles with Error. Return IDs in dependency order. At each step select the FIRST input-order pending task whose dependencies are done. Empty returns []. Inputs must not be mutated.', cases: [[[[]], []], [[[ {id:'b',deps:['a']},{id:'a',deps:[]} ]], ['a','b']], [[[ {id:'x',deps:[]},{id:'y',deps:[]} ]], ['x','y']], [[[ {id:'x',deps:['missing']} ]], 'throws'], [[[ {id:'x',deps:['y']},{id:'y',deps:['x']} ]], 'throws'], [[[ {id:'x',deps:[]},{id:'x',deps:[]} ]], 'throws']] },
  { id: 'bounded-dag-scheduling', complexity: 'complex', name: 'planWaves', requirement: 'planWaves(tasks,capacity): tasks are {id:string,deps:string[],paths:string[]}; capacity positive integer. Reject duplicates, unknown deps, cycles, invalid capacity. Return array of waves (ID arrays), until all done. Each wave greedily scans INPUT order and picks up to capacity tasks with deps completed in PREVIOUS waves. In one wave, paths conflict when equal or one is an ancestor prefix ending slash boundary (src conflicts src/a, not src2). Conflicting task waits for next wave. A dependency may not finish within same wave. Do not mutate inputs. Empty => [].', cases: [[[[],2],[]], [[[ {id:'a',deps:[],paths:['a']},{id:'b',deps:[],paths:['b']},{id:'c',deps:[],paths:['c']} ],2],[['a','b'],['c']]], [[[ {id:'a',deps:[],paths:['src']},{id:'b',deps:[],paths:['src/a']},{id:'c',deps:['a'],paths:['c']} ],2],[['a'],['b','c']]], [[[ {id:'a',deps:[],paths:['src']},{id:'b',deps:[],paths:['src2']} ],2],[['a','b']]], [[[ {id:'a',deps:['b'],paths:[]},{id:'b',deps:['a'],paths:[]} ],2],'throws'], [[[ {id:'a',deps:['unknown'],paths:[]} ],2],'throws'], [[[ {id:'a',deps:[],paths:[]} ],0],'throws']] }
];
const profiles = [
  { model: 'claude-haiku-5-5', effort: 'medium' },
  { model: 'claude-haiku-5-5', effort: 'high' },
  { model: 'claude-sonnet-5-5', effort: 'medium' }
];
function check(answer, task) {
  try {
    const parsed = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''));
    if (typeof parsed.code !== 'string' || parsed.code.length > 24000) return false;
    const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
    new Script(parsed.code).runInContext(context, { timeout: 500 });
    for (const [args, expected] of task.cases) {
      let value, threw = false;
      try { value = new Script(`${task.name}(...${JSON.stringify(args)})`).runInContext(context, { timeout: 100 }); } catch { threw = true; }
      if (expected === 'throws' ? !threw : threw || JSON.stringify(value) !== JSON.stringify(expected)) return false;
    }
    return true;
  } catch { return false; }
}
const rows = [];
const disabledModels = new Set();
for (const profile of profiles) {
  if (disabledModels.has(profile.model)) continue;
  for (const task of tasks) {
    console.log('Measuring ' + task.id + ' / ' + profile.model + ' / ' + profile.effort);
    const result = await probeClaude({ executable, cwd, ...profile, prompt: 'Return ONLY JSON {"code":"function definitions"}. ' + task.requirement });
    const { answer, ...receipt } = result;
    rows.push({ taskId: task.id, complexity: task.complexity, acceptanceHash: createHash('sha256').update(JSON.stringify(task)).digest('hex'), ...receipt, checksPassed: answer === undefined ? false : check(answer, task) });
    if (result.status !== 'completed') { disabledModels.add(profile.model); break; }
  }
}
const report = { schemaVersion: 1, at: new Date().toISOString(), scenario: 'Isolated pure-function capability tests; not full VPR workflow savings', settingsIsolation: true, oneWorkerPerTask: true, rows, inferenceUsedForMeter: false, exploratory: true };
const directory = resolve('.vpr', 'benchmarks');
await mkdir(directory, { recursive: true });
const target = join(directory, 'model-cases-' + Date.now() + '.json');
await writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: target, ...report }));
