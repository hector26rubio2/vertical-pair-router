import {createHash} from 'node:crypto';
import {validateHandoff, type Handoff} from '@vpr/contracts';
import {canonicalJson} from '@vpr/core';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export interface FrozenHandoff {
  readonly artifact: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly tokens: number | null;
  readonly tokenSource: 'provider_reported' | 'unavailable';
  readonly completedFields: readonly string[];
}
export function freezeHandoff(value: unknown, tokenReceipt?: {readonly tokens: number}): FrozenHandoff {
  const validation = validateHandoff(value);
  if (!validation.valid || !validation.value) throw new TypeError('Invalid handoff: ' + validation.errors.join('; '));
  if (tokenReceipt && (!Number.isSafeInteger(tokenReceipt.tokens) || tokenReceipt.tokens < 0)) {
    throw new TypeError('Invalid measured token count');
  }
  const artifact = canonicalJson(validation.value);
  return Object.freeze({artifact, sha256: sha256(artifact), bytes: Buffer.byteLength(artifact),
    tokens: tokenReceipt?.tokens ?? null, tokenSource: tokenReceipt ? 'provider_reported' : 'unavailable',
    completedFields: Object.keys(validation.value).sort()});
}
export function validateFrozenHandoff(value: FrozenHandoff): Handoff {
  if (sha256(value.artifact) !== value.sha256 || Buffer.byteLength(value.artifact) !== value.bytes) {
    throw new Error('Frozen handoff hash/size mismatch');
  }
  const validation = validateHandoff(JSON.parse(value.artifact) as unknown);
  if (!validation.valid || !validation.value) throw new TypeError('Invalid handoff');
  return validation.value;
}
/** Fisher-Yates with a recorded 32-bit seed. Never implies the provider cache was cleared. */
export function randomizeCells<T>(cells: readonly T[], seed: number): T[] {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Invalid seed');
  const result = [...cells]; let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state / 0x100000000 * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export interface ExperimentStory {
  readonly id: string; readonly model: string;
  readonly files: readonly string[]; readonly dependencies: readonly string[];
}
function overlap(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (path: string) => path.replaceAll('\\', '/').toLowerCase().replace(/\/$/u, '');
  return left.some(a => right.some(b => {
    const x = normalize(a), y = normalize(b);
    return x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
  }));
}
export function scheduleStories(stories: readonly ExperimentStory[], maxWorkers = 2): ExperimentStory[][] {
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 2) throw new TypeError('Invalid worker limit');
  const ids = new Set(stories.map(story => story.id));
  if (ids.size !== stories.length) throw new TypeError('Duplicate story');
  if (stories.some(story => story.dependencies.some(id => !ids.has(id)))) throw new TypeError('Unknown dependency');
  const done = new Set<string>(), waves: ExperimentStory[][] = [];
  while (done.size < stories.length) {
    const ready = stories.filter(story => !done.has(story.id) && story.dependencies.every(id => done.has(id)));
    ready.sort((a, b) => a.model.localeCompare(b.model) || a.id.localeCompare(b.id));
    if (!ready.length) throw new Error('Story dependency cycle');
    const wave: ExperimentStory[] = [];
    for (const story of ready) {
      if (wave.length < maxWorkers && !wave.some(other => overlap(story.files, other.files))) wave.push(story);
    }
    waves.push(wave);
    for (const story of wave) done.add(story.id);
  }
  return waves;
}
export function allocateSharedDesign(cost: {readonly min: number; readonly max: number} | null, consumerReceiptIds: readonly string[]) {
  if (new Set(consumerReceiptIds).size !== consumerReceiptIds.length) throw new TypeError('duplicate consumer receipt');
  if (cost && (!Number.isFinite(cost.min) || !Number.isFinite(cost.max) || cost.min < 0 || cost.max < cost.min)) {
    throw new TypeError('Invalid design cost');
  }
  return {designCost: cost, actualConsumers: consumerReceiptIds.length,
    allocatedPerConsumer: cost && consumerReceiptIds.length
      ? {min: cost.min / consumerReceiptIds.length, max: cost.max / consumerReceiptIds.length} : null};
}
export function stableRolePrompt(prefix: {readonly tools: readonly string[]; readonly system: string; readonly staticContext: string}, task: string) {
  const serialized = canonicalJson({tools: prefix.tools, system: prefix.system, staticContext: prefix.staticContext});
  return {prefix: serialized, prefixHash: sha256(serialized), prompt: serialized + '\nTASK\n' + task};
}
export interface FrozenExecutor<T> {
  readonly mode: 'simulation' | 'native';
  run(input: {readonly artifact: string; readonly handoff: Handoff; readonly signal: AbortSignal}): Promise<T>;
}
/** No native adapter is invoked by this package. The injected boundary must honor cancellation. */
export async function executeFrozenHandoff<T>(plan: FrozenHandoff, executor: FrozenExecutor<T>, options: {
  readonly contextPackSha256: string;
  readonly nativeApproval?: 'explicitly-approved';
  readonly signal?: AbortSignal;
}): Promise<T> {
  if (executor.mode === 'native' && options.nativeApproval !== 'explicitly-approved') {
    throw new Error('Native experiment requires explicit owner approval');
  }
  const handoff = validateFrozenHandoff(plan);
  if (options.contextPackSha256 !== handoff.contextPack.sha256) throw new Error('Invalid context pack hash');
  const timeout = AbortSignal.timeout(handoff.limits.wallMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, {once: true});
  });
  try {return await Promise.race([executor.run({artifact: plan.artifact, handoff, signal}), cancelled]);}
  finally {if (onAbort) signal.removeEventListener('abort', onAbort);}
}
