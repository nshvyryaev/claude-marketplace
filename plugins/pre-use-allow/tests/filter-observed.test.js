#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'filter-observed.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

// Set up a fake project root with patterns + observed.jsonl
fs.mkdirSync(path.join(tmp, '.claude', 'hooks'), { recursive: true });
fs.mkdirSync(path.join(tmp, '.claude', 'pre-use-allow'), { recursive: true });
fs.writeFileSync(
  path.join(tmp, '.claude', 'hooks', 'approve-commands-patterns.js'),
  'const patterns = [/^git status$/]; module.exports = { patterns };\n'
);
const lines = [
  { ts: '2026-04-26T10:00:00Z', command: 'git status' },     // covered → drop
  { ts: '2026-04-26T10:01:00Z', command: 'npm test' },        // uncovered, count=1
  { ts: '2026-04-26T10:02:00Z', command: 'npm test' },        // uncovered, count=2 (dedup)
  { ts: '2026-04-26T10:03:00Z', command: 'ls -la' },          // uncovered, count=1
  'not-json',                                                  // malformed → skip
  { ts: '2026-04-26T10:05:00Z' },                              // missing command → skip
  { ts: '2026-04-26T10:06:00Z', command: '' },                 // empty command → skip
];
fs.writeFileSync(
  path.join(tmp, '.claude', 'pre-use-allow', 'observed.jsonl'),
  lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'
);

function run(env = {}) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, ...env },
  });
  if (r.status !== 0) throw new Error(`exit ${r.status}: stderr=${r.stderr}`);
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

let passed = 0;

// Case 1: filters covered commands, dedups, skips bad lines, sorts by count desc.
let out = run();
assert.strictEqual(out.length, 2, `expected 2 uncovered, got ${out.length}: ${JSON.stringify(out)}`);
assert.deepStrictEqual(out[0], { command: 'npm test', count: 2 });
assert.deepStrictEqual(out[1], { command: 'ls -la', count: 1 });
console.log('  ok  filters covered + dedups + sorts + skips malformed');
passed++;

// Case 2: missing observed.jsonl → empty stdout, exit 0.
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-empty-'));
fs.mkdirSync(path.join(tmp2, '.claude', 'hooks'), { recursive: true });
fs.writeFileSync(
  path.join(tmp2, '.claude', 'hooks', 'approve-commands-patterns.js'),
  'module.exports = { patterns: [] };\n'
);
const r2 = spawnSync('node', [SCRIPT], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: tmp2 },
});
assert.strictEqual(r2.status, 0, `missing observed.jsonl should exit 0, got ${r2.status}`);
assert.strictEqual(r2.stdout.trim(), '', 'expected empty stdout');
fs.rmSync(tmp2, { recursive: true, force: true });
console.log('  ok  missing observed.jsonl → empty output, exit 0');
passed++;

// Case 3: missing patterns module → exit 1 with clear stderr.
const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-nopat-'));
const r3 = spawnSync('node', [SCRIPT], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: tmp3 },
});
assert.strictEqual(r3.status, 1, 'missing patterns should exit 1');
assert.ok(/cannot load/.test(r3.stderr), `expected "cannot load" in stderr, got: ${r3.stderr}`);
fs.rmSync(tmp3, { recursive: true, force: true });
console.log('  ok  missing patterns module → exit 1');
passed++;

console.log(`\n3 tests — ${passed} passed, 0 failed`);
