import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieveCapabilities, type CapabilityCard, type EmpiricalCapability } from '@vpr/knowledge';
import type { CliIo } from './cli.js';
import { measureSubscriptionQuota, type SubscriptionSnapshot } from '@vpr/observability';
import { detectSubscriptionPlan } from './subscription-detection.js';

export async function runModelEvidenceCommand(args: readonly string[], io: CliIo): Promise<number> {
  const flag = (name: string): string | undefined => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  if (args[0] === 'quota') {
    const input = flag('--input');
    if (!input) { io.stderr('Usage: vpr models quota --input <before-after.json>\n'); return 2; }
    const content = await readFile(resolve(input), 'utf8');
    if (Buffer.byteLength(content) > 65536) throw new Error('Quota input exceeds 64 KiB');
    const snapshots = JSON.parse(content) as { before: SubscriptionSnapshot; after: SubscriptionSnapshot; isolated: boolean };
    if (!snapshots.before || !snapshots.after || typeof snapshots.isolated !== 'boolean' ||
      ![snapshots.before.source, snapshots.after.source].every(source => ['provider_reported', 'user_reported'].includes(source))) throw new TypeError('Invalid quota snapshots');
    io.stdout(JSON.stringify(measureSubscriptionQuota(snapshots)) + '\n');
    return 0;
  }
  if (args[0] === 'subscriptions') {
    const local = dirname(fileURLToPath(import.meta.url));
    let catalog: { expiresAt: string; plans: { id: string }[] } | undefined;
    for (const path of [resolve(local, '../data/subscriptions.json'), resolve(local, '../../../docs/research/subscription-catalog.json')]) {
      try { catalog = JSON.parse(await readFile(path, 'utf8')) as typeof catalog; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (!catalog || !Array.isArray(catalog.plans)) throw new Error('Subscription catalog unavailable');
    const explicitPlan = flag('--plan');
    const detectedPlan = args.includes('--detect') ? await detectSubscriptionPlan(flag('--provider') ?? '') : null;
    const planId = explicitPlan ?? detectedPlan;
    io.stdout(JSON.stringify({ ...catalog, selectedPlan: catalog.plans.find(plan => plan.id === planId) ?? null,
      selectedPlanId: planId ?? null,
      selectedPlanSource: explicitPlan ? 'user_reported' : detectedPlan ? 'provider_reported' : 'unavailable', expired: Date.parse(catalog.expiresAt) < Date.now(),
      actualAccountPlanDetected: !!detectedPlan, decisionInferenceTokens: 0, subscriptionQuotaDelta: null }) + '\n');
    return 0;
  }
  const query = flag('--query');
  if (args[0] !== 'query' || !query) { io.stderr('Usage: vpr models query --query <task> [--project <path>]\n'); return 2; }
  const local = dirname(fileURLToPath(import.meta.url));
  let catalog: { checkedAt: string; cards: CapabilityCard[] } | undefined;
  for (const path of [resolve(local, '../data/model-capabilities.json'), resolve(local, '../../../docs/research/model-capability-catalog.json')]) {
    try { catalog = JSON.parse(await readFile(path, 'utf8')) as typeof catalog; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!catalog || !Array.isArray(catalog.cards)) throw new Error('Model capability catalog unavailable');
  const root = resolve(flag('--project') ?? process.cwd());
  const directory = join(root, '.vpr', 'benchmarks');
  const observations: EmpiricalCapability[] = [];
  const verified = new Set<string>();
  const now = Date.now();
  try {
    for (const file of await readdir(directory)) {
      if (!/^model-cases-\d+\.json$/u.test(file)) continue;
      const content = await readFile(join(directory, file), 'utf8');
      if (Buffer.byteLength(content) > 1_048_576) throw new Error('Benchmark report exceeds 1 MiB');
      const report = JSON.parse(content) as { at?: string; rows?: Record<string, unknown>[] };
      if (!Array.isArray(report.rows)) continue;
      for (const [index, row] of report.rows.entries()) {
        if (row.modelVerification !== 'confirmed' || row.source !== 'provider_reported' || typeof row.requestedModel !== 'string' ||
            typeof row.complexity !== 'string' || typeof row.checksPassed !== 'boolean' || typeof row.totalTokens !== 'number') continue;
        observations.push({ evidenceId: `${file}:${index}`, cardId: row.requestedModel,
          taskTags: [row.complexity, 'coding', String(row.taskId)], modelConfirmed: true,
          qualityPassed: row.checksPassed, totalTokens: row.totalTokens,
          ...(typeof row.requestedEffort === 'string' ? { requestedEffort: row.requestedEffort } : {}) });
        const age = now - Date.parse(report.at ?? '');
        if (Number.isFinite(age) && age >= 0 && age < 300_000) verified.add(row.requestedModel);
      }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const results = retrieveCapabilities({ queryTags: [query], allowedProviders: ['claude', 'codex', 'copilot'],
    verifiedCardIds: [...verified], cards: catalog.cards, observations, now: new Date(now).toISOString() });
  io.stdout(JSON.stringify({ decisionInferenceTokens: 0, catalogCheckedAt: catalog.checkedAt,
    availabilityTtlMs: 300_000, results }) + '\n');
  return 0;
}
