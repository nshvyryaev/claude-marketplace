// Один прогон целиком: сессия, старт уровня, агент, снимки, журнал.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openSession } from './session.mjs';
import { runAgent } from './agent.mjs';
import { createTrace, saveTrace } from './trace.mjs';
import { createPolicy } from './policy.mjs';
import { mulberry32, botSeed } from './rng.mjs';

export async function executeRun({ root, config, adapter, hash, spec, outDir, stopAt = null }) {
  await mkdir(outDir, { recursive: true });
  const trace = createTrace();
  trace.write({
    f: 0, t: 'start', name: spec.name, seed: spec.seed, level: spec.level,
    mission: spec.mission, policy: spec.policy, adapter: hash,
  });

  let game = null;
  let result;
  try {
    game = await openSession({ root, config, seed: spec.seed });
    await game.start({ level: spec.level });
    const rng = mulberry32(botSeed(spec.seed));
    result = await runAgent({
      game, adapter, missionName: spec.mission, policy: createPolicy(spec.policy, rng), rng,
      limits: { ...config.limits, stopAt }, trace,
    });
    // Страница стоит на кадре, где прогон закончился: при нарушении это и
    // есть снимок момента бага.
    await game.screenshot(path.join(outDir, 'final.png'));
    await writeFile(path.join(outDir, 'state.json'), JSON.stringify(result.lastRaw, null, 2));
  } catch (error) {
    trace.write({ f: -1, t: 'end', verdict: 'error', message: error.message });
    result = { verdict: 'error', frame: 0, goals: 0, violation: { id: 'environment', message: error.message }, lastModel: null };
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
    summary: result.lastModel && adapter.summary ? adapter.summary(result.lastModel) : '',
    dir: path.relative(root, outDir).split(path.sep).join('/'),
  };
}
