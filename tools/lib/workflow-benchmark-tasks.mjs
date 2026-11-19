// Small isolated projects, not claims about enterprise-scale repositories.
const check = (name, code) => ({ name, code });
export const workflowTasks = [
  {
    id: "W01",
    level: "medio",
    name: "Resolver conflicto de dos cambios de equipo",
    kind: "team-conflict",
    entry: "quote",
    requirement:
      "Resolve src/price.mjs merge conflict preserving BOTH changes: integer-cent price arithmetic and percentage discount before tax. Export " +
      "quote(cents,quantity,discountPercent,taxPercent) returning final integer cents, round discount subtotal first then tax once using Math.round. Reject " +
      "negative or non-safe-integer cents/quantity, quantity zero, percentages outside 0..100 or nonfinite. Preserve src/solution.mjs exports. Add behavioral " +
      "tests. No dependencies.",
    files: {
      "src/solution.mjs": "export { quote } from './price.mjs';\n",
      "src/price.mjs":
        "<<<<<<< team-money\nexport function quote(cents, quantity, discountPercent, taxPercent) { return Math.round(cents * quantity * (1 + taxPercent/100)); " +
        "}\n=======\nexport function quote(cents, quantity, discountPercent, taxPercent) { return cents * quantity * (1-discountPercent/100); }\n>>>>>>> " +
        "team-discounts\n",
    },
    checks: [
      check("combines discount and tax", "assert.equal(solution.quote(199,3,10,19),639)"),
      check("rounds subtotal first", "assert.equal(solution.quote(101,1,50,19),61)"),
      check("zero discount", "assert.equal(solution.quote(100,2,0,0),200)"),
      check(
        "invalid amounts",
        "for(const args of [[-1,1,0,0],[1,0,0,0],[1,1,101,0],[1,1,0,Infinity]])assert.throws(()=>solution.quote(...args))",
      ),
      check(
        "no conflict markers",
        "assert.doesNotMatch(await readFile(resolve(project,'src/price.mjs'),'utf8'),/^(?:<{7}|={7}|>{7})/mu)",
      ),
    ],
  },
  {
    id: "W02",
    level: "medio",
    name: "Analizar requerimientos incompletos",
    kind: "requirements",
    entry: "requirementsPlan",
    allowedPaths: ["src/solution.mjs", "test/"],
    requirement:
      "Read src/request.txt. Implement exported requirementsPlan() in src/solution.mjs returning a structured analysis, not implementation. Return " +
      "{confirmed,questions,tasks,exclusions}. confirmed is array of exact stable IDs: admin-invite, single-use, audit. questions must include expiry and " +
      "delivery as {id,question} and must NOT choose answers. tasks include IDs clarify, domain, api, tests; each has dependsOn:string[] and " +
      "acceptance:string[] nonempty. clarify has no deps, domain depends on clarify, api on domain, tests on api. exclusions must include billing and sso. Do " +
      "not invent expiry or delivery decisions, mutate other source files or implement invitation code. Write behavioral tests.",
    files: {
      "src/request.txt":
        "Owner: admins invite a teammate; links are single-use; keep an audit trail. Expiry and email/delivery method have not been decided. Billing and SSO are out of scope.\n",
    },
    checks: [
      check(
        "confirmed scope",
        "assert.deepEqual([...solution.requirementsPlan().confirmed].sort(),['admin-invite','audit','single-use'])",
      ),
      check(
        "open decisions remain questions",
        "const p=solution.requirementsPlan();assert.deepEqual(p.questions.map(q=>q.id).sort(),['delivery','expiry']);for(const q of " +
          "p.questions){assert.equal(typeof q.question,'string');assert.ok(q.question.length>5);assert.equal(q.answer,undefined)}",
      ),
      check(
        "task dependencies and acceptance",
        "const p=solution.requirementsPlan();const m=new Map(p.tasks.map(t=>[t.id,t]));assert.equal(m.size,4);for(const [id,deps] of " +
          "Object.entries({clarify:[],domain:['clarify'],api:['domain'],tests:['api']})){assert.deepEqual(m.get(id).dependsOn,deps);assert.ok(m.get(id).acceptanc" +
          "e.length>0)}",
      ),
      check(
        "respects exclusions",
        "assert.deepEqual([...solution.requirementsPlan().exclusions].sort(),['billing','sso'])",
      ),
    ],
  },
  {
    id: "W03",
    level: "simple",
    name: "Diagnosticar un bug sin modificar producción",
    kind: "bug-analysis",
    entry: "diagnose",
    allowedPaths: ["src/solution.mjs", "test/"],
    requirement:
      "Read src/cart.mjs. Do not change it. Export diagnose() from src/solution.mjs returning " +
      '{file:"src/cart.mjs",cause:"string-concatenation",reproduction:{prices:["10","2"],expected:12,actual:"0102"},fix:"numeric-validation",regressions:["nu' +
      'meric-strings","invalid-price","empty-cart"]}. This is analysis only: document the observed root cause and proposed fix, no production edits. Add ' +
      "tests.",
    files: {
      "src/cart.mjs":
        "export function total(prices){return prices.reduce((sum,value)=>sum+value,0);}\n",
    },
    checks: [
      check(
        "correct evidence and root cause",
        "const d=solution.diagnose();assert.equal(d.file,'src/cart.mjs');assert.equal(d.cause,'string-concatenation');assert.deepEqual(d.reproduction,{prices:['10','2'],expected:12,actual:'0102'})",
      ),
      check(
        "proposed fix and regression coverage",
        "const d=solution.diagnose();assert.equal(d.fix,'numeric-validation');assert.deepEqual([...d.regressions].sort(),['empty-cart','invalid-price','numeric-strings'])",
      ),
      check(
        "production unchanged",
        "assert.equal((await readFile(resolve(project,'src/cart.mjs'),'utf8')).trim(),'export function total(prices){return prices.reduce((sum,value)=>sum+value,0);}')",
      ),
    ],
  },
  {
    id: "W04",
    level: "simple",
    name: "Implementar corrección después del diagnóstico",
    kind: "bugfix",
    entry: "total",
    requirement:
      "Fix src/cart.mjs total(prices). Accept an array containing nonnegative finite numbers or nonempty numeric strings (trim first); sum numerically. " +
      "Reject invalid, negative, NaN, Infinity, booleans, null, empty/whitespace-only strings with TypeError. Empty array returns 0. No mutation. Keep " +
      "src/solution.mjs re-exporting total. Add behavioral tests.",
    files: {
      "src/solution.mjs": "export {total} from './cart.mjs';\n",
      "src/cart.mjs":
        "export function total(prices){return prices.reduce((sum,value)=>sum+value,0);}\n",
    },
    checks: [
      check("fixes reproduction", "assert.equal(solution.total(['10','2']),12)"),
      check("numbers and whitespace", "assert.equal(solution.total([1,' 2.5 ',0]),3.5)"),
      check("empty input", "assert.equal(solution.total([]),0)"),
      check(
        "invalid data",
        "for(const value of [null,true,'','  ','wat',-1,NaN,Infinity])assert.throws(()=>solution.total([value]),TypeError)",
      ),
      check("does not mutate", "const a=['10',2];solution.total(a);assert.deepEqual(a,['10',2])"),
    ],
  },
  {
    id: "W05",
    level: "medio",
    name: "Inicializar proyecto Node sin red",
    kind: "init",
    entry: "loadConfig",
    requirement:
      'Bootstrap this isolated Node project offline. Write src/config.mjs exporting loadConfig(env): return {port:3000,mode:"development"} by default; PORT ' +
      "must be integer text 1..65535, NODE_ENV only development/test/production, invalid values throw Error. src/solution.mjs re-exports loadConfig. Add " +
      'package.json {private:true,type:"module",scripts:{test:"node --test test/*.test.mjs"}} and .editorconfig with root=true, charset=utf-8, ' +
      "indent_style=space and indent_size=2. Add test/config.test.mjs. No dependency installation or external commands. Preserve other fixture files.",
    files: {
      "src/solution.mjs": "export {loadConfig} from './config.mjs';\n",
      "src/config.mjs": "export function loadConfig(){throw new Error('not initialized');}\n",
    },
    allowedPaths: ["src/", "test/", "package.json", ".editorconfig"],
    checks: [
      check("defaults", "assert.deepEqual(solution.loadConfig({}),{port:3000,mode:'development'})"),
      check(
        "configuration",
        "assert.deepEqual(solution.loadConfig({PORT:'8080',NODE_ENV:'production'}),{port:8080,mode:'production'})",
      ),
      check(
        "rejects invalid config",
        "for(const port of ['0','65536','1.5','bad',''])assert.throws(()=>solution.loadConfig({PORT:port}));assert.throws(()=>solution.loadConfig({NODE_ENV:'staging'}))",
      ),
      check(
        "package runnable offline",
        "const p=JSON.parse(await readFile(resolve(project,'package.json'),'utf8'));assert.equal(p.private,true);assert.equal(p.type,'module');assert.equal(p.scripts.test,'node --test test/*.test.mjs')",
      ),
      check(
        "editor configuration",
        "const text=await readFile(resolve(project,'.editorconfig'),'utf8');for(const pattern of [/root\\s*=\\s*true/u,/charset\\s*=\\s*utf-8/u,/indent_style\\s*=\\s*space/u,/indent_size\\s*=\\s*2/u])assert.match(text,pattern)",
      ),
    ],
  },
  {
    id: "W06",
    level: "complejo acotado",
    name: "Refactor estructural con compatibilidad",
    kind: "refactor",
    entry: "createLedger",
    requirement:
      "Refactor src/legacy.mjs into at least THREE cohesive new modules under src/ (excluding legacy and solution), separating money validation, ledger state " +
      "and reporting. Keep exports and behavior: cents(value) accepts nonnegative safe integer only; invoice(items,tax) items {cents,quantity}, positive safe " +
      "integer quantities, tax finite 0..1, returns rounded gross integer cents, no mutation; createLedger() exposes post(key,amount), balance(), entries(): " +
      "idempotent post returns false for same key/amount, conflicting reuse throws Error, amount nonnegative safe integer, empty key invalid, returned " +
      "entries are defensive copies; csv(entries) returns header key,amount and newline-separated rows, escaping commas/quotes/newlines per CSV. Preserve old " +
      "imports through legacy.mjs and solution.mjs. No dependencies. Write regression tests. This is a bounded structural refactor, not an enterprise-scale " +
      "migration.",
    files: {
      "src/solution.mjs": "export * from './legacy.mjs';\n",
      "src/legacy.mjs": ("export function cents(value){if(!Number.isSafeInteger(value)||value<0)throw new TypeError('money');return value;}\nexport function invoice(it" +
"ems,tax){if(!Number.isFinite(tax)||tax<0||tax>1)throw new TypeError('tax');let sum=0;for(const item of items){if(!Number.isSafeInteger(item." +
"quantity)||item.quantity<1)throw new TypeError('quantity');sum+=cents(item.cents)*item.quantity;}return Math.round(sum*(1+tax));}\nexport fun" +
"ction createLedger(){const entries=new Map();return {post(key,amount){if(typeof key!=='string'||!key)throw new TypeError('key');cents(amount" +
");if(entries.has(key)){if(entries.get(key)!==amount)throw Error('conflict');return false;}entries.set(key,amount);return true;},balance(){re" +
"turn [...entries.values()].reduce((a,b)=>a+b,0);},entries(){return [...entries].map(([key,amount])=>({key,amount}));}};}\nexport function csv" +
"(entries){const escape=value=>/[\",\\n\\r]/u.test(String(value))?'\"'+String(value).replaceAll('\"','\"\"')+'\"':String(value);return ['key,amount'," +
"...entries.map(e=>escape(e.key)+','+e.amount)].join('\\n');}\n"),
    },
    checks: [
      check(
        "preserves invoice behavior",
        "assert.equal(solution.invoice([{cents:199,quantity:3}],0.19),710);assert.throws(()=>solution.cents(-1));assert.throws(()=>solution.invoice([{cents:1,quantity:0}],0));assert.throws(()=>solution.invoice([],2))",
      ),
      check(
        "idempotency and conflicts",
        "const l=solution.createLedger();assert.equal(l.post('a',5),true);assert.equal(l.post('a',5),false);assert.throws(()=>l.post('a',6));assert.equal(l.balance(),5)",
      ),
      check(
        "defensive copies",
        "const l=solution.createLedger();l.post('a',5);l.entries()[0].amount=100;assert.equal(l.balance(),5);assert.equal(l.entries()[0].amount,5)",
      ),
      check(
        "CSV escaping",
        "assert.deepEqual(solution.csv([{key:'a,b',amount:2},{key:'a\"b',amount:3}]).split(String.fromCharCode(10)),['key,amount','\"a,b\",2','\"a\"\"b\",3'])",
      ),
      check(
        "compatibility exports",
        "const legacy=await import(pathToFileURL(resolve(project,'src/legacy.mjs')));for(const key of ['cents','invoice','createLedger','csv'])assert.equal(typeof legacy[key],'function')",
      ),
      check(
        "real module separation",
        "const names=await readdir(resolve(project,'src'));assert.ok(names.filter(name=>name.endsWith('.mjs')&&!['solution.mjs','legacy.mjs'].includes(name)).l" +
          "ength>=3);assert.ok((await readFile(resolve(project,'src/legacy.mjs'),'utf8')).length<500)",
      ),
    ],
  },
  {
    id: "W07",
    level: "medio",
    name: "Analizar arquitectura y riesgo de un proyecto",
    kind: "project-analysis",
    entry: "analyzeProject",
    allowedPaths: ["src/solution.mjs", "test/"],
    requirement:
      "Read src/server.mjs, src/repository.mjs and src/service.mjs. Do not modify those production files. Export analyzeProject() from src/solution.mjs " +
      'returning {layers:["http","service","repository"],dataFlow:["src/server.mjs","src/service.mjs","src/repository.mjs"],findings:[{id:"sql-injection",fil' +
      'e:"src/repository.mjs",symbol:"findUser",remedy:"parameterized-query"}],proposedTasks:["parameterize-query","add-injection-regression"]}. Findings ' +
      "must be grounded in actual source. Add tests for the analysis artifact, no production edits.",
    files: {
      "src/server.mjs":
        "import {lookup} from './service.mjs';\nexport const handle=name=>lookup(name);\n",
      "src/service.mjs":
        "import {findUser} from './repository.mjs';\nexport const lookup=name=>findUser(name);\n",
      "src/repository.mjs":
        'export function findUser(name){return "SELECT id FROM users WHERE name=\'"+name+"\'";}\n',
    },
    checks: [
      check(
        "architecture grounded in imports",
        "const a=solution.analyzeProject();assert.deepEqual(a.layers,['http','service','repository']);assert.deepEqual(a.dataFlow,['src/server.mjs','src/service.mjs','src/repository.mjs'])",
      ),
      check(
        "actionable finding",
        "const a=solution.analyzeProject();assert.deepEqual(a.findings,[{id:'sql-injection',file:'src/repository.mjs',symbol:'findUser',remedy:'parameterized-q" +
          "uery'}]);assert.deepEqual(a.proposedTasks,['parameterize-query','add-injection-regression'])",
      ),
      check(
        "production files unchanged",
        "assert.match(await readFile(resolve(project,'src/repository.mjs'),'utf8'),/SELECT id FROM users WHERE name=/u);assert.ok((await " +
          "readFile(resolve(project,'src/service.mjs'),'utf8')).includes('lookup=name=>findUser(name)'))",
      ),
    ],
  },
  {
    id: "W08",
    level: "medio",
    name: "Mejorar búsquedas con caché LRU acotada",
    kind: "improvement",
    entry: "createLookup",
    requirement:
      "Implement src/lookup.mjs createLookup(loader,capacity). Return {get(key),stats()}. Synchronous loader called only on misses. Map keys use JS identity. " +
      "get refreshes LRU order on hit, evicts least recently used after successful miss when size exceeds capacity; loader failures do NOT cache or evict. " +
      "stats returns {hits,misses,size}; failed loader counts as miss. Positive safe-integer capacity required. Cached undefined is a hit. Preserve solution " +
      "export. No dependencies. Add tests proving fewer loader calls and correct invalidation.",
    files: {
      "src/solution.mjs": "export {createLookup} from './lookup.mjs';\n",
      "src/lookup.mjs":
        "export function createLookup(loader){return {get:key=>loader(key),stats:()=>({hits:0,misses:0,size:0})};}\n",
    },
    checks: [
      check(
        "saves loader calls",
        "let n=0;const l=solution.createLookup(k=>{n++;return k},2);l.get('a');l.get('a');assert.equal(n,1);assert.deepEqual(l.stats(),{hits:1,misses:1,size:1})",
      ),
      check(
        "LRU eviction",
        "let n=0;const l=solution.createLookup(k=>++n,2);l.get('a');l.get('b');l.get('a');l.get('c');l.get('b');assert.equal(n,4);assert.deepEqual(l.stats(),{hits:1,misses:4,size:2})",
      ),
      check(
        "failed loader never evicts",
        "const l=solution.createLookup(k=>{if(k==='bad')throw Error();return k},1);l.get('a');assert.throws(()=>l.get('bad'));assert.equal(l.get('a'),'a');assert.deepEqual(l.stats(),{hits:1,misses:2,size:1})",
      ),
      check(
        "caches undefined and validates capacity",
        "let n=0;const l=solution.createLookup(()=>{n++;return undefined},1);l.get('a');l.get('a');assert.equal(n,1);for(const c of [0,-1,1.5,Infinity])assert.throws(()=>solution.createLookup(()=>0,c))",
      ),
    ],
  },
];

export function workflowAcceptance(task) {
  return `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const project=process.env.VPR_BENCH_PROJECT;
const solution=await import(pathToFileURL(resolve(project,'src/solution.mjs')));
${task.checks.map((item) => `test(${JSON.stringify(item.name)},async()=>{${item.code};});`).join("\n")}
`;
}
