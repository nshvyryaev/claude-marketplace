#!/usr/bin/env node
// Жизненный цикл критериев приёмки.
//
//   acceptance new <slug> --kind feature --title "..."
//   acceptance list
//   acceptance show <slug>
//   acceptance lint <slug>
//   acceptance approve <slug> --evidence "ответ инженера дословно"
//   acceptance freeze <slug>
//   acceptance unfreeze <slug> --reason "почему критерий меняется"
//   acceptance verified <slug> --evidence "чем доказано"
//
// draft → approved → frozen → verified. Назад — только через unfreeze, и он
// пишет причину в журнал.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseCriteria,
  withMeta,
  lintCriteria,
  needsApproval,
  template,
  KINDS,
} from './lib/criteria.mjs';

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DIR = path.resolve(PROJECT_ROOT, 'docs', 'acceptance');
const JOURNAL = path.join(DIR, '.journal.jsonl');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      values[argv[i].slice(2)] = argv[i + 1] ?? '';
      i++;
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, values };
}

const fileFor = (slug) => path.join(DIR, `${slug}.md`);

function readFileOrFail(slug) {
  const file = fileFor(slug);
  if (!fs.existsSync(file)) fail(`Нет критериев с именем «${slug}». Посмотрите: acceptance list`);
  const text = fs.readFileSync(file, 'utf8');
  try {
    return { file, text, parsed: parseCriteria(text) };
  } catch (error) {
    return fail(`Файл ${slug}.md не разбирается: ${error.message}`);
  }
}

