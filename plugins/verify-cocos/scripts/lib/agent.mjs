// Агент: долгосрочная миссия → краткосрочная цель → тактика → действие.
//
// Модель по мотивам BDI (iv4XR/aplib): цели пересматриваются по событиям из
// adapter.replanOn, по завершению, провалу или таймауту цели. Выбор цели и
// выбор действия проходят через политику случайности независимо.
//
// Три класса исходов: баг игры (bug), беда бота (bot-stuck, bot-error,
// timeout) и нормальный конец (pass, lose, stopped).
import { pickIndex } from './rng.mjs';
import { createCheckRunner, createStallCheck } from './checks.mjs';

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

export async function runAgent({ game, adapter, mission: missionSpec, policy, rng, limits, trace, onShot = async () => ({ outcome: 'review' }) }) {
  const def = adapter.missions[missionSpec.name];
  if (!def) throw new Error(`Нет миссии ${missionSpec.name}; есть: ${Object.keys(adapter.missions).join(', ')}`);
  let mission = null;
  let runner = null;

  let frame = 0;
  let goals = 0;
  let failures = 0;
  let goal = null;
  let goalStart = 0;
  let tacticActs = 0;
  let events = [];
  let raw = null;
  let model = null;

  const end = (verdict, violation = null) => {
    trace.write({ f: frame, t: 'end', verdict, ...(violation ? { violation: violation.id } : {}) });
    const coverage = runner ? runner.finish() : [];
    return { verdict, frame, goals, violation, coverage, lastRaw: raw, lastModel: model };
  };

  trace.write({ f: 0, t: 'mission', mission: missionSpec.name, params: missionSpec.params ?? {} });

  try {
    // Миссия — объект или фабрика по параметрам прогона. Её создание и
    // исполнитель проверок — код адаптера: ошибка в них — bot-error.
    mission = guard(() => (typeof def === 'function' ? def(missionSpec.params ?? {}) : def), 'missions');
    runner = guard(() => createCheckRunner([createStallCheck(limits.stallFrames, adapter.progress), ...(adapter.checks ?? [])]), 'checks');
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
          // Провал цели — беда бота, только если тактика успела действовать.
          // При случайных действиях цель не исполнялась, и копить провалы до
          // bot-stuck значит обрывать исследование игры как неудачу бота.
          if ((result === 'failed' || result === 'timeout') && tacticActs > 0) failures++;
          if (result === 'done') failures = 0;
          goal = null;
        }
      }
      if (failures >= limits.maxGoalFailures) return end('bot-stuck');

      if (!goal) {
        const candidates = guard(() => {
          const list = adapter.candidates(model, mission);
          if (!Array.isArray(list)) throw new Error(`ожидался массив целей, получено ${JSON.stringify(list)}`);
          // Миссия-сценарий допускает только свои виды целей.
          return mission.goals ? list.filter((c) => mission.goals.includes(c.kind)) : list;
        }, 'candidates');
        if (candidates.length > 0) {
          const by = policy.goal() === 'random' ? 'random' : 'score';
          let chosen = candidates[0];
          if (by === 'random') chosen = candidates[pickIndex(rng, candidates.length)];
          else for (const candidate of candidates) if (candidate.score > chosen.score) chosen = candidate;
          goal = { ...chosen, memo: {} };
          goalStart = frame;
          tacticActs = 0;
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
        ({ action, frames } = guard(() => {
          const step = adapter.tactics[goal.kind].next(model, goal);
          // NaN или отсутствующий frames прокрутил бы ноль кадров, и ни один
          // лимит не сработал бы — вечный цикл вместо вердикта.
          if (!step || typeof step !== 'object' || !(step.frames >= 1)) {
            throw new Error(`ожидалось { action, frames >= 1 }, получено ${JSON.stringify(step)}`);
          }
          return step;
        }, `tactics.${goal.kind}`));
        by = 'tactic';
        tacticActs++;
      } else {
        const actions = await game.actions();
        action = actions.length > 0 ? actions[pickIndex(rng, actions.length)] : null;
        frames = 1 + pickIndex(rng, limits.randomActionFrames);
        by = goal ? 'random' : 'no-goal';
      }
      // Шаг не длиннее ближайшего лимита: огромный шаг тактики иначе крутил
      // бы игру внутри одного вызова страницы, а --until проскакивал бы кадр.
      const room = Math.min(
        limits.maxFrames - frame,
        goal ? limits.goalTimeoutFrames - (frame - goalStart) : Infinity,
        limits.stopAt != null ? limits.stopAt - frame : Infinity,
        // Срок ожидания: then проверяется в наблюдении, а длинный шаг
        // перескочил бы момент и засчитал бы промах.
        runner.nextDeadline(frame),
      );
      frames = Math.max(1, Math.floor(Math.min(frames, room)));

      try {
        await game.act(action);
      } catch (error) {
        // Мост вернул ввод, который нельзя исполнить, — ошибка адаптера.
        if (error.adapterFault) throw new AdapterError(`act: ${error.message}`);
        throw error;
      }
      trace.write({ f: frame, t: 'act', goal: goal?.id ?? null, action, frames, by });
      const stepped = await game.step(frames);
      frame += stepped.frames;
      events = stepped.events;
      for (const event of events) trace.write({ f: frame, t: 'event', ...event });

      const prev = model;
      raw = await game.observe();
      model = guard(() => adapter.toModel(raw), 'toModel');

      const errors = game.errors();
      if (errors.length > 0) {
        const violation = { id: 'console-error', message: errors.map((e) => e.text).join(' | '), data: errors };
        trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message, data: violation.data });
        return end('bug', violation);
      }
      const checked = guard(() => runner.observe(prev, model, events, { frame }), 'checks');
      for (const entry of checked.log) trace.write({ f: frame, ...entry });
      let violation = checked.violation;
      for (const shot of checked.shots) {
        let shotResult;
        try {
          shotResult = await onShot({ ...shot, frame });
        } catch (error) {
          // Вырезка, которую нельзя снять, — ошибка проверки проекта.
          if (error.adapterFault) throw new AdapterError(`${shot.id}: ${error.message}`);
          throw error;
        }
        const { outcome, violation: shotViolation } = shotResult;
        runner.resolveShot(shot.id, outcome);
        trace.write({ f: frame, t: 'shot', check: shot.id, n: shot.n, outcome });
        violation ??= shotViolation ?? null;
      }
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
