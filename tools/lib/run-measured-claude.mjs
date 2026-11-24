import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { NativeSessionMeter } from './native-session-meter.mjs';
import {prepareGuardedClaude} from '@vpr/runtime';

export async function runMeasuredClaude({ executable, cwd, args, prompt, timeoutMs = 180000, onSnapshot = () => {}, onResult = () => {} }) {
  const meter = new NativeSessionMeter();
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  let launch;try{launch=await prepareGuardedClaude(executable,args);}catch{
    return {...meter.snapshot(elapsed()),exitCode:2,stopped:'context-guard-unverified',failure:'Native pre-request guard could not be validated; no agent process started',stderrBytes:0,stdoutBytes:0};
  }
  const child = spawn(executable, launch.args, { cwd, env:launch.env, shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let stopped = null, stderrBytes = 0, stdoutBytes = 0, pending = '', finalSeen = false, providerLimit=false;
  const decoder = new StringDecoder('utf8');
  const stop = reason => {
    if (stopped) return;
    stopped = reason;
    // Terminate only this owned process family, including stuck test children.
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => child.kill());
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
    }
  };
  let timer = setTimeout(() => stop('deadline'), timeoutMs);
  const processLine = line => {
    try {
      const event = JSON.parse(line);
      if(event.type==='result'&&event.is_error&&/hit your (?:5.hour|weekly|usage) limit/iu.test(String(event.result??'')))providerLimit=true;
      if (event.type === 'result' && event.is_error) console.log(JSON.stringify({ phase: 'native-error', message: String(event.result ?? '').slice(0, 500) }));
      meter.observe(event, elapsed());
      if(event.type==='result')onResult(event);
      if (event.type === 'result' && !finalSeen) {
        finalSeen = true;
        clearTimeout(timer);
        timer = setTimeout(() => stop('post-receipt-cleanup'), 8000);
      }
      if (['assistant', 'user', 'result'].includes(event.type)) onSnapshot(meter.snapshot(elapsed()));
    } catch (error) {
      // Only parsing failures are ignored. Callback errors must not disappear.
      if (!(error instanceof SyntaxError)) throw error;
    }
  };
  const exitCode = await new Promise((done, reject) => {
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 8000000) { stop('output-limit'); return; }
      pending += decoder.write(chunk);
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) if (line) processLine(line);
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
    child.once('close', done);
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  }).finally(() => clearTimeout(timer));
  pending += decoder.end();
  if (pending) processLine(pending);
  clearTimeout(timer);
  return { ...meter.snapshot(elapsed()), exitCode, stopped:stopped??(providerLimit?'provider-limit':null), contextGuard:{policy:launch.policy,buildHash:launch.buildHash},stderrBytes, stdoutBytes };
}
