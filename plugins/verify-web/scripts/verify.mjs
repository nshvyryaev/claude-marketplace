#!/usr/bin/env node
// Прогон браузерных проверок проекта.
//
//   node verify.mjs                          весь набор
//   node verify.mjs --scenario move-reject   один сценарий
//   node verify.mjs --zone game              зона целиком
//   node verify.mjs --since HEAD             только задетое изменениями
//   node verify.mjs --changed src/a.ts,src/b.ts
//   node verify.mjs --update-baseline        принять текущий вид за эталон
//   node verify.mjs --dark --json
//
// Настройки — verify/config.json в корне проекта.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runScenarios } from './lib/run.mjs';
import { zonesForFiles, selectScenarios } from './vendor/cdp/zones.mjs';
import { formatReport, exitCode } from './lib/report.mjs';

function parseArgs(argv) {
  const args = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.values[key] = next;
      i++;
    } else {
      args.flags.add(key);
    }
  }
  return args;
}

const DEFAULTS = {
  url: 'http://localhost:5173/',
  viewport: { width: 390, height: 844, scale: 2 },
  clickable: 'button,[role="button"],a',
  shotsDir: 'tmp/shots',
  baselineDir: 'verify/baseline',
  scenarios: 'verify/scenarios',
  settleMs: 1500,
  timeout: 5000,
  pixelThreshold: 12,
  snapshotTolerance: 0.002,
  zones: {},
};

async function loadConfig(root, override) {
  const file = override ? path.resolve(override) : path.join(root, 'verify', 'config.json');
  if (!existsSync(file)) {
    throw new Error(`Не найден ${file}. Создайте verify/config.json — см. README плагина.`);
  }
  const user = JSON.parse(await readFile(file, 'utf8'));
  const config = { ...DEFAULTS, ...user, viewport: { ...DEFAULTS.viewport, ...user.viewport } };
  for (const key of ['shotsDir', 'baselineDir', 'scenarios']) {
    config[key] = path.resolve(root, config[key]);
  }
  return config;
}

async function loadScenarios(dir) {
  if (!existsSync(dir)) throw new Error(`Каталог сценариев не найден: ${dir}`);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort();
  const scenarios = [];

  for (const file of files) {
    const module = await import(pathToFileURL(path.join(dir, file)).href);
    const name = file.replace(/[.]mjs$/, '');
    if (typeof module.default !== 'function') {
      throw new Error(`Сценарий ${name} должен экспортировать функцию по умолчанию`);
    }
    if (!module.zone) throw new Error(`Сценарий ${name} должен экспортировать zone`);
    scenarios.push({
      name,
      zone: module.zone,
      title: module.title,
      allowErrors: module.allowErrors ?? false,
      motion: module.motion === true,
      run: module.default,
    });
  }
  return scenarios;
}

function changedFiles(args, root) {
  if (args.values.changed) return args.values.changed.split(',').map((s) => s.trim()).filter(Boolean);
  if (args.values.since) {
    const output = execFileSync('git', ['diff', '--name-only', args.values.since], {
      cwd: root,
      encoding: 'utf8',
    });
    return output.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.values.root ?? process.cwd());
const config = await loadConfig(root, args.values.config);
const all = await loadScenarios(config.scenarios);

let selected = all;
let selectionReason = 'весь набор';

if (args.values.scenario) {
  const wanted = args.values.scenario.split(',').map((s) => s.trim());
  selected = all.filter((s) => wanted.includes(s.name));
  selectionReason = `по имени: ${wanted.join(', ')}`;
  const missing = wanted.filter((w) => !all.some((s) => s.name === w));
  if (missing.length > 0) throw new Error(`Нет таких сценариев: ${missing.join(', ')}`);
} else if (args.values.zone) {
  const zones = args.values.zone.split(',').map((s) => s.trim());
  selected = all.filter((s) => zones.includes(s.zone));
  selectionReason = `зоны: ${zones.join(', ')}`;
} else {
  const changed = changedFiles(args, root);
  if (changed) {
    const picked = selectScenarios(all, zonesForFiles(changed, config.zones));
    selected = picked.selected;
    selectionReason = picked.reason;
  }
}

if (selected.length === 0) {
  console.log(`Нечего прогонять (${selectionReason}).`);
  process.exit(0);
}

const results = await runScenarios(selected, config, {
  dark: args.flags.has('dark'),
  updateBaseline: args.flags.has('update-baseline'),
  log: args.flags.has('json') ? () => {} : (message) => console.log(message),
});

if (args.flags.has('json')) {
  console.log(JSON.stringify({ selectionReason, results }, null, 2));
} else {
  console.log(formatReport(results, { selectionReason, dark: args.flags.has('dark') }));
}

process.exit(exitCode(results));
