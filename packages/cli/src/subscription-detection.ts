import { spawn } from 'node:child_process';
import { resolveExecutable } from '@vpr/runtime';

export function planFromClaudeStatus(status: unknown): string | null {
  if (!status || typeof status !== 'object') return null;
  const value = status as Record<string, unknown>;
  if (value.loggedIn !== true || value.authMethod !== 'claude.ai') return null;
  return typeof value.subscriptionType === 'string' && ['pro', 'max', 'ultra'].includes(value.subscriptionType)
    ? `claude-${value.subscriptionType}` : null;
}

/** Uses only the public native status command. Never reads credentials or returns identity fields. */
export async function detectSubscriptionPlan(provider: string): Promise<string | null> {
  if (provider !== 'claude') return null;
  const program = await resolveExecutable('claude');
  if (!program) return null;
  return new Promise(resolve => {
    const child = spawn(program, ['auth', 'status'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let content = '', exceeded = false;
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 5000);
    child.stdout.on('data', data => {
      content += String(data);
      if (content.length > 65536) { exceeded = true; child.kill(); }
    });
    child.once('error', () => { clearTimeout(timer); resolve(null); });
    child.once('close', code => {
      clearTimeout(timer);
      try { resolve(code === 0 && !exceeded ? planFromClaudeStatus(JSON.parse(content)) : null); }
      catch { resolve(null); }
    });
  });
}
