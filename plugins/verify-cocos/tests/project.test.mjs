import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadRuns, adapterHash } from '../scripts/lib/project.mjs';

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-proj-'));
  await mkdir(path.join(root, 'verify', 'bot'), { recursive: true });
  await mkdir(path.join(root, 'verify', 'runs'), { recursive: true });
  await writeFile(path.join(root, 'verify', 'cocos.json'), JSON.stringify({ build: 'b', limits: { maxFrames: 5 } }));
  await writeFile(path.join(root, 'verify', 'bot', 'bridge.js'), '1');
  await writeFile(path.join(root, 'verify', 'bot', 'model.mjs'), 'export const a = 1;');
  return root;
}

test('конфиг сливается с умолчаниями, вложенные лимиты — по ключам', async () => {
  const root = await project();
  const config = await loadConfig(root);
  assert.equal(config.build, 'b');
  assert.equal(config.limits.maxFrames, 5);
  assert.equal(config.limits.stallFrames, 1800);
  assert.equal(config.fps, 60);
});

test('нет verify/cocos.json — понятная ошибка', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-empty-'));
  await assert.rejects(loadConfig(root), /verify\/cocos\.json/);
});

test('прогон без обязательного поля отклоняется с именем файла', async () => {
  const root = await project();
  await writeFile(path.join(root, 'verify', 'runs', 'bad.json'), JSON.stringify({ zone: 'z', level: 0, seed: 1 }));
  await assert.rejects(loadRuns(root, await loadConfig(root)), /bad\.json.*mission/);
});

test('прогон с опечаткой в политике отклоняется до запуска', async () => {
  const root = await project();
  await writeFile(path.join(root, 'verify', 'runs', 'p.json'), JSON.stringify({ zone: 'z', level: 0, seed: 1, mission: 'm', policy: 'evry:2', expect: { verdict: 'pass' } }));
  await assert.rejects(loadRuns(root, await loadConfig(root)), /evry:2/);
});

test('хэш адаптера меняется при правке модуля', async () => {
  const root = await project();
  const config = await loadConfig(root);
  const before = await adapterHash(root, config);
  await writeFile(path.join(root, 'verify', 'bot', 'model.mjs'), 'export const a = 2;');
  assert.notEqual(await adapterHash(root, config), before);
});
