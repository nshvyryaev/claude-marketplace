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
    randomActionFrames: 30, startFrames: 3000, settleMs: 10, bootTimeoutMs: 60000, traceTail: 200, drainFrames: 120,
  },
  policy: 'planned',
  soak: { seeds: 20, mission: 'capture-80', policies: ['planned', 'every:2', 'burst:30/10', 'random'] },
  zones: {},
  theme: null,
  pixel: { threshold: 12, tolerance: 0.002 },
  baseline: 'verify/baseline',
};

const MODULES = ['model', 'missions', 'goals', 'tactics', 'checks'];

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
    pixel: { ...DEFAULTS.pixel, ...user.pixel },
  };
}

export async function adapterHash(root, config) {
  const dir = path.resolve(root, config.bot);
  // Рекурсивно: адаптер может раскладывать правила по подкаталогам.
  const files = (await readdir(dir, { recursive: true })).map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.mjs') && !f.startsWith('tests/')).sort();
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
  const [model, missions, goals, tactics, checks] = await Promise.all(MODULES.map(load));
  const adapter = {
    toModel: model.toModel,
    progress: model.progress,
    summary: model.summary,
    missions: missions.missions,
    candidates: goals.candidates,
    replanOn: goals.replanOn ?? [],
    tactics: tactics.tactics,
    checks: checks.checks ?? [],
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
    const mission = typeof run.mission === 'string'
      ? { name: run.mission, params: {} }
      : (({ name, ...params }) => ({ name, params }))(run.mission);
    runs.push({ name: file.replace(/[.]json$/, ''), ...run, policy, mission, theme: run.theme ?? config.theme, requires: run.requires ?? [] });
  }
  return runs;
}

export function checkMissions(runs, adapter) {
  const problems = [];
  for (const run of runs) {
    const def = adapter.missions[run.mission.name];
    if (!def) { problems.push(`${run.name} → ${run.mission.name}`); continue; }
    // Миссия-фабрика объявляет обязательные параметры свойством required.
    const missing = (def.required ?? []).filter((key) => run.mission.params[key] === undefined);
    if (missing.length > 0) problems.push(`${run.name} → ${run.mission.name}: нет параметров ${missing.join(', ')}`);
  }
  if (problems.length > 0) {
    throw new Error(`Миссии: ${problems.join('; ')}; есть: ${Object.keys(adapter.missions).join(', ')}`);
  }
}

// Отпечаток сборки: пересборка меняет ход прогона так же, как правка адаптера.
export async function buildFingerprint(root, config) {
  const dir = path.resolve(root, config.build);
  const hash = createHash('sha1');
  const files = [path.join(dir, 'index.html')];
  const src = path.join(dir, 'src');
  if (existsSync(src)) {
    for (const file of (await readdir(src)).filter((f) => /^settings.*\.json$/.test(f)).sort()) files.push(path.join(src, file));
  }
  for (const file of files) {
    if (existsSync(file)) hash.update(path.basename(file)).update(await readFile(file));
  }
  return hash.digest('hex').slice(0, 12);
}
