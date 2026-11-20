import { Ajv, type ValidateFunction } from 'ajv';

export const evidenceOperations = [
  'explorar_grafo', 'buscar_codigo', 'leer_archivo', 'triar', 'disenar',
  'crear_historias', 'escribir_tests', 'implementar', 'corregir', 'revisar', 'desconocida',
] as const;
export type EvidenceOperation = typeof evidenceOperations[number];
export type WorkLevel = 'simple' | 'normal' | 'complex';
export type ModelTier = 'light' | 'standard' | 'high';
export interface WorkFeatures {
  readonly kind: string;
  readonly role: string;
  readonly designComplexity: WorkLevel | null;
  readonly executionComplexity: WorkLevel | null;
  readonly risk: 'low' | 'medium' | 'high' | null;
  readonly files: readonly string[] | null;
  readonly modules: readonly string[] | null;
  readonly publicApi: boolean | null;
  readonly persistence: boolean | null;
  readonly transactions: boolean | null;
  readonly security: boolean | null;
  readonly money: boolean | null;
  readonly invariants: number | null;
  readonly existingTests: number | null;
  readonly expectedDiffLines: number | null;
  readonly dependencies: readonly string[] | null;
}
export interface Handoff {
  readonly schemaVersion: 1;
  readonly goal: string;
  readonly immutableContracts: readonly string[];
  readonly invariants: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly acceptanceTests: readonly string[];
  readonly escalationConditions: readonly string[];
  readonly limits: {readonly turns: number; readonly wallMs: number; readonly inputContextTokens: number};
  readonly contextPack: {readonly id: string; readonly sha256: string};
}
export interface RoutingPolicy {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly mode: 'shadow';
  readonly evidence: {readonly minimumSamples: number; readonly minimumAcceptance: number};
  readonly phases: Readonly<Record<string, ModelTier>>;
  readonly operations: Readonly<Partial<Record<EvidenceOperation, ModelTier>>>;
  readonly escalationRules: readonly string[];
  readonly limits: {readonly maxWorkers: number; readonly retriesPerModel: number};
}
export const evidenceFailureReasons = [
  'tiempo_agotado', 'turnos_agotados', 'contrato_roto', 'invariante_rota',
  'test_externo_fallido', 'bloqueo_de_proveedor', 'plan_insuficiente',
] as const;
export interface EvidenceRecord {
  readonly snapshotHash?: string | null;
  readonly schemaVersion: 1;
  readonly id: string;
  readonly granularity: 'run' | 'story' | 'call' | 'phase';
  readonly runId: string;
  readonly storyId: string | null;
  readonly callId: string | null;
  readonly taskId: string;
  readonly protocol: string | null;
  readonly acceptanceContractHash: string | null;
  readonly recipe: string;
  readonly phase: string | null;
  readonly operation: EvidenceOperation;
  readonly model: string | null;
  readonly provider: string | null;
  readonly modelIdentity: 'confirmed' | 'requested-only' | 'unknown';
  readonly features: WorkFeatures;
  readonly tokens: {
    readonly input: number | null; readonly output: number | null;
    readonly cacheRead: number | null; readonly cacheWrite: number | null;
    readonly cacheWrite5m: number | null; readonly cacheWrite1h: number | null;
    readonly contextMax: number | null;
  };
  readonly cost: {
    readonly inputUsd: number | null; readonly outputUsd: number | null;
    readonly cacheReadUsd: number | null; readonly cacheWriteUsd: number | null;
    readonly totalMinUsd: number | null; readonly totalMaxUsd: number | null;
    readonly complete: boolean | null;
  };
  readonly accepted: boolean | null;
  readonly engineeringQuality: boolean | null;
  readonly checks: {readonly external: boolean | null; readonly regression: boolean | null; readonly build: boolean | null};
  readonly review: {
    readonly fresh: boolean | null; readonly citationsVerified: boolean | null;
    readonly critical: number | null; readonly high: number | null; readonly medium: number | null; readonly low: number | null;
  };
  readonly wallMs: number | null;
  readonly checksMs: number | null;
  readonly calls: number | null;
  readonly turns: number | null;
  readonly tools: Readonly<Record<string, number>> | null;
  readonly files: {
    readonly readCount: number | null; readonly readBytes: number | null; readonly readTokens: number | null;
    readonly writtenCount: number | null; readonly writtenBytes: number | null;
  };
  readonly cacheCondition: 'cold-requested' | 'warm-requested' | 'unknown';
  readonly promptPrefixHash: string | null;
  readonly handoffHash: string | null;
  readonly failureReason: typeof evidenceFailureReasons[number] | null;
  readonly triageEscalated: boolean | null;
  readonly escalationRequired: boolean | null;
  readonly shadowRecipe: string | null;
  readonly source: {readonly path: string; readonly sha256: string; readonly pointer: string};
  readonly unavailable: Readonly<Record<string, string>>;
}

