// Один прогон целиком: сессия, старт уровня, агент, снимки, журнал.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from './session.mjs';
import { runAgent } from './agent.mjs';
import { createTrace, saveTrace } from './trace.mjs';
import { createPolicy } from './policy.mjs';
import { mulberry32, botSeed } from './rng.mjs';
import { buildFingerprint } from './project.mjs';
import { safeSummary } from './report.mjs';
import { compareShot } from './baseline.mjs';
import { unmetRequires } from './checks.mjs';

const PLUGIN_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude-plugin', 'plugin.json');

// Всё, кроме seed/уровня/миссии/политики и адаптера, что меняет ход прогона.
// Пишется в строку start, чтобы replay отличал недетерминизм игры от
// изменившегося окружения.
export async function runEnv(root, config) {
  const { version } = JSON.parse(await readFile(PLUGIN_JSON, 'utf8'));
  return { plugin: version, build: await buildFingerprint(root, config), fps: config.fps, limits: config.limits };
}

export async function executeRun({ root, config, adapter, hash, spec, outDir, stopAt = null, update = false }) {
  await mkdir(outDir, { recursive: true });
  const mission = typeof spec.mission === 'string' ? { name: spec.mission, params: {} } : spec.mission;
  const trace = createTrace();
  trace.write({
    f: 0, t: 'start', name: spec.name, seed: spec.seed, level: spec.level, theme: spec.theme ?? null,
    mission, policy: spec.policy, adapter: hash, env: await runEnv(root, config),
  });

  let game = null;
  let result;
  const review = [];
  let needsReview = 0;
  const baselineDir = path.resolve(root, config.baseline, spec.name);
  // Вырезка по сроку ожидания: agent — на осмотр агентом; pixel — сравнение
  // с эталоном прогона.
  const onShot = async (shot) => {
    const png = await game.shot(shot.region);
    const name = `${shot.id}-${shot.n}`;
    if (shot.level === 'agent') {
      await mkdir(path.join(outDir, 'review'), { recursive: true });
      const file = path.join(outDir, 'review', `${name}.png`);
      await writeFile(file, png);
      review.push({ id: shot.id, n: shot.n, criterion: shot.criterion, frame: shot.frame, trigger: shot.trigger, file: path.relative(root, file).split(path.sep).join('/') });
      return { outcome: 'review' };
    }
    const r = await compareShot({ png, name, baselineDir, newDir: path.join(outDir, 'baseline-new'), update, ...config.pixel });
    if (r.outcome === 'new') needsReview++;
    if (r.outcome === 'mismatch') {
      return { outcome: 'mismatch', violation: { id: shot.id, message: `пиксели разошлись с эталоном ${name}: доля ${r.ratio}`, data: { name } } };
    }
    return { outcome: r.outcome === 'updated' ? 'match' : r.outcome };
  };
  try {
    game = await openSession({ root, config, seed: spec.seed, run: { theme: spec.theme ?? null } });
    await game.start({ level: spec.level });
    const rng = mulberry32(botSeed(spec.seed));
    result = await runAgent({
      game, adapter, mission, policy: createPolicy(spec.policy, rng), rng,
      limits: { ...config.limits, stopAt }, trace, onShot,
    });
    if (review.length > 0) await writeFile(path.join(outDir, 'review', 'review.json'), JSON.stringify(review, null, 2));
    // Страница стоит на кадре, где прогон закончился: при нарушении это и
    // есть снимок момента бага.
    await game.screenshot(path.join(outDir, 'final.png'));
    await writeFile(path.join(outDir, 'state.json'), JSON.stringify(result.lastRaw, null, 2));
  } catch (error) {
    trace.write({ f: -1, t: 'end', verdict: 'error', message: error.message });
    result = { verdict: 'error', frame: 0, goals: 0, violation: { id: 'environment', message: error.message }, coverage: [], lastModel: null };
  } finally {
    await saveTrace(outDir, trace, config.limits.traceTail);
    await game?.close();
  }

  return {
    name: spec.name,
    verdict: result.verdict,
    frame: result.frame,
    goals: result.goals,
    violation: result.violation,
    summary: safeSummary(adapter, result.lastModel),
    dir: path.relative(root, outDir).split(path.sep).join('/'),
    coverage: result.coverage ?? [],
    unmet: unmetRequires(result.coverage ?? [], spec.requires ?? []),
    needsReview,
    review,
    requires: spec.requires ?? [],
  };
}
