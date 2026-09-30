// Вердикты, сводки и коды возврата.
//
// Класс вердикта говорит, что чинить: «игра» — баг игры, «бот» — тактику или
// лимиты, «среда» — сборку, Chrome, мост.
const CLASSES = {
  pass: '—', lose: '—', stopped: '—',
  bug: 'игра',
  'bot-stuck': 'бот', 'bot-error': 'бот', timeout: 'бот',
  error: 'среда',
};

export const verdictClass = (verdict) => CLASSES[verdict] ?? 'среда';

export function expectMatches(result, expect = {}) {
  if (expect.verdict && result.verdict !== expect.verdict) return false;
  if (expect.verdictIn && !expect.verdictIn.includes(result.verdict)) return false;
  if (expect.maxFrames != null && result.frame > expect.maxFrames) return false;
  return true;
}

// Прогон, которому до зелёного не хватает только осмотра вырезок: не баг.
const onlyReview = (result) => result.ok === false && (result.needsReview ?? 0) > 0
  && (result.unmet ?? []).length === 0 && expectMatches(result, result.expect);

export function formatRunLine(result) {
  const review = onlyReview(result);
  const mark = result.ok === true ? '✓' : review ? '?' : result.ok === false ? '✗' : ' ';
  const head = `${mark} ${result.verdict.padEnd(9)} ${result.name}  кадров ${result.frame}  целей ${result.goals ?? 0}`;
  const summary = result.summary ? `  ${result.summary}` : '';
  const violation = result.violation ? `\n    ${result.violation.id}: ${result.violation.message}` : '';
  const coverage = formatCoverage(result).map((line) => `\n    ${line}`).join('');
  return `${head}${summary}  [${review ? 'осмотр' : verdictClass(result.verdict)}]${violation}${coverage}\n    ${result.dir}`;
}

// coverage.json: { [проверка]: { [прогон]: { n, adapter } } } — копится между
// запусками run, чтобы частичный прогон не стирал покрытие остальных.
export function mergeCoverage(data, results, adapter) {
  const out = structuredClone(data);
  for (const result of results) {
    if (result.verdict === 'error') continue;
    for (const c of result.coverage) {
      out[c.id] ??= {};
      out[c.id][result.name] = { n: c.kind === 'invariant' ? c.steps : c.confirmed + c.pendingReview, adapter };
    }
  }
  return out;
}

// Засчитываются только записи текущего адаптера и прогонов, что ещё есть:
// старое покрытие не должно выдавать себя за нынешнее.
export function coveredRuns(data, id, adapter, runNames) {
  return Object.entries(data[id] ?? {})
    .filter(([name, e]) => runNames.includes(name) && e && e.adapter === adapter && e.n > 0)
    .map(([name]) => name);
}

export function summarizeSoak(results) {
  const byVerdict = {};
  const groups = new Map();
  for (const result of results) {
    byVerdict[result.verdict] = (byVerdict[result.verdict] ?? 0) + 1;
    if (result.verdict !== 'bug') continue;
    const oracle = result.violation?.id ?? '?';
    if (!groups.has(oracle)) groups.set(oracle, { oracle, count: 0, runs: [] });
    const group = groups.get(oracle);
    group.count++;
    group.runs.push(result.name);
  }
  return { byVerdict, bugs: [...groups.values()] };
}

export function formatSoakSummary(summary) {
  const verdicts = Object.entries(summary.byVerdict).map(([v, n]) => `${v} ${n}`).join(', ');
  const bugs = summary.bugs.map((b) => `  ${b.oracle}: ${b.count} прогон(ов), например ${b.runs[0]}`).join('\n');
  return `Итого: ${verdicts}${bugs ? `\nНаходки (по оракулу):\n${bugs}` : '\nНаходок нет.'}`;
}

export const exitCodeRun = (results) => (results.every((result) => result.ok) ? 0 : 1);

export const exitCodeSoak = (results) => (results.some((r) => r.verdict === 'bug' || r.verdict === 'error') ? 1 : 0);

export function compareTraces(expected, actual, { prefix = false } = {}) {
  const compared = prefix ? actual.slice(0, -1) : actual;
  const n = prefix ? compared.length : Math.max(expected.length, compared.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== compared[i]) {
      return { line: i + 1, expected: expected[i] ?? '(конец)', actual: compared[i] ?? '(конец)' };
    }
  }
  return null;
}

// summary — код проекта; его ошибка не должна ронять отчёт и терять
// накопленные результаты soak.
export function safeSummary(adapter, model) {
  if (!model || !adapter.summary) return '';
  try {
    return adapter.summary(model);
  } catch (error) {
    return `summary упал: ${error.message}`;
  }
}

// Что изменилось между строкой start исходного прогона и текущим окружением.
// Любое отличие делает расхождение replay ожидаемым, а не находкой.
export function startDifferences(was, now) {
  const diffs = [];
  if (was.adapter !== now.adapter) diffs.push('adapter');
  for (const key of ['plugin', 'build', 'fps', 'limits']) {
    if (JSON.stringify(was.env?.[key]) !== JSON.stringify(now.env?.[key])) diffs.push(`env.${key}`);
  }
  return diffs;
}

export function runOk(result, expect) {
  return expectMatches(result, expect) && (result.unmet ?? []).length === 0 && (result.needsReview ?? 0) === 0;
}

export function formatCoverage(result) {
  const lines = [];
  const expectations = (result.coverage ?? []).filter((c) => c.kind === 'expectation' && (c.armed > 0 || (result.requires ?? []).includes(c.id)));
  if (expectations.length > 0) {
    const cells = expectations.map((c) => {
      const ok = c.missed === 0 && (c.confirmed > 0 || c.pendingReview > 0);
      const extra = [c.level !== 'fact' ? c.level : null, c.unfinished ? `не дождался ${c.unfinished}` : null].filter(Boolean).join(', ');
      return `${c.id} ${c.confirmed}/${c.armed} ${ok ? '✓' : '✗'}${extra ? ` (${extra})` : ''}`;
    });
    lines.push(`покрытие: ${cells.join(', ')}`);
  }
  if ((result.unmet ?? []).length > 0) lines.push(`не проверено: ${result.unmet.join(', ')}`);
  for (const s of result.stale ?? []) lines.push(`эталон ${s.name} разошёлся после изменения: ${s.changed.join(', ')} — осмотреть, не баг`);
  if (result.needsReview > 0) lines.push(`новых вырезок без эталона: ${result.needsReview} → ${result.dir}/baseline-new/ (--update-baseline после осмотра)`);
  if ((result.review ?? []).length > 0) lines.push(`на осмотр агентом: ${result.review.length} → ${result.dir}/review/`);
  return lines;
}
