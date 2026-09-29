// Файл критериев приёмки: разбор, изменение статуса, правила участия.
//
// Формат намеренно текстовый и версионируемый: критерий должен быть виден в
// диффе рядом с кодом, который его выполняет.

export const STATUSES = ['draft', 'approved', 'frozen', 'verified'];
export const KINDS = ['feature', 'ui', 'bug', 'chore', 'data'];
export const HOWS = ['scenario', 'snapshot', 'visual', 'check'];

// Кто пишет критерии — всегда агент. Разница в том, ждём ли подтверждения.
const NEEDS_APPROVAL = { feature: true, ui: true, bug: false, chore: false, data: false };

/** Требует ли этот тип работы подтверждения инженера до начала реализации. */
export function needsApproval(kind) {
  if (!(kind in NEEDS_APPROVAL)) throw new Error(`Неизвестный тип работы: ${kind}`);
  return NEEDS_APPROVAL[kind];
}

/** Статусы, при которых файл критериев неизменяем. */
export function isLocked(status) {
  return status !== 'draft';
}

const FENCE = '---';

function parseFrontmatter(lines) {
  const data = {};
  for (const line of lines) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return data;
}

function formatFrontmatter(data) {
  return Object.entries(data).map(([key, value]) => {
    const needsQuotes = String(value).includes(':') || String(value).includes('#');
    return `${key}: ${needsQuotes ? JSON.stringify(String(value)) : value}`;
  });
}

/**
 * Разбирает файл критериев в { meta, criteria, body }.
 * Критерий — строка вида `- [scenario] текст`, продолжения с отступом
 * приклеиваются к предыдущему.
 */
export function parseCriteria(text) {
  const lines = text.split('\n');

  if (lines[0]?.trim() !== FENCE) {
    throw new Error('Файл критериев должен начинаться с блока --- ... ---');
  }
  const closing = lines.indexOf(FENCE, 1);
  if (closing === -1) throw new Error('Незакрытый блок --- в начале файла критериев');

  const meta = parseFrontmatter(lines.slice(1, closing));
  const body = lines.slice(closing + 1);

  const criteria = [];
  for (let index = 0; index < body.length; index++) {
    const line = body[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('- [')) {
      const close = trimmed.indexOf(']');
      if (close === -1) continue;
      const how = trimmed.slice(3, close).trim();
      criteria.push({
        how,
        text: trimmed.slice(close + 1).trim(),
        line: closing + 1 + index,
        known: HOWS.includes(how),
      });
      continue;
    }

    // Продолжение критерия: непустая строка с отступом сразу после него.
    if (criteria.length > 0 && line.startsWith('  ') && trimmed.length > 0) {
      const previous = criteria[criteria.length - 1];
      if (previous.line === closing + index) {
        previous.text = `${previous.text} ${trimmed}`;
        previous.line = closing + 1 + index;
      }
    }
  }

  return { meta, criteria, body: body.join('\n') };
}

/** Возвращает текст файла с изменённой шапкой. Тело не трогается. */
export function withMeta(text, changes) {
  const lines = text.split('\n');
  const closing = lines.indexOf(FENCE, 1);
  const meta = { ...parseFrontmatter(lines.slice(1, closing)), ...changes };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete meta[key];
  }
  return [FENCE, ...formatFrontmatter(meta), FENCE, ...lines.slice(closing + 1)].join('\n');
}

/** Проверяет файл на смысловые дыры до того, как его увидит инженер. */
export function lintCriteria(parsed) {
  const problems = [];
  const { meta, criteria } = parsed;

  if (!STATUSES.includes(meta.status)) problems.push(`неизвестный статус: ${meta.status}`);
  if (!KINDS.includes(meta.kind)) problems.push(`неизвестный тип работы: ${meta.kind}`);
  if (!meta.title) problems.push('нет заголовка (title)');
  if (criteria.length === 0) problems.push('нет ни одного критерия');

  for (const criterion of criteria) {
    if (!criterion.known) problems.push(`неизвестный способ проверки: [${criterion.how}]`);
    if (criterion.text.length < 10) problems.push(`слишком короткий критерий: «${criterion.text}»`);
  }

  if (meta.kind === 'bug' && !criteria.some((c) => c.text.toLowerCase().includes('воспроизв'))) {
    problems.push('для бага обязателен критерий с воспроизведением');
  }

  if (meta.kind === 'chore' && !criteria.some((c) => c.how === 'snapshot' || c.how === 'check')) {
    problems.push('для техдолга нужен критерий, доказывающий неизменность поведения');
  }

  return problems;
}

export function template({ slug, kind, title }) {
  return [
    FENCE,
    `slug: ${slug}`,
    `kind: ${kind}`,
    'status: draft',
    `title: ${JSON.stringify(title)}`,
    FENCE,
    '',
    `# ${title}`,
    '',
    '## Критерии',
    '',
    '- [scenario] ',
    '- [visual] ',
    '- [check] ',
    '',
    '## Заметки',
    '',
    '',
  ].join('\n');
}
