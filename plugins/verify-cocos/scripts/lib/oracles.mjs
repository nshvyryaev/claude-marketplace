// Оракулы — правила, которые должны выполняться всегда. Нарушение — баг игры.
//
// Базовый оракул плагина — «игра замерла»: наблюдаемое состояние
// (adapter.progress — любое значение, сравнивается через JSON) не меняется
// stallFrames кадров. Рост не требуется: бесцельно бродящий бот — не баг игры,
// его ловят таймауты целей (bot-stuck) и maxFrames (timeout). Остальные
// базовые проверки (ошибки консоли, исключения моста) агент делает сам.

export function createStallOracle(stallFrames, progress) {
  let last;
  let since = 0;
  return {
    id: 'stall',
    check(prev, cur, events, { frame }) {
      const value = JSON.stringify(progress(cur));
      if (value !== last || events.length > 0) {
        last = value;
        since = frame;
        return null;
      }
      if (frame - since >= stallFrames) {
        return { message: `состояние не менялось ${frame - since} кадров`, data: { since } };
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
