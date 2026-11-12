import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const project = resolve(option('--project') ?? '.');
const graphify = process.env.VPR_GRAPHIFY_EXECUTABLE ?? join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'graphify.exe' : 'graphify');
const archify = join(process.env.VPR_ARCHIFY_HOME ?? join(homedir(), '.agents', 'skills', 'archify'), 'bin', 'archify.mjs');
function run(program, argv) {
  const result = spawnSync(program, argv, { cwd: project, shell: false, windowsHide: true, stdio: 'inherit', timeout: 120_000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
switch (args[0]) {
  case 'doctor':
    console.log(JSON.stringify({ graphify: existsSync(graphify), archify: existsSync(archify), project }));
    if (existsSync(archify)) run(process.execPath, [archify, 'doctor']);
    break;
  case 'graph':
    run(graphify, ['extract', project, '--code-only', '--no-cluster', '--max-workers', '2', '--out', join(project, '.vpr', 'graphify')]);
    break;
  case 'query': {
    const question = option('--question');
    if (!question) throw new Error('query requires --question');
    run(graphify, ['query', question, '--budget', '1200', '--graph', join(project, '.vpr', 'graphify', 'graphify-out', 'graph.json')]);
    break;
  }
  case 'diagram': {
    const type = option('--type'), input = option('--input'), output = option('--out');
    if (!['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'].includes(type) || !input || !output) throw new Error('diagram requires --type, --input and --out');
    run(process.execPath, [archify, 'deliver', type, resolve(input), resolve(output), '--quality', 'showcase', '--json']);
    break;
  }
  default: throw new Error('Actions: doctor, graph, query, diagram');
}
