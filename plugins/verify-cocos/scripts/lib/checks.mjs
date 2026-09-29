// Исполнитель проверок: инварианты и ожидания «когда X — в течение N кадров Y».
//
// Ожидание fact подтверждает сам исполнитель по then; pixel и agent по сроку
// просят вырезку, а исход вырезки сообщает вызывающий (resolveShot): сравнение
// с эталоном и снимки для агента — дело execute.mjs, не исполнителя.
const KINDS = new Set(['invariant', 'expectation']);
const LEVELS = new Set(['fact', 'pixel', 'agent']);

export function validateChecks(checks) {
  const seen = new Set();
  for (const c of checks) {
    const id = c?.id ?? '?';
    const bad = (what) => new Error(`Проверка ${id}: ${what}`);
    if (seen.has(id)) throw bad('id встречается дважды');
    seen.add(id);
    if (!KINDS.has(c.kind)) throw bad(`неизвестный kind ${c.kind}`);
    if (!LEVELS.has(c.level)) throw bad(`неизвестный level ${c.level}`);
    if (c.kind === 'invariant') {
      if (typeof c.check !== 'function') throw bad('у инварианта нет check');
      continue;
    }
    if (typeof c.when !== 'function') throw bad('у ожидания нет when');
    if (!Number.isInteger(c.within) || c.within < 0) throw bad(`within должен быть целым >= 0, получено ${c.within}`);
    if (c.level === 'fact' && typeof c.then !== 'function') throw bad('у ожидания fact нет then');
    if (c.level !== 'fact' && typeof c.region !== 'function') throw bad(`у ожидания ${c.level} нет region`);
  }
}

export function createCheckRunner(checks) {
  validateChecks(checks);
  const stats = new Map(checks.map((c) => [c.id, {
    id: c.id, kind: c.kind, level: c.level, steps: 0, armed: 0, confirmed: 0, missed: 0, unfinished: 0, pendingReview: 0,
  }]));
  let pending = [];

  return {
    observe(prev, cur, events, ctx) {
      const log = [];
      const shots = [];
      let violation = null;
      const fail = (v) => { violation ??= v; };

      for (const c of checks) {
        if (c.kind !== 'invariant') continue;
        stats.get(c.id).steps++;
        const v = c.check(prev, cur, events, ctx);
        if (v) fail({ id: c.id, message: v.message, data: v.data ?? null });
      }

      for (const c of checks) {
        if (c.kind !== 'expectation') continue;
        const trigger = c.when(prev, cur, events, ctx);
        if (trigger == null) continue;
        const s = stats.get(c.id);
        s.armed++;
        pending.push({ check: c, n: s.armed, deadline: ctx.frame + c.within, trigger });
        log.push({ t: 'arm', check: c.id, n: s.armed, trigger });
      }

      const still = [];
      for (const p of pending) {
        const s = stats.get(p.check.id);
        if (p.check.level === 'fact') {
          if (p.check.then(cur, events, p.trigger)) {
            s.confirmed++;
            log.push({ t: 'confirm', check: p.check.id, n: p.n });
          } else if (ctx.frame >= p.deadline) {
            s.missed++;
            log.push({ t: 'miss', check: p.check.id, n: p.n });
            fail({ id: p.check.id, message: `ожидание не выполнено за ${p.check.within} кадр(ов)`, data: p.trigger });
          } else {
            still.push(p);
          }
        } else if (ctx.frame >= p.deadline) {
          shots.push({
            id: p.check.id, n: p.n, level: p.check.level,
            region: p.check.region(cur, p.trigger), criterion: p.check.criterion ?? null, trigger: p.trigger,
          });
        } else {
          still.push(p);
        }
      }
      pending = still;
      return { violation, shots, log };
    },

    nextDeadline(frame) {
      let best = Infinity;
      for (const p of pending) best = Math.min(best, p.deadline - frame);
      return best;
    },

    resolveShot(id, outcome) {
      const s = stats.get(id);
      if (outcome === 'match') s.confirmed++;
      else if (outcome === 'mismatch') s.missed++;
      else s.pendingReview++;
    },

    finish() {
      for (const p of pending) stats.get(p.check.id).unfinished++;
      pending = [];
      return [...stats.values()];
    },
  };
}

export function unmetRequires(coverage, requires = []) {
  return requires.filter((id) => {
    const c = coverage.find((x) => x.id === id);
    if (!c) return true;
    if (c.kind === 'invariant') return c.steps === 0;
    return c.level === 'fact' ? c.confirmed === 0 : c.confirmed + c.pendingReview === 0;
  });
}

// Базовая проверка плагина — «игра замерла»: наблюдаемое состояние
// (adapter.progress, сравнивается через JSON) не меняется stallFrames кадров.
// Рост не требуется: бесцельный бот — не баг игры, его ловят таймауты целей.
export function createStallCheck(stallFrames, progress) {
  let last;
  let since = 0;
  return {
    id: 'stall', kind: 'invariant', level: 'fact',
    check(prev, cur, events, { frame }) {
      const value = JSON.stringify(progress(cur));
      if (value !== last || events.length > 0) {
        last = value;
        since = frame;
        return null;
      }
      if (frame - since >= stallFrames) return { message: `состояние не менялось ${frame - since} кадров`, data: { since } };
      return null;
    },
  };
}
