import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCriteria } from '../scripts/lib/criteria.mjs';

const CLI = path.join(import.meta.dirname, '..', 'scripts', 'acceptance.mjs');

function project() {
  return mkdtempSync(path.join(os.tmpdir(), 'acceptance-cli-'));
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const fileOf = (root, slug) => path.join(root, 'docs', 'acceptance', `${slug}.md`);
const metaOf = (root, slug) => parseCriteria(readFileSync(fileOf(root, slug), 'utf8')).meta;

function fill(root, slug, lines) {
  const text = readFileSync(fileOf(root, slug), 'utf8');
  const head = text.slice(0, text.indexOf('## Критерии') + '## Критерии'.length);
  writeFileSync(fileOf(root, slug), `${head}\n\n${lines.join('\n')}\n`);
}

const GOOD = [
  '- [scenario] Игрок вводит слово с двумя изменёнными буквами — ход отклонён с причиной',
  '- [visual] Экран отказа не использует красный цвет и не сдвигает раскладку',
  '- [check] npm run typecheck выходит с нулём',
];

test('новый файл рождается черновиком и попадает в журнал', () => {
  const root = project();
  const created = run(root, 'new', 'move-reject', '--kind', 'feature', '--title', 'Отказ хода');
  assert.equal(created.code, 0);
  assert.match(created.out, /требует подтверждения/);
  assert.equal(metaOf(root, 'move-reject').status, 'draft');
  assert.ok(existsSync(path.join(root, 'docs', 'acceptance', '.journal.jsonl')));
});

test('тип работы обязателен и проверяется по списку', () => {
  const root = project();
  assert.equal(run(root, 'new', 'x', '--kind', 'магия', '--title', 'Ц').code, 1);
  assert.equal(run(root, 'new', 'x', '--title', 'Ц').code, 1);
});

test('повторное создание не затирает существующий файл', () => {
  const root = project();
  run(root, 'new', 'x', '--kind', 'bug', '--title', 'Ц');
  const second = run(root, 'new', 'x', '--kind', 'bug', '--title', 'Другое');
  assert.equal(second.code, 1);
  assert.match(second.err, /уже есть/);
});

test('фича не замораживается без подтверждения инженера', () => {
  const root = project();
  run(root, 'new', 'f', '--kind', 'feature', '--title', 'Ц');
  fill(root, 'f', GOOD);
  const frozen = run(root, 'freeze', 'f');
  assert.equal(frozen.code, 1);
  assert.match(frozen.err, /требует подтверждения/);
});

test('подтверждение без следа не принимается', () => {
  const root = project();
  run(root, 'new', 'f', '--kind', 'feature', '--title', 'Ц');
  fill(root, 'f', GOOD);
  const approved = run(root, 'approve', 'f');
  assert.equal(approved.code, 1);
  assert.match(approved.err, /--evidence/);
});

test('пустой шаблон нельзя ни подтвердить, ни заморозить', () => {
  const root = project();
  run(root, 'new', 'f', '--kind', 'feature', '--title', 'Ц');
  assert.equal(run(root, 'approve', 'f', '--evidence', 'ок').code, 1);
  assert.equal(run(root, 'freeze', 'f').code, 1);
});

test('полный путь фичи: draft → approved → frozen → verified', () => {
  const root = project();
  run(root, 'new', 'f', '--kind', 'feature', '--title', 'Ц');
  fill(root, 'f', GOOD);

  assert.equal(run(root, 'approve', 'f', '--evidence', 'да, годится').code, 0);
  const approved = metaOf(root, 'f');
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved_evidence, 'да, годится');
  assert.ok(approved.approved_at);

  assert.equal(run(root, 'freeze', 'f').code, 0);
  assert.equal(metaOf(root, 'f').status, 'frozen');

  assert.equal(run(root, 'verified', 'f', '--evidence', '3 из 3, снимки осмотрены').code, 0);
  assert.equal(metaOf(root, 'f').status, 'verified');
});

test('баг замораживается без подтверждения, но требует воспроизведения', () => {
  const root = project();
  run(root, 'new', 'b', '--kind', 'bug', '--title', 'Ц');
  fill(root, 'b', ['- [scenario] Сообщение об отказе называет верное число букв']);
  assert.equal(run(root, 'freeze', 'b').code, 1, 'без воспроизведения замораживать нельзя');

  fill(root, 'b', [
    '- [scenario] Воспроизведение: ход АКТ → ЪЪЪ, сообщение называет три буквы',
    '- [check] npm run typecheck выходит с нулём',
  ]);
  assert.equal(run(root, 'freeze', 'b').code, 0);
  assert.equal(metaOf(root, 'b').status, 'frozen');
});

test('разморозка возвращает в черновик, стирает подтверждение и пишет причину', () => {
  const root = project();
  run(root, 'new', 'f', '--kind', 'feature', '--title', 'Ц');
  fill(root, 'f', GOOD);
  run(root, 'approve', 'f', '--evidence', 'да');
  run(root, 'freeze', 'f');

  assert.equal(run(root, 'unfreeze', 'f').code, 1, 'без причины размораживать нельзя');

  const unfrozen = run(root, 'unfreeze', 'f', '--reason', 'критерий оказался неоднозначным');
  assert.equal(unfrozen.code, 0);
  const meta = metaOf(root, 'f');
  assert.equal(meta.status, 'draft');
  assert.equal(meta.approved_evidence, undefined);
  assert.equal(meta.unfrozen_reason, 'критерий оказался неоднозначным');

  const journal = readFileSync(path.join(root, 'docs', 'acceptance', '.journal.jsonl'), 'utf8');
  assert.match(journal, /неоднозначным/);
});

test('переход из неподходящего статуса называет допустимые', () => {
  const root = project();
  run(root, 'new', 'f', '--kind', 'feature', '--title', 'Ц');
  fill(root, 'f', GOOD);
  const verified = run(root, 'verified', 'f', '--evidence', 'ок');
  assert.equal(verified.code, 1);
  assert.match(verified.err, /frozen/);
});

test('list показывает статус, тип и нужно ли подтверждение', () => {
  const root = project();
  run(root, 'new', 'f', '--kind', 'feature', '--title', 'Фича');
  run(root, 'new', 'c', '--kind', 'chore', '--title', 'Долг');
  const list = run(root, 'list');
  assert.equal(list.code, 0);
  assert.match(list.out, /ждёт «да»/);
  assert.match(list.out, /без «да»/);
});
