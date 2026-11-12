import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyModelReceipt } from './model-receipt.js';
test('detects the observed host substitution rather than labelling Sonnet as Haiku', () => {
  assert.equal(verifyModelReceipt('haiku', ['claude-sonnet-5-5']).status, 'substituted');
  assert.equal(verifyModelReceipt('haiku', ['claude-haiku-5-5']).status, 'confirmed');
  assert.equal(verifyModelReceipt('sonnet', ['claude-sonnet-5-5']).status, 'confirmed');
  assert.equal(verifyModelReceipt('chosen-model', []).status, 'unavailable');
  assert.equal(verifyModelReceipt('chosen-model', ['other-model']).status, 'substituted');
});
