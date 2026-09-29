import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareShot } from '../scripts/lib/baseline.mjs';
import { encodePng } from '../scripts/vendor/cdp/png.mjs';

const solid = (v) => encodePng({ width: 4, height: 4, pixels: Buffer.alloc(4 * 4 * 4, v) });

async function dirs() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-base-'));
  return { baselineDir: path.join(root, 'base'), newDir: path.join(root, 'new') };
}

test('эталона нет — вырезка в new, исход new', async () => {
  const d = await dirs();
  const r = await compareShot({ png: solid(10), name: 'look-1', ...d, update: false, threshold: 12, tolerance: 0 });
  assert.equal(r.outcome, 'new');
  assert.deepEqual(await readdir(d.newDir), ['look-1.png']);
});

test('update пишет эталон, повтор совпадает', async () => {
  const d = await dirs();
  assert.equal((await compareShot({ png: solid(10), name: 'a', ...d, update: true, threshold: 12, tolerance: 0 })).outcome, 'updated');
  assert.equal((await compareShot({ png: solid(10), name: 'a', ...d, update: false, threshold: 12, tolerance: 0 })).outcome, 'match');
});

test('расхождение — mismatch с долей и diff-файлом', async () => {
  const d = await dirs();
  await compareShot({ png: solid(10), name: 'a', ...d, update: true, threshold: 12, tolerance: 0 });
  const r = await compareShot({ png: solid(200), name: 'a', ...d, update: false, threshold: 12, tolerance: 0 });
  assert.equal(r.outcome, 'mismatch');
  assert.equal(r.ratio, 1);
  assert.deepEqual((await readdir(d.newDir)).sort(), ['a.diff.png', 'a.png']);
});
