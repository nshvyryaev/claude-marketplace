import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTrace, saveTrace, readTraceLines } from '../scripts/lib/trace.mjs';

test('журнал пишется построчно, хвост — последние N строк', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vc-trace-'));
  const trace = createTrace();
  for (let f = 0; f < 10; f++) trace.write({ f, t: 'act' });
  await saveTrace(dir, trace, 3);
  const lines = await readTraceLines(path.join(dir, 'trace.jsonl'));
  assert.equal(lines.length, 10);
  assert.deepEqual(JSON.parse(lines[9]), { f: 9, t: 'act' });
  const tail = (await readFile(path.join(dir, 'tail.jsonl'), 'utf8')).trim().split('\n');
  assert.deepEqual(tail.map((l) => JSON.parse(l).f), [7, 8, 9]);
});
