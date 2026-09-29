// Отчёт о прогоне. Два адресата: человек в терминале и агент, который дальше
// смотрит на снимки. Поэтому пути к снимкам выводятся всегда, а не только при
// провале — визуальный слой начинается там, где заканчивается машинный.

const line = (n = 60) => '─'.repeat(n);

export function formatReport(results, { selectionReason, dark } = {}) {
  const out = [];
  const failed = results.filter((r) => !r.ok);

  out.push(line());
  if (selectionReason) out.push(`Отбор сценариев: ${selectionReason}`);
  if (dark) out.push('Тема: тёмная');
  out.push('');

  for (const result of results) {
    const mark = result.ok ? '✔' : '✖';
    const seconds = (result.durationMs / 1000).toFixed(1);
    out.push(`${mark} ${result.name} · ${result.zone} · ${seconds}s`);
    if (result.title) out.push(`   ${result.title}`);
    if (result.failure) out.push(`   ПРИЧИНА: ${result.failure}`);

    for (const shot of result.shots) {
      const detail = [
        shot.baseline,
        shot.ratio !== undefined ? `${(shot.ratio * 100).toFixed(2)}%` : null,
        shot.detail,
      ]
        .filter(Boolean)
        .join(', ');
      out.push(`   снимок ${shot.name}: ${detail}`);
      out.push(`     ${shot.file}`);
      if (shot.diffFile) out.push(`     диф: ${shot.diffFile}`);
      if (shot.baselineFile) out.push(`     эталон: ${shot.baselineFile}`);
    }
    out.push('');
  }

  out.push(line());
  out.push(
    failed.length === 0
      ? `Машинный слой пройден: ${results.length} из ${results.length}.`
      : `Провалено ${failed.length} из ${results.length}: ${failed.map((r) => r.name).join(', ')}`,
  );

  const shots = results.flatMap((r) => r.shots.map((s) => s.file));
  if (shots.length > 0) {
    out.push('');
    out.push('Визуальный слой: снимки выше требуют осмотра по критериям приёмки.');
    out.push('Машина проверила только то, что не изменилось; что получилось — она не судит.');
  }

  return out.join('\n');
}

export function exitCode(results) {
  return results.some((r) => !r.ok) ? 1 : 0;
}
