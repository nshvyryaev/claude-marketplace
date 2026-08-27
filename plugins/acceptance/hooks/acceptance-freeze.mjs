#!/usr/bin/env node
// PreToolUse: делает файл критериев неизменяемым, пока он не черновик.
//
// Зачем это хук, а не правило в промпте
// -------------------------------------
// Самый дорогой отказ контура приёмки — агент, подогнавший критерий под то,
// что получилось. Обещание «не буду» этого не ловит: правка выглядит как
// обычное уточнение формулировки и проходит незамеченной в общем диффе.
//
// Поэтому: черновик правится свободно, всё остальное — только через явную
// разморозку, которая возвращает статус в draft и пишет причину в журнал.
// Разморозка видна в git и требует нового подтверждения.
//
// Хук никогда не валит работу из-за собственной поломки: любая неожиданность
// означает «нет мнения». Единственное исключение — файл, который не удалось
// разобрать, но в котором виден запертый статус: тут молчать опаснее.
import fs from 'node:fs';
import path from 'node:path';
import { parseCriteria, isLocked } from '../scripts/lib/criteria.mjs';

const WRITING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ACCEPTANCE_DIR = path.resolve(PROJECT_ROOT, 'docs', 'acceptance');

function neutral() {
  process.stdout.write('{}');
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function insideAcceptanceDir(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  return resolved === ACCEPTANCE_DIR || resolved.startsWith(ACCEPTANCE_DIR + path.sep);
}

/** Запертый статус, вытащенный из битого файла: разбор мог упасть, а замок — нет. */
function statusFromRawText(text) {
  for (const line of text.split('\n').slice(0, 20)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('status:')) return trimmed.slice('status:'.length).trim();
  }
  return null;
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw || '{}');
} catch {
  neutral();
}

if (!WRITING_TOOLS.includes(input?.tool_name)) neutral();

const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (typeof filePath !== 'string' || !insideAcceptanceDir(filePath)) neutral();

const resolved = path.resolve(PROJECT_ROOT, filePath);

// Новый файл — это новый черновик. Запрещать создание нечего.
if (!fs.existsSync(resolved)) neutral();

let text;
try {
  text = fs.readFileSync(resolved, 'utf8');
} catch {
  neutral();
}

const relative = path.relative(PROJECT_ROOT, resolved);
const slug = path.basename(resolved).replace(/[.]md$/, '');

let status;
try {
  status = parseCriteria(text).meta.status;
} catch {
  status = statusFromRawText(text);
  if (status === null || !isLocked(status)) neutral();
}

if (!isLocked(status)) neutral();

deny(
  `Файл критериев ${relative} в статусе «${status}» и правке не подлежит.\n\n` +
    `Критерии приёмки фиксируются до реализации именно затем, чтобы их нельзя было ` +
    `подогнать под полученный результат. Если критерий действительно требует изменения — ` +
    `это отдельное решение, а не правка по ходу дела.\n\n` +
    `Разморозить с записью причины:\n` +
    `  node <plugin>/scripts/acceptance.mjs unfreeze ${slug} --reason "почему критерий меняется"\n\n` +
    `Разморозка возвращает файл в draft, и работу придётся подтверждать заново.`,
);
