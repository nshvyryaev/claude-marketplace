import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolFilePaths } from './tool-targets.mjs';

test('write and edit expose their single target', () => {
  assert.deepEqual(toolFilePaths('write', { path: 'a.ts' }), ['a.ts']);
  assert.deepEqual(toolFilePaths('edit', { path: 'b.ts' }), ['b.ts']);
});

test('other tools and malformed inputs have no file targets', () => {
  assert.deepEqual(toolFilePaths('read', { path: 'a.ts' }), []);
  assert.deepEqual(toolFilePaths('write', {}), []);
  assert.deepEqual(toolFilePaths('patch', {}), []);
});

test('patch exposes add, update, delete and move targets without duplicates', () => {
  const patchText = [
    '*** Begin Patch',
    '*** Add File: new.ts',
    '*** Update File: existing.ts',
    '*** Move to: renamed.ts',
    '*** Delete File: old.ts',
    '*** Update File: existing.ts',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(toolFilePaths('patch', { patchText }), [
    'new.ts',
    'existing.ts',
    'renamed.ts',
    'old.ts',
  ]);
});
