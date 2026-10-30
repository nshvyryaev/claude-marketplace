import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin from './index.js';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-opencode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'scenes'), { recursive: true });
  return root;
}

async function hooks(root) {
  const registered = {};
  const ctx = {
    location: { directory: root },
    tool: { hook: async (name, callback) => { registered[name] = callback; } },
  };
  await plugin.setup(ctx);
  return registered;
}

test('direct scene/prefab writes and patch deletions are rejected', async (t) => {
  const root = project(t);
  const registered = await hooks(root);
  assert.throws(
    () => registered['execute.before']({ tool: 'edit', input: { path: 'assets/scenes/Main.scene' } }),
    /cocos-files-handler scripts/,
  );
  assert.throws(
    () => registered['execute.before']({ tool: 'write', input: { path: 'assets/prefabs/Foo.PREFAB' } }),
    /cocos-files-handler scripts/,
  );
  assert.throws(() => registered['execute.before']({
    tool: 'patch',
    input: { patchText: '*** Begin Patch\n*** Delete File: assets/scenes/Main.scene\n*** End Patch' },
  }), /cocos-files-handler scripts/);
});

test('TypeScript writes pass the pre-write guard', async (t) => {
  const root = project(t);
  const registered = await hooks(root);
  assert.doesNotThrow(
    () => registered['execute.before']({ tool: 'edit', input: { path: 'assets/scripts/Good.ts' } }),
  );
});

test('post-write verification appends findings to the tool result', async (t) => {
  const root = project(t);
  const registered = await hooks(root);
  fs.writeFileSync(path.join(root, 'assets', 'scripts', 'Bad.ts'), 'this.node.setActive(false);\n');
  const event = {
    tool: 'write',
    input: { path: 'assets/scripts/Bad.ts' },
    status: 'completed',
    result: { content: [{ type: 'text', text: 'written' }] },
  };
  registered['execute.after'](event);
  assert.equal(event.result.content.length, 2);
  assert.match(event.result.content[1].text, /no-set-active/);
  assert.match(event.result.content[1].text, /node\.active/);
});

test('clean files and failed tool calls leave the result untouched', async (t) => {
  const root = project(t);
  const registered = await hooks(root);
  fs.writeFileSync(path.join(root, 'assets', 'scripts', 'Good.ts'), 'this.node.active = false;\n');
  const clean = {
    tool: 'edit',
    input: { path: 'assets/scripts/Good.ts' },
    status: 'completed',
    result: { content: [] },
  };
  registered['execute.after'](clean);
  assert.deepEqual(clean.result.content, []);

  const failed = {
    tool: 'write',
    input: { path: 'assets/scripts/Good.ts' },
    status: 'error',
    result: { content: [] },
  };
  registered['execute.after'](failed);
  assert.deepEqual(failed.result.content, []);
});

test('patch verification covers all targets and resolves generated tsconfig from project root', async (t) => {
  const root = project(t);
  const registered = await hooks(root);
  fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'scripts', 'Bad.ts'), 'import data from "./x.json";\n');
  fs.writeFileSync(path.join(root, 'temp', 'tsconfig.cocos.json'), '{}\n');
  const event = {
    tool: 'patch',
    input: { patchText: [
      '*** Begin Patch',
      '*** Update File: assets/scripts/Bad.ts',
      '*** Update File: temp/tsconfig.cocos.json',
      '*** End Patch',
    ].join('\n') },
    status: 'completed',
    result: { content: [] },
  };
  registered['execute.after'](event);
  assert.match(event.result.content[0].text, /no-json-import/);
  assert.match(event.result.content[0].text, /no-generated-tsconfig-edit/);
});
