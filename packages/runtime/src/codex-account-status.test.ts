import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodexLimits } from './codex-account-status.js';
test('native limits expose remaining windows without identity or credential data',()=>{
  const value=normalizeCodexLimits({email:'secret@example.test',rateLimits:{limitId:'codex',primary:{usedPercent:27,resetsAt:1795000000,windowDurationMins:300},credits:{balance:'12.5',hasCredits:true},token:'secret'}},'2026-11-17T00:00:00Z');
  assert.equal(value[0]?.primary?.remainingPercent,73);assert.equal(value[0]?.credits.balance,'12.5');assert.equal(value[0]?.delegationCapacity,'available-at-observation');assert.ok(!JSON.stringify(value).includes('secret'));
});
test('unknown, exhausted and expired observations do not imply available delegation',()=>{
  assert.deepEqual(normalizeCodexLimits(null),[]);
  const at='2026-11-17T00:00:00Z';
  assert.equal(normalizeCodexLimits({rateLimits:{primary:{usedPercent:100,resetsAt:1795000000},credits:{hasCredits:true}}},at)[0]?.delegationCapacity,'limit-reached');
  assert.equal(normalizeCodexLimits({rateLimits:{primary:{usedPercent:0,resetsAt:1}}},at)[0]?.delegationCapacity,'unknown');
  assert.equal(normalizeCodexLimits({rateLimits:{primary:{usedPercent:-1,resetsAt:1795000000}}},at)[0]?.delegationCapacity,'unknown');
});
