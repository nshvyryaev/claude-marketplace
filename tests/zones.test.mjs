import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesPattern, normalizePath, zonesForFiles, selectScenarios } from '../shared/cdp/zones.mjs';

const BACKSLASH = String.fromCharCode(92);

test('пути Windows приводятся к прямым слэшам', () => {
  assert.equal(normalizePath(['src', 'domain', 'move.ts'].join(BACKSLASH)), 'src/domain/move.ts');
  assert.equal(normalizePath('./src/app.tsx'), 'src/app.tsx');
});

test('** покрывает любую глубину, включая нулевую', () => {
  assert.ok(matchesPattern('src/domain/**', 'src/domain/move.ts'));
  assert.ok(matchesPattern('src/**/move.ts', 'src/domain/move.ts'));
  assert.ok(matchesPattern('src/**', 'src/a/b/c/d.ts'));
  assert.ok(matchesPattern('src/**/app.tsx', 'src/app.tsx'));
  assert.ok(!matchesPattern('src/domain/**', 'src/state/reducer.ts'));
});

test('* не выходит за границу сегмента', () => {
  assert.ok(matchesPattern('src/screens/Home*.tsx', 'src/screens/HomeScreen.tsx'));
  assert.ok(!matchesPattern('src/screens/Home*.tsx', 'src/screens/GameScreen.tsx'));
  assert.ok(!matchesPattern('src/*.ts', 'src/domain/move.ts'));
});

test('* не съедает сам разделитель между кусками', () => {
  assert.ok(!matchesPattern('a*b', 'ab'.slice(0, 1)));
  assert.ok(matchesPattern('*.css', 'base.css'));
  assert.ok(!matchesPattern('*.css', 'css'));
});

const zoneMap = {
  'src/domain/**': ['game'],
  'src/screens/HomeScreen*': ['home'],
  'src/screens/GameScreen*': ['game'],
  'src/styles/**': ['home', 'game', 'stats'],
  'scripts/**': ['data'],
};

test('один файл может задеть несколько зон', () => {
  const result = zonesForFiles(['src/styles/tokens.css'], zoneMap);
  assert.deepEqual(result.zones.sort(), ['game', 'home', 'stats']);
  assert.deepEqual(result.unmapped, []);
});

test('файл вне карты попадает в unmapped', () => {
  const result = zonesForFiles(['src/domain/move.ts', 'vite.config.ts'], zoneMap);
  assert.deepEqual(result.zones, ['game']);
  assert.deepEqual(result.unmapped, ['vite.config.ts']);
});

const scenarios = [
  { name: 'home-open', zone: 'home' },
  { name: 'move-reject', zone: 'game' },
  { name: 'stats-empty', zone: 'stats' },
];

test('выбирается только задетая зона', () => {
  const { selected } = selectScenarios(scenarios, zonesForFiles(['src/domain/move.ts'], zoneMap));
  assert.deepEqual(selected.map((s) => s.name), ['move-reject']);
});

test('промах карты означает полный прогон, а не пустой', () => {
  const { selected, reason } = selectScenarios(
    scenarios,
    zonesForFiles(['неизвестный/файл.ts'], zoneMap),
  );
  assert.equal(selected.length, scenarios.length);
  assert.match(reason, /промахнулась/);
});

test('пустой список изменений не гоняет ничего', () => {
  const { selected } = selectScenarios(scenarios, zonesForFiles([], zoneMap));
  assert.deepEqual(selected, []);
});
