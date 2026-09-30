// Пиксельные эталоны вырезок: verify/baseline/<прогон>/<проверка>-<n>.png.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { diffPng } from '../vendor/cdp/png.mjs';

// meta.json рядом с эталонами: с каким адаптером и сборкой они сняты. Проверки
// меняют траекторию бота (шаг урезается до сроков), поэтому после правки
// адаптера расхождение — повод осмотреть, а не баг игры.
const META = 'meta.json';

async function readMeta(dir) {
  const file = path.join(dir, META);
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
}

export async function compareShot({ png, name, baselineDir, newDir, update, threshold, tolerance, meta = null }) {
  const file = path.join(baselineDir, `${name}.png`);
  if (update) {
    await mkdir(baselineDir, { recursive: true });
    await writeFile(file, png);
    if (meta) await writeFile(path.join(baselineDir, META), JSON.stringify(meta, null, 2));
    return { outcome: 'updated' };
  }
  if (!existsSync(file)) {
    await mkdir(newDir, { recursive: true });
    await writeFile(path.join(newDir, `${name}.png`), png);
    return { outcome: 'new' };
  }
  const result = diffPng(await readFile(file), png, { threshold });
  if (result.sameSize && result.ratio <= tolerance) return { outcome: 'match' };
  await mkdir(newDir, { recursive: true });
  await writeFile(path.join(newDir, `${name}.png`), png);
  if (result.image) await writeFile(path.join(newDir, `${name}.diff.png`), result.image);
  const ratio = result.sameSize ? result.ratio : 1;
  const was = await readMeta(baselineDir);
  const changed = meta && was ? Object.keys(meta).filter((key) => JSON.stringify(meta[key]) !== JSON.stringify(was[key])) : [];
  if (changed.length > 0) return { outcome: 'stale', ratio, changed };
  return { outcome: 'mismatch', ratio };
}
