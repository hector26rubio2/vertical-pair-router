import assert from 'node:assert/strict';
import test from 'node:test';
import { retrieveCapabilities, type CapabilityCard } from './capability-retrieval.js';
const card: CapabilityCard = { id: 'haiku', provider: 'claude', model: 'haiku', tags: ['focused-coding', 'simple'], efforts: ['medium', 'high'], claims: 'Documented claim only', sources: ['https://platform.claude.com/docs/en/models/overview'], expiresAt: '2026-12-12' };
const request = { queryTags: ['simple', 'coding'], allowedProviders: ['claude'], verifiedCardIds: [] as string[], cards: [card], observations: [], now: '2026-11-12' };
test('retrieves sourced capabilities locally without claiming account access or quality', () => {
  const result = retrieveCapabilities(request);
  assert.equal(result[0]?.card.id, 'haiku');
  assert.equal(result[0]?.accountVerified, false);
  assert.equal(result[0]?.qualityRate, null);
  assert.equal(result[0]?.decisionInferenceTokens, 0);
  assert.equal(retrieveCapabilities({ ...request, queryTags: ['código sencillo'] })[0]?.card.id, 'haiku');
});
test('expired, unsourced and disallowed cards are not decision evidence', () => {
  assert.deepEqual(retrieveCapabilities({ ...request, now: '2027-01-01' }), []);
  assert.deepEqual(retrieveCapabilities({ ...request, allowedProviders: [] }), []);
  assert.deepEqual(retrieveCapabilities({ ...request, cards: [{ ...card, sources: [] }] }), []);
});
test('keeps documented claims separate from confirmed measured outcomes', () => {
  const result = retrieveCapabilities({ ...request, verifiedCardIds: ['haiku'], observations: [
    { evidenceId: 'good', cardId: 'haiku', taskTags: ['simple'], modelConfirmed: true, qualityPassed: true, totalTokens: 100 },
    { evidenceId: 'substituted', cardId: 'haiku', taskTags: ['simple'], modelConfirmed: false, qualityPassed: true, totalTokens: 1 }
  ] });
  assert.equal(result[0]?.sampleSize, 1);
  assert.equal(result[0]?.qualityRate, 1);
  assert.deepEqual(result[0]?.evidenceIds, ['good']);
  assert.equal(result[0]?.effortOutcomes[0]?.smallSample, true);
});

test('separates requested effort outcomes and includes failed-attempt tokens', () => {
  const result = retrieveCapabilities({ ...request, observations: [
    { evidenceId: 'm', cardId: 'haiku', taskTags: ['simple'], modelConfirmed: true, qualityPassed: true, totalTokens: 100, requestedEffort: 'medium' },
    { evidenceId: 'h1', cardId: 'haiku', taskTags: ['simple'], modelConfirmed: true, qualityPassed: true, totalTokens: 120, requestedEffort: 'high' },
    { evidenceId: 'h2', cardId: 'haiku', taskTags: ['simple'], modelConfirmed: true, qualityPassed: false, totalTokens: 200, requestedEffort: 'high' }
  ] });
  const high = result[0]?.effortOutcomes.find(row => row.requestedEffort === 'high');
  assert.equal(high?.tokensPerAcceptedResult, 320);
  assert.equal(high?.failed, 1);
});

test('does not use complex-task outcomes as evidence for a simple-task query', () => {
  const result = retrieveCapabilities({ ...request, observations: [
    { evidenceId: 'wrong-level', cardId: 'haiku', taskTags: ['coding', 'complex'], modelConfirmed: true, qualityPassed: true, totalTokens: 100 }
  ] });
  assert.equal(result[0]?.sampleSize, 0);
});

test('retrieves Spanish review and planning roles without interpreting them as coding evidence',()=>{
  const reviewCard:CapabilityCard={...card,id:'reviewer',tags:['review','planning','complex']};
  const result=retrieveCapabilities({...request,queryTags:['revisión planificación compleja'],cards:[reviewCard]});
  assert.deepEqual(result[0]?.matchedTerms,['review','planning','complex']);assert.equal(result[0]?.decisionInferenceTokens,0);
});
