import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSku} from './src/solution.mjs';
test('trims and lowercases',()=>assert.equal(normalizeSku(' ABC '),'abc'));
test('collapses internal whitespace',()=>assert.equal(normalizeSku(' A  B\tC '),'a-b-c'));
test('empty remains empty',()=>assert.equal(normalizeSku(''),''));
test('requires string',()=>{for(const value of [null,undefined,1,{},true])assert.throws(()=>normalizeSku(value),TypeError);});
test('preserves accents',()=>assert.equal(normalizeSku(' ÁRBOL '),'árbol'));
