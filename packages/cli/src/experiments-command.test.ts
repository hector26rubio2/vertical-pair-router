import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runCli} from './cli.js';

test('experiment CLI reports offline into a new directory, preserves source and rejects overwrite', async () => {
  const root = resolve('.tmp/experiment-review/cli-' + randomUUID()); await mkdir(root, {recursive: true});
  const source = join(root, 'source.json');
  await writeFile(source, JSON.stringify({tasks: [], rows: []}));
  const original = await readFile(source, 'utf8'); let output = '';
  const io = {stdout: (s: string) => {output += s;}, stderr: () => {}};
  const args = ['experiments', 'report', '--source', source, '--output', join(root, 'report'), '--as-of', '2026-11-19'];
  assert.equal(await runCli(args, io), 0); assert.equal(JSON.parse(output).inferenceTokens, 0);
  assert.equal(await readFile(source, 'utf8'), original);
  assert.match(await readFile(join(root, 'report/informe.html'), 'utf8'), /sin decisión|Tabla de decisión/u);
  await assert.rejects(runCli(args, io), /EEXIST/u);
});
test('experiment CLI has no implicit paid execution command', async () => {
  let error = ''; const code = await runCli(['experiments', 'run'], {stdout: () => {}, stderr: s => {error += s;}});
  assert.equal(code, 2); assert.match(error, /report|approval/u);
});
