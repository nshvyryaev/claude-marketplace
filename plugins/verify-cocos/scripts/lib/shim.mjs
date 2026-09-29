// Код, который внедряется в страницу раньше самой игры.
//
// 1. Math.random — PRNG с seed (тот же алгоритм, что rng.mjs).
// 2. performance.now и Date.now — виртуальное время, растущее только с кадрами.
// 3. requestAnimationFrame — своя очередь. До freeze() её прокручивает
//    настоящий rAF (игра грузится как обычно); после — только step(n).
//    Исключение одного колбэка не останавливает остальные и уходит в
//    reportError — как в браузере: иначе баг игры рвал бы step и выглядел
//    как сбой моста.
//
// Главный цикл Cocos держится на rAF, поэтому очередь rAF и есть его кадры:
// один step — один кадр движка с dt ровно 1/fps.
//
// После freeze время прыгает на фиксированную базу: сколько кадров прошло до
// заморозки, зависит от скорости загрузки, и абсолютное время иначе было бы
// недетерминированным.
//
// Шаг кадра — ceil(1000/fps · 1024) / 1024 мс: число точно представимо в
// double, поэтому разница соседних отметок одинакова побитово на любом кадре.
// При шаге ровно 1000/60 Pacer Cocos видел часть интервалов на ULP короче
// кадра и пропускал их, а dt дрожал в младших битах — прогоны с одним seed
// расходились (см. результаты спайка в спеке).

function shimMain(cfg) {
  const makeRng = (seed) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const FROZEN_BASE_MS = 1e7;
  const EPOCH_MS = 1767225600000;
  const frameMs = Math.ceil((1000 / cfg.fps) * 1024) / 1024;

  let rng = makeRng(cfg.seed);
  Math.random = () => rng();

  let base = 0;
  let frames = 0;
  let now = 0;
  performance.now = () => now;
  Date.now = () => EPOCH_MS + Math.floor(now);

  const realRaf = window.requestAnimationFrame.bind(window);
  let queue = [];
  let nextId = 1;
  let frozen = false;

  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue = queue.filter((entry) => entry.id !== id);
  };

  const pump = () => {
    frames++;
    now = base + frames * frameMs;
    const run = queue;
    queue = [];
    for (const entry of run) {
      try {
        entry.cb(now);
      } catch (error) {
        reportError(error);
      }
    }
  };
  const loop = () => {
    if (!frozen) pump();
    realRaf(loop);
  };
  realRaf(loop);

  window.__botShim = {
    fps: cfg.fps,
    freeze() {
      frozen = true;
      base = FROZEN_BASE_MS;
      frames = 0;
    },
    reseed(seed) {
      rng = makeRng(seed);
    },
    step(n) {
      for (let i = 0; i < n; i++) pump();
    },
    stepUntilEvents(n) {
      let events = [];
      let i = 0;
      while (i < n) {
        pump();
        i++;
        events = window.__bot.frameEvents();
        if (events.length > 0) break;
      }
      return { frames: i, events };
    },
    frames: () => frames,
    now: () => now,
  };
}

export function shimSource({ seed, fps }) {
  return `(${shimMain.toString()})(${JSON.stringify({ seed: seed >>> 0, fps })});`;
}
