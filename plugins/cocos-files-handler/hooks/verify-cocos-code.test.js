#!/usr/bin/env node
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'verify-cocos-code.js');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vcc-hook-'));
process.on('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));

fs.mkdirSync(path.join(sandbox, 'assets', 'scripts'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'assets/scripts/Bad.ts'), 'this.node.setActive(false);\n');
fs.writeFileSync(path.join(sandbox, 'assets/scripts/Good.ts'), 'this.node.active = false;\n');
fs.writeFileSync(path.join(sandbox, 'assets/scripts/notes.md'), 'x.setActive(false)\n');

function run(input) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: sandbox },
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

const cases = [
  [
    'blocks on a violating .ts write',
    { tool_name: 'Write', tool_input: { file_path: 'assets/scripts/Bad.ts' } },
    'block',
  ],
  [
    'stays silent on a clean .ts write',
    { tool_name: 'Edit', tool_input: { file_path: 'assets/scripts/Good.ts' } },
    undefined,
  ],
  [
    'ignores non-source files even when they contain the pattern',
    { tool_name: 'Write', tool_input: { file_path: 'assets/scripts/notes.md' } },
    undefined,
  ],
  [
    'ignores a file that no longer exists',
    { tool_name: 'Write', tool_input: { file_path: 'assets/scripts/Gone.ts' } },
    undefined,
  ],
  [
    'no file_path → silent',
    { tool_name: 'Write', tool_input: {} },
    undefined,
  ],
  [
    'accepts an absolute path',
    { tool_name: 'Write', tool_input: { file_path: path.join(sandbox, 'assets/scripts/Bad.ts') } },
    'block',
  ],
];

let passed = 0;
for (const [label, input, expected] of cases) {
  const out = run(input);
  assert.strictEqual(out.decision, expected, `${label}: expected ${expected}, got ${out.decision}`);
  if (expected === 'block') {
    assert.ok(/no-set-active/.test(out.reason), `${label}: reason should name the rule`);
    assert.ok(/node\.active/.test(out.reason), `${label}: reason should state the fix`);
    assert.ok(out.hookSpecificOutput.additionalContext, `${label}: additionalContext should be set`);
  }
  console.log(`  ok  ${label}`);
  passed++;
}

// Malformed stdin must not crash the hook — it would break every Write in the session.
{
  const r = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'malformed stdin should exit 0');
  assert.strictEqual(r.stdout.trim(), '{}', 'malformed stdin should emit {}');
  console.log('  ok  malformed stdin is ignored');
  passed++;
}

console.log(`\n${passed} tests — ${passed} passed, 0 failed`);
