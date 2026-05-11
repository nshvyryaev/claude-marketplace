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

function writeDecisions(projectDir, entries) {
  const dir = path.join(projectDir, '.claude', 'pre-use-allow');
  fs.mkdirSync(dir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify({
    tool_use_id: e.tool_use_id ?? '',
    ts: e.ts ?? new Date().toISOString(),
    cmd: e.cmd,
    verdict: e.verdict,
  })).join('\n');
  fs.writeFileSync(path.join(dir, 'decisions.jsonl'), lines + '\n');
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

// ── Decision-aware behavior keyed by tool_use_id ────────────────────────

check('no decisions file → logs (treated as user-approved)', () => {
  const root = mkproject();
  run({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, tool_use_id: 'call_1', tool_response: {} }, root);
  const log = readLog(root);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].command, 'ls -la');
  assert.strictEqual(log[0].decision, 'user-approved');
});

check('verdict=allow + matching tool_use_id → NOT logged', () => {
  const root = mkproject();
  writeDecisions(root, [{ tool_use_id: 'call_1', cmd: 'git status', verdict: 'allow' }]);
  run({ tool_name: 'Bash', tool_input: { command: 'git status' }, tool_use_id: 'call_1', tool_response: {} }, root);
  assert.strictEqual(readLog(root).length, 0);
});

check('verdict=neutral + matching tool_use_id → logged', () => {
  const root = mkproject();
  writeDecisions(root, [{ tool_use_id: 'call_1', cmd: 'docker compose down', verdict: 'neutral' }]);
  run({ tool_name: 'Bash', tool_input: { command: 'docker compose down' }, tool_use_id: 'call_1', tool_response: {} }, root);
  const log = readLog(root);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].decision, 'user-approved');
});

check('interleaved decisions: long-running tool call matched by id', () => {
  // Simulates the original bug: while a long playwright call (call_42, neutral)
  // is running, OTHER PreToolUses (calls 1, 2, 3, all allow) write later
  // entries. When call_42's PostToolUse fires, it MUST still find its own
  // entry by tool_use_id and log it.
  const root = mkproject();
  writeDecisions(root, [
    { tool_use_id: 'call_42', cmd: 'playwright big', verdict: 'neutral', ts: '2026-05-11T10:00:00Z' },
    { tool_use_id: 'call_1',  cmd: 'git status',    verdict: 'allow',   ts: '2026-05-11T10:01:00Z' },
    { tool_use_id: 'call_2',  cmd: 'ls -la',        verdict: 'allow',   ts: '2026-05-11T10:02:00Z' },
    { tool_use_id: 'call_3',  cmd: 'grep TODO src', verdict: 'allow',   ts: '2026-05-11T10:03:00Z' },
  ]);
  run({ tool_name: 'Bash', tool_input: { command: 'playwright big' }, tool_use_id: 'call_42', tool_response: {} }, root);
  const log = readLog(root);
  assert.strictEqual(log.length, 1, `expected playwright logged, got: ${JSON.stringify(log)}`);
  assert.strictEqual(log[0].command, 'playwright big');
});

check('interleaved decisions: hook-approved finds its own entry', () => {
  // Symmetric: a hook-approved find call (call_99, allow) sits earlier in the
  // file, then a different command's neutral entry is appended later. find's
  // PostToolUse must still find call_99 and SKIP logging.
  const root = mkproject();
  writeDecisions(root, [
    { tool_use_id: 'call_99', cmd: 'find . -name foo', verdict: 'allow',  ts: '2026-05-11T10:00:00Z' },
    { tool_use_id: 'call_100', cmd: 'docker compose down', verdict: 'neutral', ts: '2026-05-11T10:01:00Z' },
  ]);
  run({ tool_name: 'Bash', tool_input: { command: 'find . -name foo' }, tool_use_id: 'call_99', tool_response: {} }, root);
  assert.strictEqual(readLog(root).length, 0, 'find should NOT be logged — it was hook-approved');
});

check('missing tool_use_id → falls back to cmd matching', () => {
  const root = mkproject();
  writeDecisions(root, [{ cmd: 'docker compose down', verdict: 'neutral' }]);
  run({ tool_name: 'Bash', tool_input: { command: 'docker compose down' }, tool_response: {} }, root);
  const log = readLog(root);
  assert.strictEqual(log.length, 1);
});

check('missing tool_use_id + cmd allow → not logged (cmd fallback)', () => {
  const root = mkproject();
  writeDecisions(root, [{ cmd: 'git status', verdict: 'allow' }]);
  run({ tool_name: 'Bash', tool_input: { command: 'git status' }, tool_response: {} }, root);
  assert.strictEqual(readLog(root).length, 0);
});

check('id present in input but no matching entry → logs', () => {
  const root = mkproject();
  writeDecisions(root, [{ tool_use_id: 'call_other', cmd: 'foo', verdict: 'allow' }]);
  run({ tool_name: 'Bash', tool_input: { command: 'bar' }, tool_use_id: 'call_mine', tool_response: {} }, root);
  // No entry for call_mine; cmd fallback NOT used because toolUseId is set.
  const log = readLog(root);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].command, 'bar');
});

check('malformed decisions file → logs (best-effort)', () => {
  const root = mkproject();
  const dir = path.join(root, '.claude', 'pre-use-allow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.jsonl'), 'not-json\nalso-not\n');
  run({ tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'call_1', tool_response: {} }, root);
  assert.strictEqual(readLog(root).length, 1);
});

// ── Sanity (unchanged behaviors) ────────────────────────────────────────

check('non-Bash tool is ignored', () => {
  const root = mkproject();
  run({ tool_name: 'Edit', tool_input: { file_path: 'x.ts' } }, root);
  assert.strictEqual(readLog(root).length, 0);
});

check('falls back to cwd when CLAUDE_PROJECT_DIR missing', () => {
  const root = mkproject();
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pwd' }, tool_use_id: 'call_x', tool_response: {} }),
    encoding: 'utf8',
    cwd: root,
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR')),
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  const log = readLog(root);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].command, 'pwd');
});

const total = 11;
console.log(`\n${total} tests — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