function journal(entry) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(JOURNAL, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function write(file, text) {
  fs.writeFileSync(file, text);
}

function transition(slug, { from, to, changes = {}, entry = {} }) {
  const { file, text, parsed } = readFileOrFail(slug);
  const status = parsed.meta.status;
  if (!from.includes(status)) {
    fail(`«${slug}» в статусе «${status}»; переход в «${to}» возможен из: ${from.join(', ')}`);
  }
  write(file, withMeta(text, { status: to, ...changes }));
  journal({ slug, from: status, to, ...entry });
  console.log(`«${slug}»: ${status} → ${to}`);
}

const { positional, values } = parseArgs(process.argv.slice(2));
const [command, slug] = positional;

if (command === 'new') {
  if (!slug) fail('Нужно имя: acceptance new <slug> --kind <тип> --title "..."');
  const kind = values.kind;
  if (!KINDS.includes(kind)) fail(`--kind обязателен, из: ${KINDS.join(', ')}`);
  const title = values.title;
  if (!title) fail('--title обязателен');

  fs.mkdirSync(DIR, { recursive: true });
  const file = fileFor(slug);
  if (fs.existsSync(file)) fail(`«${slug}» уже есть: ${path.relative(PROJECT_ROOT, file)}`);
  write(file, template({ slug, kind, title }));
  journal({ slug, from: null, to: 'draft', kind });

  console.log(`Создан черновик ${path.relative(PROJECT_ROOT, file)}`);
  console.log(
    needsApproval(kind)
      ? 'Тип работы требует подтверждения инженера: заполните критерии, покажите их и дождитесь ответа.'
      : 'Тип работы не требует подтверждения: заполните критерии и замораживайте.',
  );
} else if (command === 'list') {
  if (!fs.existsSync(DIR)) fail(`Нет каталога ${path.relative(PROJECT_ROOT, DIR)}`);
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) console.log('Пусто.');
  for (const name of files) {
    const text = fs.readFileSync(path.join(DIR, name), 'utf8');
    try {
      const { meta, criteria } = parseCriteria(text);
      const gate = needsApproval(meta.kind) ? 'ждёт «да»' : 'без «да»';
      console.log(
        `${meta.status.padEnd(9)} ${String(meta.kind).padEnd(8)} ${gate.padEnd(10)} ` +
          `${String(criteria.length).padStart(2)} крит.  ${name.replace(/[.]md$/, '')}  ${meta.title ?? ''}`,
      );
    } catch (error) {
      console.log(`битый     ?        ?           ?        ${name}  (${error.message})`);
    }
  }
} else if (command === 'show' || command === 'lint') {
  if (!slug) fail(`Нужно имя: acceptance ${command} <slug>`);
  const { parsed } = readFileOrFail(slug);
  const problems = lintCriteria(parsed);

  if (command === 'show') {
    console.log(`${parsed.meta.title ?? slug}`);
    console.log(
      `статус: ${parsed.meta.status} · тип: ${parsed.meta.kind} · ` +
        `подтверждение: ${needsApproval(parsed.meta.kind) ? 'требуется' : 'не требуется'}`,
    );
    if (parsed.meta.approved_evidence) {
      console.log(`подтверждено: ${parsed.meta.approved_at} — ${parsed.meta.approved_evidence}`);
    }
    console.log('');
    for (const criterion of parsed.criteria) console.log(`  [${criterion.how}] ${criterion.text}`);
    console.log('');
  }

  if (problems.length === 0) {
    console.log('Проверка формы пройдена.');
  } else {
    console.log('Проблемы:');
    for (const problem of problems) console.log(`  · ${problem}`);
    process.exit(1);
  }
} else if (command === 'approve') {
  if (!slug) fail('Нужно имя: acceptance approve <slug> --evidence "..."');
  const evidence = values.evidence;
  if (!evidence) {
    fail(
      'Нужен --evidence: дословный ответ инженера, которым он подтвердил критерии.\n' +
        'Подтверждение без следа не отличить от подтверждения, которого не было.',
    );
  }
  const { parsed } = readFileOrFail(slug);
  const problems = lintCriteria(parsed);
  if (problems.length > 0) {
    fail(`Нельзя подтверждать файл с проблемами формы:\n  · ${problems.join('\n  · ')}`);
  }
  transition(slug, {
    from: ['draft'],
    to: 'approved',
    changes: { approved_at: new Date().toISOString(), approved_evidence: evidence },
    entry: { evidence },
  });
} else if (command === 'freeze') {
  if (!slug) fail('Нужно имя: acceptance freeze <slug>');
  const { parsed } = readFileOrFail(slug);
  const gated = needsApproval(parsed.meta.kind);
  const problems = lintCriteria(parsed);
  if (problems.length > 0) {
    fail(`Нельзя замораживать файл с проблемами формы:\n  · ${problems.join('\n  · ')}`);
  }
  if (gated && parsed.meta.status !== 'approved') {
    fail(
      `Тип работы «${parsed.meta.kind}» требует подтверждения инженера. ` +
        `Сначала acceptance approve ${slug} --evidence "..."`,
    );
  }
  transition(slug, { from: gated ? ['approved'] : ['draft', 'approved'], to: 'frozen' });
} else if (command === 'unfreeze') {
  if (!slug) fail('Нужно имя: acceptance unfreeze <slug> --reason "..."');
  const reason = values.reason;
  if (!reason) fail('Нужен --reason: почему критерий меняется после фиксации.');
  transition(slug, {
    from: ['approved', 'frozen', 'verified'],
    to: 'draft',
    changes: { approved_at: null, approved_evidence: null, unfrozen_reason: reason },
    entry: { reason },
  });
  console.log('Файл вернулся в черновик — работу придётся подтверждать заново.');
} else if (command === 'verified') {
  if (!slug) fail('Нужно имя: acceptance verified <slug> --evidence "..."');
  const evidence = values.evidence;
  if (!evidence) fail('Нужен --evidence: чем именно доказано выполнение критериев.');
  transition(slug, {
    from: ['frozen'],
    to: 'verified',
    changes: { verified_at: new Date().toISOString(), verified_evidence: evidence },
    entry: { evidence },
  });
} else {
  console.log(
    [
      'acceptance new <slug> --kind <feature|ui|bug|chore|data> --title "..."',
      'acceptance list',
      'acceptance show <slug>',
      'acceptance lint <slug>',
      'acceptance approve <slug> --evidence "ответ инженера дословно"',
      'acceptance freeze <slug>',
      'acceptance unfreeze <slug> --reason "почему критерий меняется"',
      'acceptance verified <slug> --evidence "чем доказано"',
    ].join('\n'),
  );
  process.exit(command ? 1 : 0);
}
