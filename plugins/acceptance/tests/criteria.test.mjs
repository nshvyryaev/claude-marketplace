import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCriteria,
  withMeta,
  lintCriteria,
  needsApproval,
  isLocked,
  template,
} from '../scripts/lib/criteria.mjs';

const sample = [
  '---',
  'slug: move-reject',
  'kind: feature',
  'status: draft',
  'title: "Отказ хода: объяснение"',
  '---',
  '',
  '## Критерии',
  '',
  '- [scenario] Игрок вводит слово с двумя изменёнными буквами — ход отклонён,',
  '  показана причина, введённые буквы остаются на месте',
  '- [visual] Экран отказа не использует красный цвет',
  '- [check] npm run typecheck выходит с нулём',
  '',
].join('\n');

test('шапка разбирается, кавычки снимаются', () => {
  const { meta } = parseCriteria(sample);
  assert.equal(meta.slug, 'move-reject');
  assert.equal(meta.kind, 'feature');
  assert.equal(meta.status, 'draft');
  assert.equal(meta.title, 'Отказ хода: объяснение');
});

test('критерии разбираются вместе со способом проверки', () => {
  const { criteria } = parseCriteria(sample);
  assert.equal(criteria.length, 3);
  assert.deepEqual(criteria.map((c) => c.how), ['scenario', 'visual', 'check']);
  assert.ok(criteria.every((c) => c.known));
});

test('продолжение с отступом приклеивается к своему критерию', () => {
  const { criteria } = parseCriteria(sample);
  assert.match(criteria[0].text, /остаются на месте$/);
  assert.match(criteria[0].text, /^Игрок вводит/);
});

test('файл без шапки — ошибка, а не тихий разбор', () => {
  assert.throws(() => parseCriteria('# Заголовок'), /должен начинаться/);
  assert.throws(() => parseCriteria('---\nkind: bug\n'), /Незакрытый блок/);
});

test('withMeta меняет шапку и не трогает тело', () => {
  const updated = withMeta(sample, { status: 'approved', approved_by: 'telegram' });
  const parsed = parseCriteria(updated);
  assert.equal(parsed.meta.status, 'approved');
  assert.equal(parsed.meta.approved_by, 'telegram');
  assert.equal(parsed.criteria.length, 3);
  assert.equal(parsed.meta.title, 'Отказ хода: объяснение');
});

test('withMeta с null удаляет ключ', () => {
  const once = withMeta(sample, { approved_by: 'telegram' });
  const twice = withMeta(once, { approved_by: null });
  assert.equal(parseCriteria(twice).meta.approved_by, undefined);
});

test('участие инженера зависит от типа работы', () => {
  assert.equal(needsApproval('feature'), true);
  assert.equal(needsApproval('ui'), true);
  assert.equal(needsApproval('bug'), false);
  assert.equal(needsApproval('chore'), false);
  assert.equal(needsApproval('data'), false);
  assert.throws(() => needsApproval('нечто'), /Неизвестный тип/);
});

test('заперт любой статус кроме черновика', () => {
  assert.equal(isLocked('draft'), false);
  assert.equal(isLocked('approved'), true);
  assert.equal(isLocked('frozen'), true);
  assert.equal(isLocked('verified'), true);
});

test('чистый файл проходит проверку', () => {
  assert.deepEqual(lintCriteria(parseCriteria(sample)), []);
});

test('пустой шаблон не выдаётся за готовые критерии', () => {
  const problems = lintCriteria(parseCriteria(template({ slug: 'x', kind: 'feature', title: 'Ц' })));
  assert.ok(problems.some((p) => p.includes('слишком короткий')));
});

test('баг без воспроизведения не принимается', () => {
  const bug = sample.replace('kind: feature', 'kind: bug');
  assert.ok(lintCriteria(parseCriteria(bug)).some((p) => p.includes('воспроизвед')));
});

test('техдолг без доказательства неизменности не принимается', () => {
  const chore = [
    '---',
    'slug: r',
    'kind: chore',
    'status: draft',
    'title: "Разделить редьюсер"',
    '---',
    '- [visual] Внешне ничего не поменялось на всех трёх экранах',
  ].join('\n');
  assert.ok(lintCriteria(parseCriteria(chore)).some((p) => p.includes('неизменность')));
});

test('неизвестный способ проверки называется прямо', () => {
  const odd = sample.replace('- [visual]', '- [магия]');
  assert.ok(lintCriteria(parseCriteria(odd)).some((p) => p.includes('магия')));
});
