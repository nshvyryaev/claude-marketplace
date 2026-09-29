#!/usr/bin/env node
// Раскладывает общий код из shared/cdp по vendor/ плагинов-потребителей.
//
// Источник один — shared/cdp. Копии правятся только этим скриптом; тест
// tests/shared-sync.test.mjs падает, если копия разошлась с источником.
// Импорт между плагинами невозможен: скрипт плагина знает только свой
// CLAUDE_PLUGIN_ROOT, путь к соседнему плагину в кэше меняется с версией.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = path.join(ROOT, 'shared', 'cdp');
export const CONSUMERS = ['verify-web', 'verify-cocos'];

export const vendorDir = (plugin) => path.join(ROOT, 'plugins', plugin, 'scripts', 'vendor', 'cdp');

export async function sourceFiles() {
  return (await readdir(SOURCE)).filter((file) => file.endsWith('.mjs')).sort();
}

async function sync() {
  const files = await sourceFiles();
  for (const plugin of CONSUMERS) {
    if (!existsSync(path.join(ROOT, 'plugins', plugin))) continue;
    const dir = vendorDir(plugin);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      await writeFile(path.join(dir, file), await readFile(path.join(SOURCE, file)));
    }
    console.log(`${plugin}: ${files.length} файлов → ${path.relative(ROOT, dir)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await sync();
}
