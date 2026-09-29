// Прогон сценариев: один Chrome на весь набор, чистая страница на каждый.
//
// Хранилище чистится между сценариями и страница перезагружается: игра держит
// прогресс в localStorage, и без сброса второй сценарий стартовал бы из
// состояния, оставшегося от первого.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { launchChrome } from '../vendor/cdp/chrome.mjs';
import { connect } from '../vendor/cdp/cdp.mjs';
import { makeSteps, VerifyFailure } from './steps.mjs';
import { diffPng } from '../vendor/cdp/png.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Размер окна из настроек: с ним стартует каждый сценарий. */
function metricsOf(config) {
  return {
    width: config.viewport?.width ?? 390,
    height: config.viewport?.height ?? 844,
    deviceScaleFactor: config.viewport?.scale ?? 2,
    mobile: true,
  };
}

async function freshPage(cdp, config, { dark, motion }) {
  // Размер окна возвращается к настройкам: сценарий мог сменить его шагом
  // viewport(), и следующий иначе стартовал бы на чужом экране.
  await cdp.send('Emulation.setDeviceMetricsOverride', metricsOf(config));
  // Хранилище чистится на пустой странице, а не на странице игры: живое
  // приложение успевает записать своё состояние обратно между чисткой и
  // перезагрузкой, и следующий сценарий стартует с чужого экрана.
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await wait(150);
  await cdp.send('Storage.clearDataForOrigin', {
    origin: new URL(config.url).origin,
    storageTypes: 'local_storage,indexeddb,cookies,cache_storage,service_workers',
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
      // Анимации появления — вторая после шрифтов причина мигающих снимков:
      // кадр ловится посреди перехода, и диф краснеет на неподвижной вёрстке.
      // Просим приложение обойтись без движения его же средствами, а не
      // подсовываем свой CSS: то, что не умеет reduced-motion, и снимать
      // честнее в движении.
      // Сценарий, который проверяет саму анимацию, объявляет motion = true и
      // получает движение обратно. Для всех остальных оно выключено.
      { name: 'prefers-reduced-motion', value: motion ? 'no-preference' : 'reduce' },
    ],
  });
  await cdp.send('Page.navigate', { url: config.url });
  await wait(config.settleMs ?? 1500);
  cdp.clearErrors();
}

async function compareShots(scenario, shots, config, { updateBaseline, dark }) {
  const report = [];

  for (const shot of shots) {
    // Снимок-свидетельство: кадр посреди движения зависит от момента съёмки, и
    // эталон из него сделал бы проверки мигающими. Такой кадр нужен глазам.
    if (shot.baseline === false) {
      report.push({ ...shot, baseline: 'без эталона — кадр для осмотра' });
      continue;
    }

    // Тёмная тема — свой набор эталонов. С общим именем прогон с --dark
    // сравнивался бы со светлым снимком и всегда краснел, а
    // --update-baseline --dark молча затёр бы светлые эталоны тёмными.
    const suffix = dark ? '-dark' : '';
    const baselineFile = path.join(
      config.baselineDir,
      `${scenario.name}-${shot.name}${suffix}.png`,
    );
    const current = await readFile(shot.file);

    if (!existsSync(baselineFile)) {
      if (updateBaseline) {
        await mkdir(path.dirname(baselineFile), { recursive: true });
        await writeFile(baselineFile, current);
      }
      report.push({ ...shot, baseline: updateBaseline ? 'записан' : 'нет эталона' });
      continue;
    }

    if (updateBaseline) {
      await writeFile(baselineFile, current);
      report.push({ ...shot, baseline: 'обновлён' });
      continue;
    }

    const result = diffPng(await readFile(baselineFile), current, {
      threshold: config.pixelThreshold ?? 12,
    });

    if (!result.sameSize) {
      report.push({
        ...shot,
        baseline: 'размер',
        detail: `эталон ${result.baselineSize}, снимок ${result.currentSize}`,
      });
      continue;
    }

    if (result.ratio > (config.snapshotTolerance ?? 0.002)) {
      const diffFile = path.join(
        config.shotsDir,
        `${scenario.name}-${shot.name}${suffix}.diff.png`,
      );
      await writeFile(diffFile, result.image);
      report.push({
        ...shot,
        baseline: 'разошёлся',
        ratio: result.ratio,
        diffFile,
        baselineFile,
      });
      continue;
    }

    report.push({ ...shot, baseline: 'совпал', ratio: result.ratio });
  }

  return report;
}

export async function runScenarios(scenarios, config, options = {}) {
  const { dark = false, updateBaseline = false, log = () => {} } = options;

  const chrome = await launchChrome(config.viewport);
  const cdp = await connect(chrome.port);
  await cdp.send('Emulation.setDeviceMetricsOverride', metricsOf(config));

  const results = [];

  try {
    for (const scenario of scenarios) {
      log(`${scenario.name} — ${scenario.title ?? ''}`);
      const startedAt = Date.now();
      const { steps, shots } = makeSteps(cdp, {
        shotsDir: config.shotsDir,
        clickable: config.clickable,
        defaultTimeout: config.timeout ?? 5000,
        baseUrl: config.url,
        settleMs: config.settleMs ?? 1500,
        scale: config.viewport?.scale ?? 2,
        log,
      });

      let failure = null;
      try {
        await freshPage(cdp, config, { dark, motion: scenario.motion === true });
        await scenario.run(steps);
      } catch (error) {
        failure =
          error instanceof VerifyFailure ? error.message : `${error.name}: ${error.message}`;
      }

      // Ошибки страницы читаются после сценария: асинхронная ошибка может
      // прилететь позже шага, который её вызвал.
      await wait(200);
      const pageErrors = scenario.allowErrors ? [] : [...cdp.errors];
      if (!failure && pageErrors.length > 0) {
        failure = `ошибки на странице: ${pageErrors.map((e) => e.text).join(' | ')}`;
      }

      const shotReport = await compareShots(scenario, shots, config, { updateBaseline, dark });
      const snapshotBroken = shotReport.filter((s) =>
        ['разошёлся', 'размер'].includes(s.baseline),
      );
      if (!failure && snapshotBroken.length > 0) {
        failure = `снимок разошёлся с эталоном: ${snapshotBroken.map((s) => s.name).join(', ')}`;
      }

      results.push({
        name: scenario.name,
        zone: scenario.zone,
        title: scenario.title ?? '',
        ok: !failure,
        failure,
        pageErrors,
        shots: shotReport,
        durationMs: Date.now() - startedAt,
      });
    }
  } finally {
    cdp.close();
    await chrome.close();
  }

  return results;
}
