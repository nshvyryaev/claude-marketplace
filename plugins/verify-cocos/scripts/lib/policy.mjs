// Паттерны случайности: когда бот выбирает по плану, а когда наугад.
//
// Применяются отдельно к выбору краткосрочной цели и к выбору действия.
// Строка вида 'every:10' задаёт оба уровня сразу, объект { goal, action } —
// раздельно.

function fail(spec) {
  return new Error(`Неизвестный паттерн: ${typeof spec === 'string' ? spec : JSON.stringify(spec)}`);
}

export function parsePattern(spec) {
  if (spec && typeof spec === 'object') {
    return parsePattern(
      spec.pattern === 'every' ? `every:${spec.n}`
        : spec.pattern === 'burst' ? `burst:${spec.planned}/${spec.random}`
          : spec.pattern === 'chance' ? `chance:${spec.p}`
            : String(spec.pattern),
    );
  }
  if (spec === 'planned' || spec === 'random') return { pattern: spec };
  const [name, arg = ''] = String(spec).split(':');
  if (name === 'every') {
    const n = Number(arg);
    if (Number.isInteger(n) && n >= 1) return { pattern: 'every', n };
  }
  if (name === 'burst') {
    const [planned, random] = arg.split('/').map(Number);
    if (Number.isInteger(planned) && Number.isInteger(random) && planned >= 0 && random >= 0 && planned + random > 0) {
      return { pattern: 'burst', planned, random };
    }
  }
  if (name === 'chance') {
    const p = Number(arg);
    if (arg !== '' && p >= 0 && p <= 1) return { pattern: 'chance', p };
  }
  throw fail(spec);
}

export function createChooser(spec, rng) {
  const parsed = parsePattern(spec);
  let count = 0;
  switch (parsed.pattern) {
    case 'planned': return () => 'planned';
    case 'random': return () => 'random';
    case 'every': return () => (++count % parsed.n === 0 ? 'random' : 'planned');
    case 'burst': return () => {
      const at = count++ % (parsed.planned + parsed.random);
      return at < parsed.planned ? 'planned' : 'random';
    };
    case 'chance': return () => (rng() < parsed.p ? 'random' : 'planned');
    default: throw fail(spec);
  }
}

const split = (spec) => (spec && typeof spec === 'object' && ('goal' in spec || 'action' in spec)
  ? { goal: spec.goal ?? 'planned', action: spec.action ?? 'planned' }
  : { goal: spec ?? 'planned', action: spec ?? 'planned' });

export function createPolicy(spec, rng) {
  const { goal, action } = split(spec);
  return { goal: createChooser(goal, rng), action: createChooser(action, rng) };
}

const slugOf = (s) => String(typeof s === 'object' ? JSON.stringify(s) : s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

export function policySlug(spec) {
  const { goal, action } = split(spec);
  return goal === action ? slugOf(goal) : `g-${slugOf(goal)}_a-${slugOf(action)}`;
}
