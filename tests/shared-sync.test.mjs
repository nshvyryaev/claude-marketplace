import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SOURCE, CONSUMERS, vendorDir, sourceFiles } from '../tools/sync-shared.mjs';

test('копии shared/cdp в плагинах совпадают с источником', async () => {
  const files = await sourceFiles();
  assert.ok(files.length > 0, 'shared/cdp пуст');
  let checked = 0;
  for (const plugin of CONSUMERS) {
    if (!existsSync(path.join(ROOT, 'plugins', plugin))) continue;
    const dir = vendorDir(plugin);
    assert.ok(existsSync(dir), `${plugin}: нет ${dir} — запустите node tools/sync-shared.mjs`);
    assert.deepEqual((await readdir(dir)).sort(), files, `${plugin}: набор файлов разошёлся`);
    for (const file of files) {
      assert.equal(
        await readFile(path.join(dir, file), 'utf8'),
        await readFile(path.join(SOURCE, file), 'utf8'),
        `${plugin}/${file} разошёлся с shared/cdp — запустите node tools/sync-shared.mjs`,
      );
    }
    checked++;
  }
  assert.ok(checked > 0, 'ни одного плагина-потребителя');
});
