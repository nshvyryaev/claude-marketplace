import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'create-anim-clip.js');
const ATLAS_META = resolve(__dirname, 'fixtures', 'mini-atlas.plist.meta');

function run(args, opts = {}) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', ...opts });
}

test('refuses to overwrite without --force', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'idle.anim');
  writeFileSync(out, '[]');

  const r = run(['--atlas-meta', ATLAS_META, '--name-prefix', 'test-prefix-', '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing to overwrite/);
});

test('--force overwrites existing .anim', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'idle.anim');
  writeFileSync(out, '[]');
  writeFileSync(out + '.meta', JSON.stringify({ uuid: 'placeholder' }));

  const r = run([
    '--atlas-meta', ATLAS_META,
    '--name-prefix', 'test-prefix-',
    '--out', out,
    '--force',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const anim = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(anim[0].__type__, 'cc.AnimationClip');
});

test('--force preserves uuid from existing .anim.meta', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'idle.anim');
  const stableUuid = '11111111-1111-4111-8111-111111111111';
  writeFileSync(out, '[]');
  writeFileSync(out + '.meta', JSON.stringify({ uuid: stableUuid }));

  const r = run([
    '--atlas-meta', ATLAS_META,
    '--name-prefix', 'test-prefix-',
    '--out', out,
    '--force',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const meta = JSON.parse(readFileSync(out + '.meta', 'utf8'));
  assert.equal(meta.uuid, stableUuid);
});

test('without existing meta, --force generates a new uuid', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'idle.anim');

  const r = run([
    '--atlas-meta', ATLAS_META,
    '--name-prefix', 'test-prefix-',
    '--out', out,
    '--force',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const meta = JSON.parse(readFileSync(out + '.meta', 'utf8'));
  assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
