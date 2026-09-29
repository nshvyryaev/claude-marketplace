// Данные проекта: конфиг, модули адаптера, прогоны.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePattern } from './policy.mjs';

export const DEFAULTS = {
  build: 'build/web-mobile',
  fps: 60,
  bridge: 'verify/bot/bridge.js',
  bot: 'verify/bot',
  runs: 'verify/runs',
  out: 'tmp/bot',
  viewport: { width: 1280, height: 720 },
  start: { level: 0 },
  limits: {
    maxFrames: 36000, stallFrames: 1800, goalTimeoutFrames: 1200, maxGoalFailures: 5,
    randomActionFrames: 30, startFrames: 3000, settleMs: 10, bootTimeoutMs: 60000, traceTail: 200,
  },
  policy: 'planned',
  soak: { seeds: 20, mission: 'capture-80', policies: ['planned', 'every:2', 'burst:30/10', 'random'] },
  zones: {},
};

const MODULES = ['model', 'missions', 'goals', 'tactics', 'oracles'];

export async function loadConfig(root, override) {
  const file = override ? path.resolve(override) : path.join(root, 'verify', 'cocos.json');
  if (!existsSync(file)) throw new Error(`Не найден ${file}. Создайте verify/cocos.json — см. README плагина.`);
  const user = JSON.parse(await readFile(file, 'utf8'));
  return {
    ...DEFAULTS,
    ...user,
    viewport: { ...DEFAULTS.viewport, ...user.viewport },
    start: { ...DEFAULTS.start, ...user.start },
    limits: { ...DEFAULTS.limits, ...user.limits },
    soak: { ...DEFAULTS.soak, ...user.soak },
  };
}

export async function adapterHash(root, config) {
  const dir = path.resolve(root, config.bot);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort();
  const hash = createHash('sha1');
  for (const file of files) hash.update(file).update(await readFile(path.join(dir, file)));
  hash.update(await readFile(path.resolve(root, config.bridge)));
  return hash.digest('hex').slice(0, 12);
}

export async function loadAdapter(root, config) {
  const dir = path.resolve(root, config.bot);
  const load = async (name) => {
    const file = path.join(dir, `${name}.mjs`);
    if (!existsSync(file)) throw new Error(`Нет модуля адаптера ${file}`);
    return import(pathToFileURL(file).href);
  };
  const [model, missions, goals, tactics, oracles] = await Promise.all(MODULES.map(load));
  const adapter = {
    toModel: model.toModel,
    progress: model.progress,
    summary: model.summary,
    missions: missions.missions,
    candidates: goals.candidates,
    replanOn: goals.replanOn ?? [],
    tactics: tactics.tactics,
    oracles: oracles.oracles ?? [],
  };
  for (const key of ['toModel', 'progress', 'missions', 'candidates', 'tactics']) {
    if (!adapter[key]) throw new Error(`Адаптер не экспортирует ${key} (см. README verify-cocos)`);
  }
  return { adapter, hash: await adapterHash(root, config) };
}

export async function loadRuns(root, config) {
  const dir = path.resolve(root, config.runs);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const runs = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    for (const key of ['zone', 'level', 'seed', 'mission', 'expect']) {
      if (run[key] === undefined) throw new Error(`Прогон ${file}: нет поля ${key}`);
    }
    const policy = run.policy ?? config.policy;
    const parts = typeof policy === 'object' && ('goal' in policy || 'action' in policy) ? [policy.goal, policy.action] : [policy];
    for (const part of parts) {
      try { parsePattern(part ?? 'planned'); } catch (error) { throw new Error(`Прогон ${file}: ${error.message}`); }
    }
    runs.push({ name: file.replace(/[.]json$/, ''), ...run, policy });
  }
  return runs;
}
