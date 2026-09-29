// Детерминированный PRNG. Тот же алгоритм живёт в shim.mjs внутри страницы —
// тест shim.test.mjs сверяет, что последовательности совпадают.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Поток бота отделён от потока игры: смена паттерна случайности не должна
// менять спавн врагов при том же seed.
export const botSeed = (seed) => (seed ^ 0x9e3779b9) >>> 0;

export const pickIndex = (rng, n) => Math.floor(rng() * n);
