import {readUsage,formatUsage,readAccountObservation,inspectProvider,inspectCodexAccount} from '@vpr/runtime';
import type {CliIo} from './cli.js';
export async function runUsageCommand(args:readonly string[],io:CliIo){
  const flag=(name:string)=>{const at=args.indexOf(name);return at>=0?args[at+1]:undefined;};
  const provider=flag('--account-provider');if(provider&&!['claude','codex','copilot'].includes(provider))throw Error('Unknown account provider');
  const session=args.includes('--all')?undefined:flag('--session')??process.env.VPR_PARENT_SESSION;
  const status=provider?await inspectProvider(provider as 'claude'|'codex'|'copilot',[]):null;
  const report=await readUsage({...(session?{sessionId:session}:{}),...(status?.accountKey?{account:status.accountKey}:{}),scope:provider?'account':session?'session':'machine',detail:args.includes('--detail')});
  const claude=provider==='claude'?status:args.includes('--offline')?null:await inspectProvider('claude',[]);
  const claudeQuota=await readAccountObservation(claude?.accountKey);
  const copilot=provider==='copilot'?status:args.includes('--offline')?null:await inspectProvider('copilot',[]);
  const live=args.includes('--offline')?null:await inspectCodexAccount();
  const output={...report,accountProvider:provider??null,currentAccountIdentified:!!status?.accountKey,codexAccountQuota:live,claudeAccountQuota:claudeQuota,copilotAccountQuota:copilot?.quotaDetails??null};
  io.stdout(args.includes('--json')?JSON.stringify(output)+'\n':formatUsage(report)+'\n'+(claudeQuota?.windows.length?'Claude: '+claudeQuota.windows.map((w:{kind:string;remainingPercent:number})=>w.kind+' '+w.remainingPercent+'% restante').join(' | '):'Cuota Claude: no disponible; /vpr-use puede leerla en la sesión activa')+'\n'+(live?.buckets.length?'Codex: '+live.buckets.map(bucket=>[bucket.primary,bucket.secondary].filter(Boolean).map(window=>window!.remainingPercent+'% restante · reinicia '+window!.resetAt).join(' | ')).join('\n'):'Cuota Codex: no disponible')+'\n');return 0;
}