const text = {type: 'string', minLength: 1};
const hash = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const positive = {type: 'integer', minimum: 1};
const numberOrNull = {type: ['number', 'null'], minimum: 0};
const boolOrNull = {type: ['boolean', 'null']};
const textOrNull = {type: ['string', 'null'], minLength: 1};
const hashOrNull = {anyOf: [hash, {type: 'null'}]};
const strings = {type: 'array', items: text, uniqueItems: true};
const nonempty = {...strings, minItems: 1};
function object(properties: Record<string, unknown>, optional: readonly string[] = []) {
  return {type: 'object', additionalProperties: false, properties, required: Object.keys(properties).filter(key => !optional.includes(key))};
}
function nullableEnum(values: readonly string[]) {return {enum: [...values, null]};}
const level = nullableEnum(['simple', 'normal', 'complex']);
const nullableStrings = {anyOf: [strings, {type: 'null'}]};
const pathSchema = {type: 'string', minLength: 1, pattern: '^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?![A-Za-z]:).+$'};
export const handoffSchema = {
  $id: 'https://vpr.local/schemas/handoff-v1',
  ...object({
    schemaVersion: {const: 1}, goal: text, immutableContracts: nonempty, invariants: nonempty,
    allowedFiles: {...nonempty, items: pathSchema}, acceptanceTests: nonempty,
    escalationConditions: nonempty,
    limits: object({turns: positive, wallMs: positive, inputContextTokens: positive}),
    contextPack: object({id: text, sha256: hash}),
  }),
};
const tier = {enum: ['light', 'standard', 'high']};
export const routingPolicySchema = {
  $id: 'https://vpr.local/schemas/routing-policy-v1',
  ...object({
    schemaVersion: {const: 1}, version: text, mode: {const: 'shadow'},
    evidence: object({minimumSamples: positive, minimumAcceptance: {type: 'number', minimum: 0, maximum: 1}}),
    phases: {type: 'object', minProperties: 1, additionalProperties: tier},
    operations: {type: 'object', additionalProperties: false,
      properties: Object.fromEntries(evidenceOperations.map(operation => [operation, tier]))},
    escalationRules: strings,
    limits: object({maxWorkers: positive, retriesPerModel: {type: 'integer', minimum: 0, maximum: 1}}),
  }),
};
export const workFeaturesSchema = object({
  kind: text, role: text, designComplexity: level, executionComplexity: level,
  risk: nullableEnum(['low', 'medium', 'high']), files: nullableStrings, modules: nullableStrings,
  publicApi: boolOrNull, persistence: boolOrNull, transactions: boolOrNull,
  security: boolOrNull, money: boolOrNull, invariants: numberOrNull,
  existingTests: numberOrNull, expectedDiffLines: numberOrNull, dependencies: nullableStrings,
});
export const evidenceSchema = {
  $id: 'https://vpr.local/schemas/evidence-v1',
  ...object({
    snapshotHash: hashOrNull,
    schemaVersion: {const: 1}, id: text, granularity: {enum: ['run', 'story', 'call', 'phase']},
    runId: text, storyId: textOrNull, callId: textOrNull, taskId: text,
    protocol: textOrNull, acceptanceContractHash: hashOrNull, recipe: text,
    phase: textOrNull, operation: {enum: evidenceOperations}, model: textOrNull, provider: textOrNull,
    modelIdentity: {enum: ['confirmed', 'requested-only', 'unknown']}, features: workFeaturesSchema,
    tokens: object(Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite',
      'cacheWrite5m', 'cacheWrite1h', 'contextMax'].map(key => [key, numberOrNull]))),
    cost: object({...Object.fromEntries(['inputUsd', 'outputUsd', 'cacheReadUsd', 'cacheWriteUsd',
      'totalMinUsd', 'totalMaxUsd'].map(key => [key, numberOrNull])), complete: boolOrNull}),
    accepted: boolOrNull, engineeringQuality: boolOrNull,
    checks: object({external: boolOrNull, regression: boolOrNull, build: boolOrNull}),
    review: object({fresh: boolOrNull, citationsVerified: boolOrNull, critical: numberOrNull,
      high: numberOrNull, medium: numberOrNull, low: numberOrNull}),
    wallMs: numberOrNull, checksMs: numberOrNull, calls: numberOrNull, turns: numberOrNull,
    tools: {anyOf: [{type: 'object', additionalProperties: {type: 'integer', minimum: 0}}, {type: 'null'}]},
    files: object(Object.fromEntries(['readCount', 'readBytes', 'readTokens', 'writtenCount', 'writtenBytes']
      .map(key => [key, numberOrNull]))),
    cacheCondition: {enum: ['cold-requested', 'warm-requested', 'unknown']},
    promptPrefixHash: hashOrNull, handoffHash: hashOrNull,
    failureReason: nullableEnum(evidenceFailureReasons), triageEscalated: boolOrNull,
    escalationRequired: boolOrNull, shadowRecipe: textOrNull,
    source: object({path: text, sha256: hash, pointer: text}),
    unavailable: {type: 'object', additionalProperties: text},
  }, ['snapshotHash']),
};
const ajv = new Ajv({allErrors: true, strict: true, allowUnionTypes: true});
const handoffValidator = ajv.compile(handoffSchema);
const policyValidator = ajv.compile(routingPolicySchema);
const evidenceValidator = ajv.compile(evidenceSchema);
function check<T>(validator: ValidateFunction, value: unknown): {valid: boolean; errors: readonly string[]; value?: T} {
  const valid = validator(value);
  return valid ? {valid: true, errors: [], value: value as T}
    : {valid: false, errors: (validator.errors ?? []).map(error => `${error.instancePath}: ${error.message}`)};
}
export const validateHandoff = (value: unknown) => check<Handoff>(handoffValidator, value);
export const validateRoutingPolicy = (value: unknown) => check<RoutingPolicy>(policyValidator, value);
export const validateEvidence = (value: unknown) => check<EvidenceRecord>(evidenceValidator, value);
