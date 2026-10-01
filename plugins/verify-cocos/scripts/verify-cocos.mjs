#!/usr/bin/env node
// Бот-тестировщик для игры на Cocos Creator.
//
//   node verify-cocos.mjs run                          все прогоны verify/runs
//   node verify-cocos.mjs run --run capture-level-1    по имени (через запятую)
//   node verify-cocos.mjs run --zone gameplay          по зоне
//   node verify-cocos.mjs run --since HEAD             только задетое изменениями
//   node verify-cocos.mjs run --changed a.ts,b.ts
//   node verify-cocos.mjs soak [--seeds 50] [--policies planned,random]
//   node verify-cocos.mjs replay tmp/bot/<прогон> [--until 1200]
//   node verify-cocos.mjs probe [--level 0] [--seed 1]  состояние и действия после старта
//   node verify-cocos.mjs coverage                     какие проверки какими прогонами подтверждены
//   run: --update-baseline (принять вырезки), --theme <id> (тема вместо заданной прогоном)
//
//   run, soak: --jobs <N> — до N прогонов одновременно (у каждого свой Chrome)
//
// Общие флаги: --root <каталог проекта>, --config <файл>, --json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadConfig, loadAdapter, loadRuns, checkMissions } from './lib/project.mjs';
import { executeRun, runEnv, mapPool } from './lib/execute.mjs';
import { openSession } from './lib/session.mjs';
import { readTraceLines } from './lib/trace.mjs';
import { parsePattern, policySlug } from './lib/policy.mjs';
import { zonesForFiles, selectScenarios } from './vendor/cdp/zones.mjs';
import {
  runOk, formatRunLine, summarizeSoak, formatSoakSummary,
  exitCodeRun, exitCodeSoak, compareTraces, startDifferences, mergeCoverage, coveredRuns,
} from './lib/report.mjs';

function parseArgs(argv) {
  const args = { positional: [], flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { args.positional.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args.values[key] = next; i++; } else { args.flags.add(key); }
  }
  return args;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const list = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);

const args = parseArgs(process.argv.slice(2));
const command = args.positional[0];
const root = path.resolve(args.values.root ?? process.cwd());
const json = args.flags.has('json');
const log = json ? () => {} : (message) => console.log(message);
const config = await loadConfig(root, args.values.config);
const outRoot = path.resolve(root, config.out);

