/** Fixed task specifications and independent acceptance cases. No model grades itself. */
export const benchmarkTasks = [
  {
    id: 'T01', level: 'simple', name: 'Normalización de SKU', entry: 'normalizeSku',
    requirement: 'Export function normalizeSku(value) from src/solution.mjs. Require a string or throw TypeError. Trim ends, collapse whitespace runs to one hyphen, lowercase. Empty string stays empty. No dependencies or mutation.',
    cases: [ [[' A   B '], 'a-b'], [['X\tY'], 'x-y'], [[''], ''], [['  '], ''], [['ÁRBOL  UNO'], 'árbol-uno'], [[null], 'throws'], [[12], 'throws'] ]
  },
  {
    id: 'T02', level: 'medio', name: 'Orden estable de dependencias', entry: 'orderTasks',
    requirement: 'Export function orderTasks(tasks) from src/solution.mjs. Input array of {id:string,deps:string[]}. Reject duplicate IDs, unknown dependencies and cycles with Error. Return IDs in dependency order. At EACH step select the FIRST input-order pending task whose dependencies are done, restarting the scan after each selection. Empty returns []. Do not mutate input. No dependencies.',
    cases: [ [[[]], []], [[[ {id:'b',deps:['a']},{id:'a',deps:[]} ]], ['a','b']], [[[ {id:'x',deps:[]},{id:'y',deps:[]} ]], ['x','y']], [[[ {id:'b',deps:['a']},{id:'a',deps:[]},{id:'c',deps:[]} ]], ['a','b','c']], [[[ {id:'x',deps:['missing']} ]], 'throws'], [[[ {id:'x',deps:['y']},{id:'y',deps:['x']} ]], 'throws'], [[[ {id:'x',deps:[]},{id:'x',deps:[]} ]], 'throws'], [[[ {id:'x',deps:['x']} ]], 'throws'] ]
  },
  {
    id: 'T03', level: 'complejo acotado', name: 'Planificador DAG con conflictos de archivos', entry: 'planWaves',
    requirement: 'Export function planWaves(tasks,capacity) from src/solution.mjs. Tasks are {id:string,deps:string[],paths:string[]}, capacity must be a positive safe integer. Reject duplicate IDs, unknown dependencies, cycles and invalid capacity. Return waves of IDs. Each wave greedily scans INPUT order and selects up to capacity tasks whose dependencies completed in PREVIOUS waves. In one wave paths conflict when equal or one is an ancestor prefix at slash boundary (src conflicts src/a but not src2). Paths have no trailing slash. Conflicts wait until a later wave. Dependencies may not finish within the same wave. Do not mutate inputs. Empty returns []. No dependencies.',
    cases: [ [[[],2], []], [[[ {id:'a',deps:[],paths:['a']},{id:'b',deps:[],paths:['b']},{id:'c',deps:[],paths:['c']} ],2], [['a','b'],['c']]], [[[ {id:'a',deps:[],paths:['src']},{id:'b',deps:[],paths:['src/a']},{id:'c',deps:['a'],paths:['c']} ],2], [['a'],['b','c']]], [[[ {id:'a',deps:[],paths:['src']},{id:'b',deps:[],paths:['src2']} ],2], [['a','b']]], [[[ {id:'a',deps:[],paths:['src/a']},{id:'b',deps:[],paths:['src']} ],2], [['a'],['b']]], [[[ {id:'a',deps:[],paths:[]},{id:'b',deps:['a'],paths:[]},{id:'c',deps:['b'],paths:[]} ],3], [['a'],['b'],['c']]], [[[ {id:'a',deps:['b'],paths:[]},{id:'b',deps:['a'],paths:[]} ],2], 'throws'], [[[ {id:'a',deps:['unknown'],paths:[]} ],2], 'throws'], [[[ {id:'a',deps:[],paths:[]} ],0], 'throws'], [[[],1.5], 'throws'], [[[ {id:'a',deps:[],paths:[]},{id:'a',deps:[],paths:[]} ],2], 'throws'], [[[ {id:'a',deps:[],paths:['x']},{id:'b',deps:[],paths:['x']},{id:'c',deps:[],paths:['y']} ],2], [['a','c'],['b']]] ]
  }
];

export function acceptanceSource(task) {
  return `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { ${task.entry}: implementation } = await import(pathToFileURL(resolve(process.env.VPR_BENCH_PROJECT, 'src/solution.mjs')));
const cases = ${JSON.stringify(task.cases)};
for (const [index, [args, expected]] of cases.entries()) test('acceptance ' + (index + 1), () => {
 const original = structuredClone(args);
 if (expected === 'throws') assert.throws(() => implementation(...args));
 else assert.deepEqual(implementation(...args), expected);
 assert.deepEqual(args, original, 'must preserve input');
});
`;
}
