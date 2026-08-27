import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOK = path.join(import.meta.dirname, '..', 'hooks', 'acceptance-freeze.mjs');

function project() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'acceptance-hook-'));
  mkdirSync(path.join(root, 'docs', 'acceptance'), { recursive: true });
  mkdirSync(path.join(root, 'docs', 'acceptance-other'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'move.ts'), 'export const x = 1;');
  return root;
}

function criteria(root, name, status) {
  const file = path.join(root, 'docs', 'acceptance', `${name}.md`);
  writeFileSync(
    file,
    [
      '---',
      `slug: ${name}`,
      'kind: feature',
      `status: ${status}`,
      'title: "Проба"',
      '---',
      '- [scenario] Что-то происходит и это видно на экране',
      '',
    ].join('\n'),
  );
  return file;
}

function ask(root, toolName, filePath) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `хук упал: ${result.stderr}`);
  return JSON.parse(result.stdout || '{}');
}

const decision = (out) => out.hookSpecificOutput?.permissionDecision ?? null;

test('чужой инструмент хука не касается', () => {
  const root = project();
  criteria(root, 'a', 'frozen');
  assert.equal(decision(ask(root, 'Bash', path.join(root, 'docs/acceptance/a.md'))), null);
});

test('файл вне каталога приёмки не трогается', () => {
  const root = project();
  assert.equal(decision(ask(root, 'Edit', path.join(root, 'src/move.ts'))), null);
});

test('каталог с похожим именем не считается каталогом приёмки', () => {
  const root = project();
  const file = path.join(root, 'docs', 'acceptance-other', 'note.md');
  writeFileSync(file, '---\nstatus: frozen\n---\n');
  assert.equal(decision(ask(root, 'Write', file)), null);
});

test('выход из каталога через .. не обходит проверку и не ловит чужое', () => {
  const root = project();
  const escaped = path.join(root, 'docs', 'acceptance', '..', '..', 'src', 'move.ts');
  assert.equal(decision(ask(root, 'Edit', escaped)), null);
});

test('новый файл создать можно — это новый черновик', () => {
  const root = project();
  assert.equal(decision(ask(root, 'Write', path.join(root, 'docs/acceptance/new.md'))), null);
});

test('черновик правится свободно', () => {
  const root = project();
  assert.equal(decision(ask(root, 'Edit', criteria(root, 'draft-one', 'draft'))), null);
});

for (const status of ['approved', 'frozen', 'verified']) {
  test(`статус «${status}» запрещает правку`, () => {
    const root = project();
    const out = ask(root, 'Edit', criteria(root, `x-${status}`, status));
    assert.equal(decision(out), 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, new RegExp(status));
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /unfreeze/);
  });
}

test('битый файл с запертым статусом всё равно запирается', () => {
  const root = project();
  const file = path.join(root, 'docs', 'acceptance', 'broken.md');
  writeFileSync(file, 'без шапки\nstatus: frozen\nчто-то ещё');
  assert.equal(decision(ask(root, 'Edit', file)), 'deny');
});

test('битый файл-черновик не запирается', () => {
  const root = project();
  const file = path.join(root, 'docs', 'acceptance', 'broken-draft.md');
  writeFileSync(file, 'без шапки\nstatus: draft\n');
  assert.equal(decision(ask(root, 'Edit', file)), null);
});

test('битый файл без статуса вовсе не запирается', () => {
  const root = project();
  const file = path.join(root, 'docs', 'acceptance', 'nostatus.md');
  writeFileSync(file, 'просто заметка');
  assert.equal(decision(ask(root, 'Edit', file)), null);
});

test('относительный путь считается от корня проекта', () => {
  const root = project();
  criteria(root, 'rel', 'frozen');
  assert.equal(decision(ask(root, 'Edit', 'docs/acceptance/rel.md')), 'deny');
});
