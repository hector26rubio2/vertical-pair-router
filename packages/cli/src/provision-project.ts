import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProjectProfileV1 } from '@vpr/config';
import { resolveExecutable } from '@vpr/runtime';
import { createSafeProcessRunner } from '@vpr/quality';

export interface ProvisionReceipt { readonly integration: string; readonly state: 'ready' | 'disabled' | 'unavailable'; readonly detail: string }
export async function provisionProject(root: string, profile: ProjectProfileV1): Promise<readonly ProvisionReceipt[]> {
  const enabled = profile.setup?.integrations;
  if (!enabled) return [];
  const results: ProvisionReceipt[] = [];
  async function execute(program: string, args: readonly string[]): Promise<void> {
    const result = await createSafeProcessRunner([program])({ program, args, cwd: root, timeoutMs: 120_000, maxOutputBytes: 1_048_576 });
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error('Integration command failed: ' + program + ' ' + args.join(' '));
  }
  if (enabled.husky) {
    const manager = profile.packageManager;
    if (!['pnpm', 'npm', 'yarn'].includes(manager)) {
      results.push({ integration: 'husky', state: 'unavailable', detail: 'Husky requires a supported Node package manager; no hooks were changed' });
    } else {
      const executable = await resolveExecutable(manager);
      if (!executable) throw new Error('Package manager executable unavailable: ' + manager);
      const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (!metadata.devDependencies?.husky && !metadata.dependencies?.husky) {
        await execute(executable, manager === 'npm' ? ['install', '--save-dev', '--save-exact', 'husky@9.1.7'] : ['add', '--dev', '--exact', 'husky@9.1.7']);
      }
      await execute(executable, manager === 'npm' ? ['exec', '--', 'husky'] : ['exec', 'husky']);
      await mkdir(join(root, '.husky'), { recursive: true });
      const hook = join(root, '.husky', 'pre-commit');
      if (!(await exists(hook))) {
        const command = metadata.scripts?.check ? 'check' : metadata.scripts?.test ? 'test' : null;
        if (command) await writeFile(hook, `${manager} run ${command}\n`, { flag: 'wx' });
      }
      results.push({ integration: 'husky', state: 'ready', detail: 'Local Git hook path configured; any existing pre-commit preserved' });
    }
  } else results.push({ integration: 'husky', state: 'disabled', detail: 'Not selected' });
  if (enabled.graphify) {
    const graphify = process.env.VPR_GRAPHIFY_EXECUTABLE ?? join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'graphify.exe' : 'graphify');
    if (!(await exists(graphify))) {
      const uv = await resolveExecutable('uv');
      if (!uv) {
        results.push({ integration: 'graphify', state: 'unavailable', detail: 'Install uv first, then retry provisioning' });
      } else {
        await execute(uv, ['tool', 'install', 'graphifyy==0.9.106']);
      }
    }
    if (await exists(graphify)) results.push({ integration: 'graphify', state: 'ready', detail: 'Native local executable available; code-only indexing does not use a model' });
  } else results.push({ integration: 'graphify', state: 'disabled', detail: 'Not selected' });
  if (enabled.archify) {
    const script = join(process.env.VPR_ARCHIFY_HOME ?? join(homedir(), '.agents', 'skills', 'archify'), 'bin', 'archify.mjs');
    if (await exists(script)) {
      await execute(process.execPath, [script, 'doctor']);
      results.push({ integration: 'archify', state: 'ready', detail: 'Local Archify skill passed doctor' });
    } else results.push({ integration: 'archify', state: 'unavailable', detail: 'Install the Archify skill or set VPR_ARCHIFY_HOME; no substitute was installed' });
  } else results.push({ integration: 'archify', state: 'disabled', detail: 'Not selected' });
  return results;
}
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
