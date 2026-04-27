#!/usr/bin/env node
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = path.join(__dirname, 'block-cocos-files.js');

function run(input) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

const cases = [
  ['blocks .scene Edit',     { tool_name: 'Edit',      tool_input: { file_path: 'assets/scenes/Main.scene' } },     'deny'],
  ['blocks .prefab Write',   { tool_name: 'Write',     tool_input: { file_path: 'assets/prefabs/Foo.prefab' } },    'deny'],
  ['blocks .prefab MultiEdit',{tool_name: 'MultiEdit', tool_input: { file_path: 'C:/x/Bar.PREFAB' } },              'deny'],
  ['allows .ts Edit',        { tool_name: 'Edit',      tool_input: { file_path: 'src/Foo.ts' } },                   undefined],
  ['allows .json Edit',      { tool_name: 'Edit',      tool_input: { file_path: 'a/b.json' } },                     undefined],
  ['no file_path → allow',   { tool_name: 'Edit',      tool_input: {} },                                            undefined],
];

let passed = 0;
for (const [label, input, expected] of cases) {
  const out = run(input);
  const decision = out.hookSpecificOutput?.permissionDecision;
  assert.strictEqual(decision, expected, `${label}: expected ${expected}, got ${decision}`);
  console.log(`  ok  ${label}`);
  passed++;
}
console.log(`\n${cases.length} tests — ${passed} passed, 0 failed`);