const jobs = () => {
  const n = Number(args.values.jobs ?? 1);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--jobs: целое ≥ 1, а не ${args.values.jobs}`);
  return n;
};

async function commandRun() {
  const all = await loadRuns(root, config);
  let selected = all;
  let reason = 'весь набор';
  if (args.values.run) {
    const wanted = list(args.values.run);
    const missing = wanted.filter((w) => !all.some((r) => r.name === w));
    if (missing.length > 0) throw new Error(`Нет таких прогонов: ${missing.join(', ')}`);
    selected = all.filter((r) => wanted.includes(r.name));
    reason = `по имени: ${wanted.join(', ')}`;
  } else if (args.values.zone) {
    const zones = list(args.values.zone);
    selected = all.filter((r) => zones.includes(r.zone));
    reason = `зоны: ${zones.join(', ')}`;
  } else if (args.values.changed || args.values.since) {
    const changed = args.values.changed
      ? list(args.values.changed)
      : execFileSync('git', ['diff', '--name-only', args.values.since], { cwd: root, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
    ({ selected, reason } = selectScenarios(all, zonesForFiles(changed, config.zones)));
  }
  if (selected.length === 0) { log(`Нечего прогонять (${reason}).`); return 0; }

  const { adapter, hash } = await loadAdapter(root, config);
  checkMissions(selected, adapter);
  log(`Прогонов: ${selected.length} (${reason}), адаптер ${hash}`);
  const results = await mapPool(selected, jobs(), async (spec) => {
    const run = { ...spec, theme: args.values.theme ?? spec.theme };
    const result = await executeRun({ root, config, adapter, hash, spec: run, outDir: path.join(outRoot, `${spec.name}-${stamp()}`), update: args.flags.has('update-baseline') });
    result.ok = runOk(result, spec.expect);
    result.expect = spec.expect;
    log(formatRunLine(result));
    return result;
  });
  await saveCoverage(results, hash);
  if (json) console.log(JSON.stringify({ reason, results }, null, 2));
  return exitCodeRun(results);
}

async function commandSoak() {
  const seeds = Number(args.values.seeds ?? config.soak.seeds);
  const policies = args.values.policies ? list(args.values.policies) : config.soak.policies;
  // Опечатка в паттерне должна всплыть до запуска десятков Chrome.
  for (const policy of policies) parsePattern(policy);
  const { adapter, hash } = await loadAdapter(root, config);
  const soakMission = { name: config.soak.mission, params: {} };
  checkMissions([{ name: 'soak', mission: soakMission }], adapter);
  const batch = path.join(outRoot, `soak-${stamp()}`);
  log(`Soak: ${seeds} seed × ${policies.length} политик, адаптер ${hash}`);
  const specs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    for (const policy of policies) {
      const name = `s${seed}-${policySlug(policy)}`;
      specs.push({ name, level: config.start.level, seed, mission: soakMission, policy, theme: config.theme, requires: [] });
    }
  }
  const results = await mapPool(specs, jobs(), async (spec) => {
    const result = await executeRun({ root, config, adapter, hash, spec, outDir: path.join(batch, spec.name) });
    log(formatRunLine(result));
    return result;
  });
  const summary = summarizeSoak(results);
  log(formatSoakSummary(summary));
  if (json) console.log(JSON.stringify({ summary, results }, null, 2));
  return exitCodeSoak(results);
}

async function commandReplay() {
  const dir = path.resolve(root, args.positional[1] ?? '');
  const original = await readTraceLines(path.join(dir, 'trace.jsonl'));
  const start = JSON.parse(original[0]);
  if (start.t !== 'start') throw new Error(`Первая строка журнала — не start: ${original[0]}`);
  const { adapter, hash } = await loadAdapter(root, config);
  const changed = startDifferences(start, { adapter: hash, env: await runEnv(root, config) });
  if (changed.length > 0) {
    // Предупреждение — в stderr: с --json оно не должно теряться.
    console.error(`ВНИМАНИЕ: с исходного прогона изменилось: ${changed.join(', ')}. Расхождение журналов ожидаемо и не говорит о недетерминизме игры.`);
  }
  const stopAt = args.values.until != null ? Number(args.values.until) : null;
  const outDir = path.join(dir, `replay-${stamp()}`);
  const spec = { name: start.name, level: start.level, seed: start.seed, mission: start.mission, policy: start.policy, theme: start.theme ?? null, touch: !!start.touch, bridge: start.bridge ?? null };
  const result = await executeRun({ root, config, adapter, hash, spec, outDir, stopAt });
  log(formatRunLine(result));
  const replayed = await readTraceLines(path.join(outDir, 'trace.jsonl'));
  // Строка start сравнивается отдельно (выше): отличие в ней — окружение, а
  // не ход прогона, и оно не должно прятать настоящую точку расхождения.
  const diff = compareTraces(original.slice(1), replayed.slice(1), { prefix: stopAt != null });
  if (!diff) { log('Журнал воспроизведён без расхождений.'); return 0; }
  log(`Расхождение на строке ${diff.line + 1}:\n  было:  ${diff.expected}\n  стало: ${diff.actual}`);
  return 1;
}

async function commandProbe() {
  const level = Number(args.values.level ?? config.start.level);
  const seed = Number(args.values.seed ?? 1);
  const game = await openSession({ root, config, seed, run: { theme: args.values.theme ?? config.theme } });
  try {
    await game.start({ level });
    const state = await game.observe();
    if (state?.grid?.cells) state.grid.cells = `<base64, ${state.grid.cells.length} символов>`;
    console.log(JSON.stringify({ state, actions: await game.actions(), errors: game.errors() }, null, 2));
    return 0;
  } finally {
    await game.close();
  }
}

// Формат coverage.json и правила зачёта — mergeCoverage/coveredRuns (report.mjs).
const coverageFile = () => path.join(outRoot, 'coverage.json');

async function saveCoverage(results, hash) {
  const file = coverageFile();
  const data = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
  await mkdir(outRoot, { recursive: true });
  await writeFile(file, JSON.stringify(mergeCoverage(data, results, hash), null, 2));
}

async function commandCoverage() {
  const file = coverageFile();
  if (!existsSync(file)) { console.error('Нет данных покрытия: сначала run.'); return 1; }
  const data = JSON.parse(await readFile(file, 'utf8'));
  const { adapter, hash } = await loadAdapter(root, config);
  const runNames = (await loadRuns(root, config)).map((r) => r.name);
  let uncovered = 0;
  for (const check of adapter.checks) {
    const runs = coveredRuns(data, check.id, hash, runNames);
    if (runs.length === 0 && check.kind === 'expectation') uncovered++;
    log(`${check.id} (${check.kind}/${check.level}): ${runs.length > 0 ? runs.join(', ') : '— ни одним прогоном'}`);
  }
  log(uncovered > 0 ? `Не подтверждено ожиданий: ${uncovered}` : 'Все ожидания подтверждены хотя бы одним прогоном.');
  return uncovered > 0 ? 1 : 0;
}

const COMMANDS = { run: commandRun, soak: commandSoak, replay: commandReplay, probe: commandProbe, coverage: commandCoverage };
if (!COMMANDS[command]) {
  console.error(`Команда: ${Object.keys(COMMANDS).join(' | ')}. См. шапку verify-cocos.mjs.`);
  process.exit(2);
}
process.exit(await COMMANDS[command]());
