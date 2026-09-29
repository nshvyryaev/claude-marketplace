// Поиск и запуск установленного Chrome в headless-режиме.
//
// Порт отладки не фиксирован: Chrome выбирает свободный и записывает его в
// DevToolsActivePort внутри профиля. Это позволяет гонять несколько сценариев
// одновременно — треки не дерутся за один порт.
//
// Пути к Chrome — с прямыми слэшами: Node на Windows их принимает, а обратные
// слэши в исходнике легко теряются при передаче через слои инструментов.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.posix.join(
      (process.env.LOCALAPPDATA ?? '').replaceAll('\u005c', '/'),
      'Google/Chrome/Application/chrome.exe',
    ),
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of CANDIDATES[process.platform] ?? []) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Chrome не найден для платформы ${process.platform}. Укажите путь в переменной CHROME_PATH.`,
  );
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome пишет выбранный порт первой строкой файла, но не сразу.
async function readDevToolsPort(profile, timeoutMs = 15000) {
  const file = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(file, 'utf8')).split('\n');
      if (port && Number(port) > 0) return Number(port);
    } catch {}
    await wait(120);
  }
  throw new Error('Chrome не поднялся: DevToolsActivePort не появился');
}

export async function launchChrome({ width = 390, height = 844, scale = 2, prefix = 'verify-web-' } = {}) {
  // Профиль вне проекта: внутри него dev-сервер видит файлы и перезагружает
  // страницу прямо посреди сценария.
  const profile = await mkdtemp(path.join(os.tmpdir(), prefix));
  const proc = spawn(chromePath(), [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${scale}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    'about:blank',
  ]);

  let spawnError = null;
  proc.on('error', (error) => {
    spawnError = error;
  });

  let port;
  try {
    port = await readDevToolsPort(profile);
  } catch (error) {
    proc.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw spawnError ? new Error(`Не удалось запустить Chrome: ${spawnError.message}`) : error;
  }

  const close = async () => {
    proc.kill();
    await wait(400);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };

  return { proc, profile, port, close };
}
