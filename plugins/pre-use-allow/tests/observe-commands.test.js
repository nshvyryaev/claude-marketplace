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

function writeDecision(projectDir, cmd, verdict) {
  const dir = path.join(projectDir, '.claude', 'pre-use-allow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'last-decision.json'),
    JSON.stringify({ ts: new Date().toISOString(), cmd, verdict }) + '\n'
  );
}

const tmpRoots = [];
function mkproject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pua-'));
  tmpRoots.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of tmpRoots) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
});

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok    ${label}`); passed++; }
  catch (e) { console.log(`  FAIL  ${label}: ${e.message}`); failed++; }
}

// ── Decision-aware behavior ────────────────────────────────────────────

check('no last-decision file → logs (treated as user-approved)', () => {
  const root = mkproject();
  run({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, tool_response: { interrupted: false } }, root);
  const log = readLog(root);
  assert.strictEqual(log.length, 1, `expected 1 entry, got ${log.length}`);
  assert.strictEqual(log[0].command, 'ls -la');
  assert.strictEqual(log[0].decision, 'user-approved');
});

check('verdict=allow + same cmd → NOT logged', () => {
  const root = mkproject();
  writeDecision(root, 'git status', 'allow');
  run({ tool_name: 'Bash', tool_input: { command: 'git status' }, tool_response: {} }, root);
  assert.strictEqual(readLog(root).length, 0, 'auto-approved command must not be logged');
});

check('verdict=neutral + same cmd → logged as user-approved', () => {
  const root = mkproject();
  writeDecision(root, 'docker compose down', 'neutral');
  run({ tool_name: 'Bash', tool_input: { command: 'docker compose down' }, tool_response: {} }, root);
  const log = readLog(root);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].decision, 'user-approved');
  assert.strictEqual(log[0].command, 'docker compose down');
});

check('verdict=allow but cmd mismatch → logged (defensive)', () => {
  const root = mkproject();
  writeDecision(root, 'git status', 'allow');
  // Different command than what was decided — log defensively.
  run({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' }, tool_response: {} }, root);
  assert.strictEqual(readLog(root).length, 1);
});

check('malformed last-decision file → logs (best-effort)', () => {
  const root = mkproject();
  const dir = path.join(root, '.claude', 'pre-use-allow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'last-decision.json'), 'not-json');
  run({ tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} }, root);
  assert.strictEqual(readLog(root).length, 1);
});

// ── Sanity (unchanged behaviors) ──────────────────────────────────────

check('non-Bash tool is ignored', () => {
  const root = mkproject();
  run({ tool_name: 'Edit', tool_input: { file_path: 'x.ts' } }, root);
  assert.strictEqual(readLog(root).length, 0);
});

check('falls back to cwd when CLAUDE_PROJECT_DIR missing', () => {
  const root = mkproject();
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pwd' }, tool_response: {} }),
    encoding: 'utf8',
    cwd: root,
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR')),
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  const log = readLog(root);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].command, 'pwd');
});

check('appends second user-approved command to existing log', () => {
  const root = mkproject();
  run({ tool_name: 'Bash', tool_input: { command: 'foo' }, tool_response: {} }, root);
  run({ tool_name: 'Bash', tool_input: { command: 'bar' }, tool_response: {} }, root);
  const log = readLog(root);
  assert.strictEqual(log.length, 2);
  assert.strictEqual(log[1].command, 'bar');
});

const total = 8;
console.log(`\n${total} tests — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
