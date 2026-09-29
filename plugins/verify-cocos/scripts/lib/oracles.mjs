// Оракулы — правила, которые должны выполняться всегда. Нарушение — баг игры.
//
// Базовый оракул плагина — «нет прогресса»: что считать прогрессом, решает
// проект (adapter.progress). Остальные базовые проверки (ошибки консоли,
// исключения моста) агент делает сам — им не нужны состояния.

export function createStallOracle(stallFrames, progress) {
  let best = -Infinity;
  let since = 0;
  return {
    id: 'stall',
    check(prev, cur, events, { frame }) {
      const value = progress(cur);
      if (value > best || events.length > 0) {
        best = Math.max(best, value);
        since = frame;
        return null;
      }
      if (frame - since >= stallFrames) {
        return { message: `нет прогресса ${frame - since} кадров (прогресс ${value})`, data: { value, since } };
      }
      return null;
    },
  };
}

export function checkOracles(oracles, prev, cur, events, ctx) {
  for (const oracle of oracles) {
    const violation = oracle.check(prev, cur, events, ctx);
    if (violation) return { id: oracle.id, message: violation.message, data: violation.data ?? null };
  }
  return null;
}
