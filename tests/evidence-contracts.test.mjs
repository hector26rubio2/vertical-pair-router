import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHandoff, validateRoutingPolicy, validateEvidence, evidenceOperations} from '@vpr/contracts';

export const handoff = {
  schemaVersion: 1, goal: 'Preserve ledger identity', immutableContracts: ['post(key, amount)'],
  invariants: ['Repeated key cannot change amount'], allowedFiles: ['src/ledger.ts'],
  acceptanceTests: ['ledger duplicate regression'], escalationConditions: ['Need to change public API'],
  limits: {turns: 10, wallMs: 60000, inputContextTokens: 85000},
  contextPack: {id: 'pack-1', sha256: 'a'.repeat(64)},
};
test('handoff requires invariants, bounded files, context-pack hash and complete limits', () => {
  assert.equal(validateHandoff(handoff).valid, true);
  for (const replacement of [{invariants: []}, {allowedFiles: ['../secrets']},
    {contextPack: {id: 'pack', sha256: 'wrong'}}, {limits: {turns: 0}}]) {
    assert.equal(validateHandoff({...handoff, ...replacement}).valid, false);
  }
  assert.equal(evidenceOperations.length, 11);
});
test('declarative policy is shadow-only and cannot configure protected guards', () => {
  const policy = {schemaVersion: 1, version: 'experiment-1', mode: 'shadow',
    evidence: {minimumSamples: 3, minimumAcceptance: 0.8},
    phases: {design: 'standard', implement: 'light', review: 'standard'},
    operations: {leer_archivo: 'light'}, escalationRules: ['security'],
    limits: {maxWorkers: 2, retriesPerModel: 1}};
  assert.equal(validateRoutingPolicy(policy).valid, true);
  assert.equal(validateRoutingPolicy({...policy, haikuContextLimit: 120000}).valid, false);
  assert.equal(validateRoutingPolicy({...policy, mode: 'enforce'}).valid, false);
  assert.equal(validateRoutingPolicy({...policy, evidence: {minimumSamples: 0, minimumAcceptance: 1}}).valid, false);
});
test('malformed evidence is rejected rather than silently normalized to zero', () => {
  assert.equal(validateEvidence({schemaVersion: 1, inputTokens: -1}).valid, false);
});
