import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectImportBoundaries} from '../tools/lib/import-boundaries.mts';
test('imports across packages must use public exports; internal same-package stages remain allowed', () => {
  assert.equal(inspectImportBoundaries('tools/probe.mjs', "import x from '../packages/core/dist/index.js';").length, 1);
  assert.equal(inspectImportBoundaries('packages/cli/src/test.ts', "export {x} from '../../core/src/router.js';").length, 1);
  assert.equal(inspectImportBoundaries('packages/core/src/route-work.ts', "import {x} from './workflow-routing.js';").length, 0);
  assert.equal(inspectImportBoundaries('tools/probe.mjs', "const x = await import('@vpr/core');").length, 0);
  assert.equal(inspectImportBoundaries('tools/probe.mjs', "const s = 'packages/core/src/router.ts';").length, 0);
});
