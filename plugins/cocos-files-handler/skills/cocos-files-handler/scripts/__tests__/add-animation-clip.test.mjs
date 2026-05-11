import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'add-animation-clip.js');
const FIXTURE_PREFAB = resolve(__dirname, 'fixtures', 'mini-prefab.prefab');

function run(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

function withFixture(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prefab = join(dir, 'mini.prefab');
  copyFileSync(FIXTURE_PREFAB, prefab);
  return fn(prefab);
}

test('appends clip uuid to cc.Animation._clips', (t) => withFixture(t, (prefab) => {
  const uuid = '22222222-2222-4222-8222-222222222222';
  const r = run(['--file', prefab, '--clip-uuid', uuid]);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(readFileSync(prefab, 'utf8'));
  const anim = data.find(o => o.__type__ === 'cc.Animation');
  assert.deepEqual(anim._clips.at(-1), {
    __uuid__: uuid,
    __expectedType__: 'cc.AnimationClip',
  });
}));

test('idempotent — does not duplicate if uuid already present', (t) => withFixture(t, (prefab) => {
  const uuid = '22222222-2222-4222-8222-222222222222';
  run(['--file', prefab, '--clip-uuid', uuid]);
  const before = JSON.parse(readFileSync(prefab, 'utf8'));
  const beforeCount = before.find(o => o.__type__ === 'cc.Animation')._clips.length;

  const r = run(['--file', prefab, '--clip-uuid', uuid]);
  assert.equal(r.status, 0, r.stderr);
  const after = JSON.parse(readFileSync(prefab, 'utf8'));
  const afterCount = after.find(o => o.__type__ === 'cc.Animation')._clips.length;
  assert.equal(afterCount, beforeCount);
}));

test('errors when no cc.Animation component', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prefab = join(dir, 'no-anim.prefab');
  const noAnim = JSON.parse(readFileSync(FIXTURE_PREFAB, 'utf8'))
    .filter(o => o.__type__ !== 'cc.Animation');
  const node = noAnim.find(o => o.__type__ === 'cc.Node');
  if (node) node._components = [];
  writeFileSync(prefab, JSON.stringify(noAnim, null, 2));

  const r = run(['--file', prefab, '--clip-uuid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no cc\.Animation/);
});

test('errors when multiple cc.Animation components', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prefab = join(dir, 'multi-anim.prefab');
  const data = JSON.parse(readFileSync(FIXTURE_PREFAB, 'utf8'));
  const animCopy = JSON.parse(JSON.stringify(data.find(o => o.__type__ === 'cc.Animation')));
  data.push(animCopy);
  writeFileSync(prefab, JSON.stringify(data, null, 2));

  const r = run(['--file', prefab, '--clip-uuid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /multiple cc\.Animation/);
});
