import assert from 'node:assert/strict';
import test from 'node:test';
import { planFromClaudeStatus } from './subscription-detection.js';
test('detects public native subscription type without guessing unknown plans or API authentication', () => {
  for (const plan of ['pro', 'max', 'ultra']) assert.equal(planFromClaudeStatus({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: plan, email: 'discarded' }), `claude-${plan}`);
  for (const status of [null, { loggedIn: true, authMethod: 'api_key', subscriptionType: 'pro' }, { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'future-plan' }, { loggedIn: false, authMethod: 'claude.ai', subscriptionType: 'pro' }]) assert.equal(planFromClaudeStatus(status), null);
});
