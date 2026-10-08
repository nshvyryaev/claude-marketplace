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
//
// Часы прогона (cfg.clock, мс эпохи; по выбору прогона): до заморозки Date
// стоит на cfg.clock, после — идёт от него с виртуальным временем кадров.
// В этом режиме подменяется и конструктор Date: new Date() без аргументов
// тоже видит часы прогона. Без cfg.clock Date.now — прежняя эпоха шима, а
// new Date() — настоящее время (как было до часов прогона).

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
  let frozen = false;
  performance.now = () => now;

  let clockBase = null;
  const elapsed = () => (frozen ? Math.floor(frames * frameMs) : 0);
  const wallNow = () => (clockBase === null ? EPOCH_MS + Math.floor(now) : clockBase + elapsed());
  Date.now = wallNow;
  const RealDate = Date;
  const setClock = (ms) => {
    if (clockBase === null) {
      // Конструктор подменяется при первом включении часов: instanceof и
      // прототип — настоящие, Date() без new — строка, как в браузере.
      const BotDate = function BotDate(...args) {
        if (!new.target) return new RealDate(wallNow()).toString();
        return args.length === 0 ? new RealDate(wallNow()) : new RealDate(...args);
      };
      BotDate.prototype = RealDate.prototype;
      BotDate.now = wallNow;
      BotDate.parse = RealDate.parse;
      BotDate.UTC = RealDate.UTC;
      window.Date = BotDate;
    }
    clockBase = ms - elapsed();
  };
  if (cfg.clock != null) setClock(cfg.clock);

  const realRaf = window.requestAnimationFrame.bind(window);
  let queue = [];
  let nextId = 1;

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
    // Часы прогона: Date.now() страницы становится ms с этого момента.
    setClock,
    wallNow,
    // Настоящий кадр браузера: к нему события resize и online/offline уже
    // разосланы — плагин ждёт его после смены окружения посреди прогона.
    realFrame: () => new Promise((resolve) => realRaf(() => resolve(true))),
  };
}

export function shimSource({ seed, fps, clock = null }) {
  return `(${shimMain.toString()})(${JSON.stringify({ seed: seed >>> 0, fps, clock })});`;
}
