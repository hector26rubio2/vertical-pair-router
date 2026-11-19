import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSessionMeter, labelNativeSnapshot} from '@vpr/observability';
test('operation metadata measures read payload bytes without retaining paths, code or prompts', () => {
  const meter = new NativeSessionMeter();
  meter.observe({type: 'assistant', message: {id: 'r1', model: 'sonnet', usage: {
    input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 5},
    content: [{type: 'tool_use', id: 't1', name: 'Read', input: {file_path: 'PRIVATE-PATH'}}]}}, 1);
  meter.observe({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't1', content: 'SECRET'}]}}, 2);
  const snapshot = meter.snapshot(3), [call] = labelNativeSnapshot(snapshot, 'plan');
  assert.equal(call.operation, 'leer_archivo'); assert.equal(call.readCount, 1);
  assert.equal(call.readBytes, 6); assert.equal(call.readTokens, null); assert.equal(call.contextMax, 16);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE-PATH')); assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
});
test('a missing path or defaulted cache zero cannot become an observed file count or cache ratio', () => {
  const meter = new NativeSessionMeter();
  meter.observe({type: 'assistant', message: {id: 'r1', model: 'sonnet', usage: {
    input_tokens: 1, output_tokens: 2}, content: [{type: 'tool_use', id: 't1', name: 'Read', input: {}}]}}, 1);
  const [call] = labelNativeSnapshot(meter.snapshot(2));
  assert.equal(call.contextMax, null); assert.equal(call.cacheHitRatio, null); assert.equal(call.readCount, null);
});
