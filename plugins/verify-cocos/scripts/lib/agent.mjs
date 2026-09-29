// Агент: долгосрочная миссия → краткосрочная цель → тактика → действие.
//
// Модель по мотивам BDI (iv4XR/aplib): цели пересматриваются по событиям из
// adapter.replanOn, по завершению, провалу или таймауту цели. Выбор цели и
// выбор действия проходят через политику случайности независимо.
//
// Три класса исходов: баг игры (bug), беда бота (bot-stuck, bot-error,
// timeout) и нормальный конец (pass, lose, stopped).
import { pickIndex } from './rng.mjs';
import { createStallOracle, checkOracles } from './oracles.mjs';

const TOP_CANDIDATES = 5;
const round = (value) => Math.round(value * 1000) / 1000;

class AdapterError extends Error {}

function guard(fn, label) {
  try {
    return fn();
  } catch (error) {
    throw new AdapterError(`${label}: ${error.message}`);
  }
}

export async function runAgent({ game, adapter, missionName, policy, rng, limits, trace }) {
  const mission = adapter.missions[missionName];
  if (!mission) throw new Error(`Нет миссии ${missionName}; есть: ${Object.keys(adapter.missions).join(', ')}`);
  const stall = createStallOracle(limits.stallFrames, adapter.progress);

  let frame = 0;
  let goals = 0;
  let failures = 0;
  let goal = null;
  let goalStart = 0;
  let events = [];
  let raw = null;
  let model = null;

  const end = (verdict, violation = null) => {
    trace.write({ f: frame, t: 'end', verdict, ...(violation ? { violation: violation.id } : {}) });
    return { verdict, frame, goals, violation, lastRaw: raw, lastModel: model };
  };

  trace.write({ f: 0, t: 'mission', mission: missionName });

  try {
    raw = await game.observe();
    model = guard(() => adapter.toModel(raw), 'toModel');

    for (;;) {
      if (guard(() => mission.done(model, events), 'mission.done')) return end('pass');
      if (events.some((event) => event.type === 'gameOver')) return end('lose');
      if (frame >= limits.maxFrames) return end('timeout');
      if (limits.stopAt != null && frame >= limits.stopAt) return end('stopped');

      if (goal) {
        let result = null;
        if (guard(() => goal.done(model, events), 'goal.done')) result = 'done';
        else if (guard(() => goal.failed(model, events), 'goal.failed')) result = 'failed';
        else if (frame - goalStart >= limits.goalTimeoutFrames) result = 'timeout';
        else if (events.some((event) => adapter.replanOn.includes(event.type))) result = 'replan';
        if (result) {
          trace.write({ f: frame, t: 'goal-end', goal: goal.id, result, frames: frame - goalStart });
          if (result === 'failed' || result === 'timeout') failures++;
          if (result === 'done') failures = 0;
          goal = null;
        }
      }
      if (failures >= limits.maxGoalFailures) return end('bot-stuck');

      if (!goal) {
        const candidates = guard(() => adapter.candidates(model, mission), 'candidates');
        if (candidates.length > 0) {
          const by = policy.goal() === 'random' ? 'random' : 'score';
          let chosen = candidates[0];
          if (by === 'random') chosen = candidates[pickIndex(rng, candidates.length)];
          else for (const candidate of candidates) if (candidate.score > chosen.score) chosen = candidate;
          goal = { ...chosen, memo: {} };
          goalStart = frame;
          goals++;
          const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, TOP_CANDIDATES);
          trace.write({
            f: frame, t: 'plan', count: candidates.length,
            candidates: top.map((c) => ({ id: c.id, score: round(c.score) })),
            chosen: goal.id, by,
          });
        } else {
          trace.write({ f: frame, t: 'plan', count: 0 });
        }
      }

      let action = null;
      let frames = 1;
      let by;
      if (goal && policy.action() !== 'random') {
        ({ action, frames } = guard(() => adapter.tactics[goal.kind].next(model, goal), `tactics.${goal.kind}`));
        by = 'tactic';
      } else {
        const actions = await game.actions();
        action = actions.length > 0 ? actions[pickIndex(rng, actions.length)] : null;
        frames = 1 + pickIndex(rng, limits.randomActionFrames);
        by = goal ? 'random' : 'no-goal';
      }
      frames = Math.max(1, Math.floor(frames));

      await game.act(action);
      trace.write({ f: frame, t: 'act', goal: goal?.id ?? null, action, frames, by });
      const stepped = await game.step(frames);
      frame += stepped.frames;
      events = stepped.events;
      for (const event of events) trace.write({ f: frame, t: 'event', ...event });

      const prev = model;
      raw = await game.observe();
      model = guard(() => adapter.toModel(raw), 'toModel');

      const errors = game.errors();
      const violation = errors.length > 0
        ? { id: 'console-error', message: errors.map((e) => e.text).join(' | '), data: errors }
        : guard(() => checkOracles([stall, ...adapter.oracles], prev, model, events, { frame }), 'oracles');
      if (violation) {
        trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message, data: violation.data });
        return end('bug', violation);
      }
    }
  } catch (error) {
    if (error instanceof AdapterError) {
      const violation = { id: 'adapter-error', message: error.message, data: null };
      trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message });
      return end('bot-error', violation);
    }
    const violation = { id: 'bridge-error', message: error.message, data: null };
    trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message });
    return end('bug', violation);
  }
}
