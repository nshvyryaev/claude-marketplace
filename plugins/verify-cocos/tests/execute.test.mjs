import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeRun } from '../scripts/lib/execute.mjs';
import { toyAdapter } from './helpers/toy.mjs';

test('executeRun: окружение прогона пишется в строку start, сбой окружения — вердикт error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-exec-'));
  const config = { build: 'build', bridge: 'bridge.js', baseline: 'baseline', fps: 60, limits: { traceTail: 10 }, pixel: {}, viewport: { width: 320, height: 240 } };
  const spec = { name: 'toy', seed: 1, level: 0, mission: 'reach', policy: 'planned' };
  const outDir = path.join(root, 'out');
  const result = await executeRun({ root, config, adapter: toyAdapter(), hash: 'h', spec, outDir });
  assert.equal(result.verdict, 'error');
  const start = JSON.parse((await readFile(path.join(outDir, 'trace.jsonl'), 'utf8')).split('\n')[0]);
  assert.equal(start.t, 'start');
  assert.equal(start.env.fps, 60);
  assert.equal(typeof start.env.build, 'string');
});
