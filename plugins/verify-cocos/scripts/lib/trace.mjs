// Журнал решений бота: одна запись на событие, JSONL.
//
// В записях нет времени стенных часов — только кадры. Иначе replay не смог бы
// сравнить журналы построчно.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export function createTrace() {
  const entries = [];
  return { entries, write: (entry) => entries.push(entry) };
}

export async function saveTrace(dir, trace, tail = 200) {
  await mkdir(dir, { recursive: true });
  const lines = trace.entries.map((entry) => JSON.stringify(entry));
  await writeFile(path.join(dir, 'trace.jsonl'), `${lines.join('\n')}\n`);
  await writeFile(path.join(dir, 'tail.jsonl'), `${lines.slice(-tail).join('\n')}\n`);
}

export async function readTraceLines(file) {
  return (await readFile(file, 'utf8')).split('\n').map((line) => line.trim()).filter(Boolean);
}
