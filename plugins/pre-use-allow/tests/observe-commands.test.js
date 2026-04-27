#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'templates', 'observe-commands.js');

function run(input, projectDir) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
}

function readLog(projectDir) {
  const p = path.join(projectDir, '.claude', 'pre-use-allow', 'observed.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pua-'));
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pua-cwd-'));
process.on('exit', () => {
  for (const d of [tmp, tmp2]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});
let passed = 0;

// Case 1: Bash command with successful response is appended.
run({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, tool_response: { interrupted: false } }, tmp);
let log = readLog(tmp);
assert.strictEqual(log.length, 1, 'expected 1 entry');
assert.strictEqual(log[0].command, 'ls -la');
assert.ok(typeof log[0].ts === 'string' && log[0].ts.length > 0, 'ts present');
console.log('  ok  appends successful Bash command');
passed++;

// Case 2: A second command appends a second line.
run({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: { interrupted: false } }, tmp);
log = readLog(tmp);
assert.strictEqual(log.length, 2, 'expected 2 entries');
assert.strictEqual(log[1].command, 'echo hi');
console.log('  ok  appends second command');
passed++;

// Case 3: Non-Bash tool is ignored.
run({ tool_name: 'Edit', tool_input: { file_path: 'x.ts' } }, tmp);
log = readLog(tmp);
assert.strictEqual(log.length, 2, 'non-Bash should not append');
console.log('  ok  ignores non-Bash tool');
passed++;

// Case 4: Missing CLAUDE_PROJECT_DIR falls back to cwd().
const r2 = spawnSync('node', [HOOK], {
  input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pwd' }, tool_response: {} }),
  encoding: 'utf8',
  cwd: tmp2,
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR')),
});
if (r2.status !== 0) throw new Error(`hook exited ${r2.status}: ${r2.stderr}`);
const log2 = readLog(tmp2);
assert.strictEqual(log2.length, 1, 'cwd fallback should append');
assert.strictEqual(log2[0].command, 'pwd');
console.log('  ok  falls back to cwd when CLAUDE_PROJECT_DIR missing');
passed++;

console.log(`\n4 tests — ${passed} passed, 0 failed`);
