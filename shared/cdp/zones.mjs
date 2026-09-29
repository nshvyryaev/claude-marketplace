// Соотнесение изменённых файлов с зонами проверки.
//
// Смысл — гонять не весь набор сценариев, а только задетые. Ключевое свойство:
// файл, не попавший ни в одно правило, означает «прогнать всё». Промах карты
// должен стоить лишнего прогона, а не пропущенной поломки.
//
// Сопоставление посегментное, без регулярных выражений: `*` внутри сегмента,
// `**` — любое число сегментов.

// Обратный слэш задан кодом: в исходнике он слишком легко теряется по дороге
// через слои инструментов, и потеря молча ломает разбор путей Windows.
const BACKSLASH = String.fromCharCode(92);

function matchSegment(pattern, part) {
  if (pattern === '*') return true;
  const pieces = pattern.split('*');
  if (pieces.length === 1) return pattern === part;

  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (!part.startsWith(first)) return false;
  if (!part.endsWith(last)) return false;
  if (first.length + last.length > part.length) return false;

  let at = first.length;
  for (const piece of pieces.slice(1, -1)) {
    const found = part.indexOf(piece, at);
    if (found === -1) return false;
    at = found + piece.length;
  }
  return at <= part.length - last.length;
}

function matchSegments(pattern, parts) {
  if (pattern.length === 0) return parts.length === 0;

  const [head, ...restPattern] = pattern;

  if (head === '**') {
    for (let skip = 0; skip <= parts.length; skip++) {
      if (matchSegments(restPattern, parts.slice(skip))) return true;
    }
    return false;
  }

  if (parts.length === 0) return false;
  return matchSegment(head, parts[0]) && matchSegments(restPattern, parts.slice(1));
}

export function normalizePath(filePath) {
  const slashed = filePath.split(BACKSLASH).join('/');
  return slashed.startsWith('./') ? slashed.slice(2) : slashed;
}

export function matchesPattern(pattern, filePath) {
  return matchSegments(pattern.split('/'), normalizePath(filePath).split('/'));
}

/**
 * Возвращает { zones, unmapped }. Непустой unmapped означает, что вызывающий
 * обязан прогнать весь набор.
 */
export function zonesForFiles(files, zoneMap) {
  const zones = new Set();
  const unmapped = [];

  for (const file of files) {
    let matched = false;
    for (const [pattern, patternZones] of Object.entries(zoneMap)) {
      if (!matchesPattern(pattern, file)) continue;
      matched = true;
      for (const zone of [].concat(patternZones)) zones.add(zone);
    }
    if (!matched) unmapped.push(file);
  }

  return { zones: [...zones], unmapped };
}

/** Итоговый набор сценариев: весь набор, если карта промахнулась. */
export function selectScenarios(scenarios, { zones, unmapped }) {
  if (unmapped.length > 0) {
    return { selected: scenarios, reason: `карта промахнулась: ${unmapped.join(', ')}` };
  }
  if (zones.length === 0) return { selected: [], reason: 'изменений нет' };
  return {
    selected: scenarios.filter((scenario) => zones.includes(scenario.zone)),
    reason: `зоны: ${zones.join(', ')}`,
  };
}
