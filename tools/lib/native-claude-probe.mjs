import { spawn } from 'node:child_process';
import { verifyModelReceipt } from '@vpr/observability';

export async function probeClaude({ executable, cwd, model, effort, prompt }) {
  const started = performance.now();
  const child = spawn(executable, ['--print', '--model', model, '--effort', effort, '--max-turns', '1',
    '--output-format', 'stream-json', '--verbose', '--tools', '', '--disable-slash-commands',
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--system-prompt', 'Implement only the requested pure JavaScript function. Return a JSON object with a code string. Do not use tools.'],
  { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', bytes = 0;
  const timer = setTimeout(() => child.kill(), 90_000);
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 2_000_000) child.kill(); else stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { if (stderr.length < 2000) stderr += chunk.toString(); });
    child.once('close', done);
    child.stdin.end(prompt);
  }).finally(() => clearTimeout(timer));
  const events = stdout.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const result = events.findLast(event => event.type === 'result');
  if (code !== 0 || !result || result.is_error || !result.usage) {
    return { status: 'failed', requestedModel: model, requestedEffort: effort, durationMs: Math.round(performance.now() - started), reason: result?.is_error ? String(result.result).slice(0, 250) : stderr.slice(0, 250) || 'No successful usage receipt' };
  }
  const observedModels = events.filter(event => event.type === 'assistant').map(event => event.message?.model).filter(Boolean);
  const verification = verifyModelReceipt(model, observedModels);
  const usage = result.usage;
  const counters = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0 };
  if (Object.values(counters).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid observed counter');
  return { status: verification.status === 'confirmed' ? 'completed' : 'model-unverified',
    requestedModel: model, requestedEffort: effort, observedModels: verification.observedModels,
    modelVerification: verification.status, effortVerification: 'requested-only',
    durationMs: Math.round(performance.now() - started), ...counters,
    totalTokens: Object.values(counters).reduce((a, b) => a + b, 0), source: 'provider_reported',
    answer: result.result };
}
