#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'filter-observed.js');
const CORE_SRC = path.join(__dirname, '..', 'templates', 'approve-commands-core.js');

function makeProject({ withPatterns = true, withCore = true, withObserved = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-'));
  const hooks = path.join(root, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  if (withCore) fs.copyFileSync(CORE_SRC, path.join(hooks, 'approve-commands-core.js'));
  if (withPatterns) {
    fs.writeFileSync(
      path.join(hooks, 'approve-commands-patterns.js'),
      'const segmentPatterns = [/^git status$/]; module.exports = { segmentPatterns };\n'
    );
  }
  if (withObserved) {
    fs.mkdirSync(path.join(root, '.claude', 'pre-use-allow'), { recursive: true });
  }
  return root;
}

function run(root, extraEnv = {}) {
  return spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...extraEnv },
  });
}

const cleanups = [];
process.on('exit', () => {
  for (const dir of cleanups) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok    ${label}`); passed++; }
  catch (e) { console.log(`  FAIL  ${label}: ${e.message}`); failed++; }
}

// ---------------------------------------------------------------------------
// Case 1: filters covered commands, dedups, skips bad lines, sorts by count.
// Now also exercises the parser: `cd /tmp && git status` is two segments,
// both covered (cd via segmentPatterns? no — so this is uncovered actually).
// Use a covered chain instead to assert parser+filter integration.
// ---------------------------------------------------------------------------
check('filters covered + dedups + sorts + skips malformed', () => {
  const root = makeProject();
  cleanups.push(root);
  const lines = [
    { ts: '2026-04-26T10:00:00Z', command: 'git status' },                 // covered → drop
    { ts: '2026-04-26T10:01:00Z', command: 'npm test' },                    // uncovered, count=1
    { ts: '2026-04-26T10:02:00Z', command: 'npm test' },                    // uncovered, count=2 (dedup)
    { ts: '2026-04-26T10:03:00Z', command: 'ls -la' },                      // uncovered, count=1
    { ts: '2026-04-26T10:04:00Z', command: 'git status && rm -rf /tmp' },   // uncovered: rm not in patterns → drop NOT (it is uncovered, must surface)
    'not-json',                                                              // malformed → skip
    { ts: '2026-04-26T10:06:00Z' },                                          // missing command → skip
    { ts: '2026-04-26T10:07:00Z', command: '' },                             // empty command → skip
  ];
  fs.writeFileSync(
    path.join(root, '.claude', 'pre-use-allow', 'observed.jsonl'),
    lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'
  );
  const r = run(root);
  assert.strictEqual(r.status, 0, `exit ${r.status}: stderr=${r.stderr}`);
  const out = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.strictEqual(out.length, 3, `expected 3 uncovered, got ${out.length}: ${JSON.stringify(out)}`);
  assert.deepStrictEqual(out[0], { command: 'npm test', count: 2 });
  // ls -la and the && rm chain both have count 1 — order between them is
  // not guaranteed by frequency sort, but both must appear.
  const rest = out.slice(1).map((e) => e.command).sort();
  assert.deepStrictEqual(rest, ['git status && rm -rf /tmp', 'ls -la']);
});

// ---------------------------------------------------------------------------
// Case 2: `cd /tmp && git status` — only `git status` is in segmentPatterns
// (no cd pattern in this fixture), so the whole chain is uncovered. Confirms
// that filter relies on the SAME parser+per-segment logic as the hook.
// ---------------------------------------------------------------------------
check('chain uncovered when any segment is uncovered', () => {
  const root = makeProject();
  cleanups.push(root);
  fs.writeFileSync(
    path.join(root, '.claude', 'pre-use-allow', 'observed.jsonl'),
    JSON.stringify({ ts: '2026-04-26T10:00:00Z', command: 'cd /tmp && git status' }) + '\n'
  );
  const r = run(root);
  assert.strictEqual(r.status, 0);
  const out = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.strictEqual(out.length, 1, `expected 1 uncovered, got: ${JSON.stringify(out)}`);
  assert.strictEqual(out[0].command, 'cd /tmp && git status');
});

// ---------------------------------------------------------------------------
// Case 3: chain that IS fully covered → filtered out.
// ---------------------------------------------------------------------------
check('chain covered when every segment matches', () => {
  const root = makeProject();
  cleanups.push(root);
  // Replace patterns: add a cd pattern so `cd X && git status` becomes covered.
  fs.writeFileSync(
    path.join(root, '.claude', 'hooks', 'approve-commands-patterns.js'),
    'const segmentPatterns = [/^cd \\S+$/, /^git status$/]; module.exports = { segmentPatterns };\n'
  );
  fs.writeFileSync(
    path.join(root, '.claude', 'pre-use-allow', 'observed.jsonl'),
    JSON.stringify({ ts: '2026-04-26T10:00:00Z', command: 'cd /tmp && git status' }) + '\n'
  );
  const r = run(root);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '', `expected empty stdout, got: ${r.stdout}`);
});

// ---------------------------------------------------------------------------
// Case 4: missing observed.jsonl → empty stdout, exit 0.
// ---------------------------------------------------------------------------
check('missing observed.jsonl → empty output, exit 0', () => {
  const root = makeProject({ withObserved: false });
  cleanups.push(root);
  const r = run(root);
  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
  assert.strictEqual(r.stdout.trim(), '');
});

// ---------------------------------------------------------------------------
// Case 5: missing patterns module → exit 1 with clear stderr.
// ---------------------------------------------------------------------------
check('missing patterns module → exit 1', () => {
  const root = makeProject({ withPatterns: false });
  cleanups.push(root);
  const r = run(root);
  assert.strictEqual(r.status, 1, 'missing patterns should exit 1');
  assert.ok(/cannot load/.test(r.stderr), `expected "cannot load" in stderr, got: ${r.stderr}`);
});

// ---------------------------------------------------------------------------
// Case 6: missing core module → exit 1 with clear stderr.
// ---------------------------------------------------------------------------
check('missing core module → exit 1', () => {
  const root = makeProject({ withCore: false });
  cleanups.push(root);
  const r = run(root);
  assert.strictEqual(r.status, 1, 'missing core should exit 1');
  assert.ok(/cannot load/.test(r.stderr), `expected "cannot load" in stderr, got: ${r.stderr}`);
});

// ---------------------------------------------------------------------------
// Case 7: patterns exports old `patterns` instead of `segmentPatterns` →
// exit 1 with a clear migration message.
// ---------------------------------------------------------------------------
check('legacy `patterns` export → exit 1', () => {
  const root = makeProject({ withPatterns: false });
  cleanups.push(root);
  fs.writeFileSync(
    path.join(root, '.claude', 'hooks', 'approve-commands-patterns.js'),
    'const patterns = [/^git status$/]; module.exports = { patterns };\n'
  );
  const r = run(root);
  assert.strictEqual(r.status, 1);
  assert.ok(/segmentPatterns/.test(r.stderr), `expected "segmentPatterns" in stderr, got: ${r.stderr}`);
});

const total = 7;
console.log(`\n${total} tests — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
