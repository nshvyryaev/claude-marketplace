import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin from './index.js';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-opencode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs', 'acceptance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  return root;
}

function criteria(root, name, status) {
  const file = path.join(root, 'docs', 'acceptance', `${name}.md`);
  fs.writeFileSync(file, [
    '---',
    `slug: ${name}`,
    'kind: feature',
    `status: ${status}`,
    'title: "Проба"',
    '---',
    '- [scenario] Проверка',
    '',
  ].join('\n'));
  return file;
}

async function beforeHook(root) {
  let before;
  const ctx = {
    location: { directory: root },
    tool: { hook: async (name, callback) => { if (name === 'execute.before') before = callback; } },
  };
  await plugin.setup(ctx);
  assert.ok(before);
  return before;
}

test('ordinary files and new criteria remain writable', async (t) => {
  const root = project(t);
  const before = await beforeHook(root);
  assert.doesNotThrow(() => before({ tool: 'edit', input: { path: 'src/a.ts' } }));
  assert.doesNotThrow(() => before({ tool: 'write', input: { path: 'docs/acceptance/new.md' } }));
  assert.doesNotThrow(() => before({ tool: 'read', input: { path: 'docs/acceptance/new.md' } }));
});

test('draft criteria remain writable', async (t) => {
  const root = project(t);
  const before = await beforeHook(root);
  const file = criteria(root, 'draft', 'draft');
  assert.doesNotThrow(() => before({ tool: 'edit', input: { path: file } }));
});

for (const status of ['approved', 'frozen', 'verified']) {
  test(`${status} criteria reject edit, write and patch`, async (t) => {
    const root = project(t);
    const before = await beforeHook(root);
    const file = criteria(root, status, status);
    assert.throws(() => before({ tool: 'edit', input: { path: file } }), new RegExp(status));
    assert.throws(() => before({ tool: 'write', input: { path: file } }), /unfreeze/);
    assert.throws(() => before({
      tool: 'patch',
      input: { patchText: `*** Begin Patch\n*** Delete File: ${file}\n*** End Patch` },
    }), /unfreeze/);
  });
}

test('a malformed file with a visible locked status still rejects changes', async (t) => {
  const root = project(t);
  const before = await beforeHook(root);
  const file = path.join(root, 'docs', 'acceptance', 'broken.md');
  fs.writeFileSync(file, 'без шапки\nstatus: frozen\n');
  assert.throws(() => before({ tool: 'edit', input: { path: file } }), /frozen/);
});

test('patch checks every target, not only the first one', async (t) => {
  const root = project(t);
  const before = await beforeHook(root);
  const file = criteria(root, 'second', 'frozen');
  assert.throws(() => before({
    tool: 'patch',
    input: { patchText: `*** Begin Patch\n*** Add File: src/new.ts\n*** Update File: ${file}\n*** End Patch` },
  }), /second/);
});
