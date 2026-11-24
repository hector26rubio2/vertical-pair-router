import type {ModelPriceCatalog} from '@vpr/observability';
import {randomizeCells} from './protocol.js';

interface OpenaiRate {readonly model: string; readonly input: number; readonly output: number;
  readonly longContext?: {readonly input: number; readonly output: number}}
interface PlanOptions {
  readonly seed: number; readonly repetitions: number; readonly asOf: string; readonly legacyTaskIds: readonly string[];
  readonly claude: ModelPriceCatalog; readonly openai: {readonly expiresAt: string; readonly checkedAt: string; readonly cards: readonly OpenaiRate[]};
}
const models = {H: 'claude-haiku-5-5', S: 'claude-sonnet-5-5', O: 'claude-opus-5-5', T: 'gpt-6.1-terra'} as const;
type Model = keyof typeof models;
interface Step {readonly model: Model; readonly input: number; readonly output: number; readonly role: string}
interface Cell {
  readonly id: string; readonly task: string; readonly recipe: string; readonly repetition: number;
  readonly cacheCondition: 'cold-requested' | 'warm-requested'; readonly steps: readonly Step[];
  readonly designer: Model | null; readonly executor: Model; readonly variant: string | null;
}
const execution = (model: Model): Step => ({model, input: 200_000, output: 20_000, role: 'implementation'});
const review: Step = {model: 'S', input: 80_000, output: 8_000, role: 'fresh-review'};
const design = (model: Model): Step => ({model, input: 80_000, output: 8_000, role: 'design'});
function stepCost(step: Step, options: PlanOptions) {
  const name = models[step.model], claude = options.claude.cards.find(card => card.model === name);
  const openai = options.openai.cards.find(card => card.model === name);
  const rate = claude?.tiers[0] ?? openai;
  if (!rate) throw new Error('Missing official catalog rate: ' + name);
  const high = openai?.longContext ?? rate;
  if ([rate.input, rate.output, high.input, high.output].some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid rate');
  return {min: (step.input * rate.input + step.output * rate.output) / 1_000_000,
    max: (step.input * high.input + step.output * high.output) / 1_000_000};
}
function price(steps: readonly Step[], options: PlanOptions) {
  return steps.map(step => stepCost(step, options)).reduce((sum, cost) => ({min: sum.min + cost.min, max: sum.max + cost.max}), {min: 0, max: 0});
}
function expand(task: string, recipe: string, steps: readonly Step[], designer: Model | null, executor: Model,
  variant: string | null, options: PlanOptions): Cell[] {
  return (['cold-requested', 'warm-requested'] as const).flatMap(cacheCondition => Array.from({length: options.repetitions}, (_, index) => ({
    id: [task, recipe, variant ?? 'base', cacheCondition, index + 1].join(':'), task, recipe,
    repetition: index + 1, cacheCondition, steps, designer, executor, variant,
  })));
}
export function proposeCampaign(options: PlanOptions) {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new Error('Invalid seed');
  if (!Number.isInteger(options.repetitions) || options.repetitions < 3 || options.repetitions > 20) throw new Error('At least three repetitions required');
  const at = Date.parse(options.asOf);
  if (!Number.isFinite(at) || [options.claude, options.openai].some(c => !Number.isFinite(Date.parse(c.expiresAt)) || Date.parse(c.expiresAt) < at)) {
    throw new Error('Price catalog expired or invalid');
  }
  const factorial = (['S', 'O'] as const).flatMap(d => (['H', 'S', 'T'] as const)
    .flatMap(e => expand('F02', `${d}→${e}`, [execution(e), review], d, e, null, options)));
  const hierarchy = ['F02', 'F01B'].flatMap(task => (['S', 'O'] as const).flatMap(d => expand(task,
    `triage-S→${d}→stories-H/S`, [{model: 'S', input: 20000, output: 2000, role: 'triage'}, design(d),
      execution('H'), execution('S'), review], d, 'H', null, options)));
  const ab = ['F02', 'W03'].flatMap(task => (['haiku-explore', 'phase-model-explore'] as const).flatMap(variant => expand(task,
    'frozen-S→S', [...variant === 'haiku-explore' ? [{model: 'H' as const, input: 25000, output: 2000, role: 'exploration'},
      {model: 'S' as const, input: 3000, output: 500, role: 'handoff-overhead'}] : [], execution('S'), review], 'S', 'S', variant, options)));
  const legacy = [...new Set(options.legacyTaskIds)].flatMap(task => (['H', 'S', 'S-H'] as const).flatMap(recipe =>
    expand(task, recipe, [...recipe === 'S-H' ? [design('S')] : [], execution(recipe === 'S' ? 'S' : 'H'), review],
      recipe === 'S-H' ? 'S' : null, recipe === 'S' ? 'S' : 'H', null, options)));
  const specs = [
    {id: 'factorial-F02', priority: 1, cells: factorial, shared: [design('S'), design('O')]},
    {id: 'hierarchical-finanzas', priority: 2, cells: hierarchy, shared: []},
    {id: 'exploration-AB', priority: 3, cells: ab, shared: [design('S'), design('S')]},
    {id: 'legacy-fresh-review', priority: 4, cells: legacy, shared: []},
  ];
  const blocks = specs.map(spec => {
    const cells = randomizeCells(spec.cells, (options.seed + spec.priority) >>> 0).map((cell, order) => {
      const base = price(cell.steps, options), reserve = price([execution(cell.executor), review], options);
      return {...cell, order, estimatedBaseUsd: base, estimatedOneRepairReserveUsd: reserve,
        estimatedTotalMaxUsd: base.max + reserve.max,
        phaseLimits: {turns: 16, wallMs: 180000, inputContextTokens: 85000},
        acceptance: ['same-snapshot', 'external-tests', 'original-regressions', 'build', 'fresh-cited-Sonnet-review']};
    });
    const sharedDesigns = spec.shared.map(step => ({...step, estimatedUsd: stepCost(step, options)}));
    const shared = price(spec.shared, options);
    return {id: spec.id, priority: spec.priority, seed: (options.seed + spec.priority) >>> 0, sharedDesigns, cells,
      estimatedBaseMaxUsd: shared.max + cells.reduce((sum, cell) => sum + cell.estimatedBaseUsd.max, 0),
      estimatedTotalMaxUsd: shared.max + cells.reduce((sum, cell) => sum + cell.estimatedTotalMaxUsd, 0)};
  });
  return {schemaVersion: 1, status: 'proposal-awaiting-approval', seed: options.seed, plannedAsOf: options.asOf,
    measuredTokens: null, subscriptionQuotaSavings: null, basis: 'Frozen official API reference catalogs; estimated, not subscription billing',
    assumptions: ['200k aggregate input / 20k output per implementation across bounded calls; not one 200k Haiku prompt',
      '80k input / 8k output per design and fresh review; cache benefits are not assumed',
      'One correction plus fresh review reserved per cell; estimates are not hard spending limits',
      'Haiku must remain under the protected context tier; Codex pricing retains short/long uncertainty',
      'Cold/warm are requested conditions, not claims of actual provider cache clearing',
      'New model calls require explicit approval; approve one block at a time'],
    catalogDates: {claude: options.claude.checkedAt, openai: options.openai.checkedAt}, blocks,
    totalBaseMaxUsd: blocks.reduce((sum, block) => sum + block.estimatedBaseMaxUsd, 0),
    totalMaxUsd: blocks.reduce((sum, block) => sum + block.estimatedTotalMaxUsd, 0)};
}
