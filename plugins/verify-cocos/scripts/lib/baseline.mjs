// Пиксельные эталоны вырезок: verify/baseline/<прогон>/<проверка>-<n>.png.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { diffPng } from '../vendor/cdp/png.mjs';

export async function compareShot({ png, name, baselineDir, newDir, update, threshold, tolerance }) {
  const file = path.join(baselineDir, `${name}.png`);
  if (update) {
    await mkdir(baselineDir, { recursive: true });
    await writeFile(file, png);
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
  return { outcome: 'mismatch', ratio: result.sameSize ? result.ratio : 1 };
}
