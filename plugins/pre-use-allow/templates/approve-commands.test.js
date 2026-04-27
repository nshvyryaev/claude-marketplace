#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const { patterns } = require(path.join(__dirname, 'approve-commands-patterns.js'));

function matches(cmd) { return patterns.some((p) => p.test(cmd)); }

const SHOULD_APPROVE = [
  ['git status — bare',      'git status'],
  ['git log — bare',         'git log --oneline -5'],
  ['git diff — with cd',     'cd /tmp/repo && git diff'],
  ['node version',           'node --version'],
];

const SHOULD_REJECT = [
  ['rm -rf',                 'rm -rf /tmp/x'],
  ['git status with ;',      'git status; rm /tmp/x'],
  ['git status with >',      'git status > /tmp/leak'],
  ['unrelated bash',         'echo hello'],
];

let passed = 0, failed = 0;
for (const [label, cmd] of SHOULD_APPROVE) {
  try { assert.ok(matches(cmd), `should approve: ${cmd}`); console.log(`  ok    APPROVE  ${label}`); passed++; }
  catch (e) { console.log(`  FAIL  APPROVE  ${label}: ${e.message}`); failed++; }
}
for (const [label, cmd] of SHOULD_REJECT) {
  try { assert.ok(!matches(cmd), `should reject: ${cmd}`); console.log(`  ok    REJECT   ${label}`); passed++; }
  catch (e) { console.log(`  FAIL  REJECT   ${label}: ${e.message}`); failed++; }
}

const total = SHOULD_APPROVE.length + SHOULD_REJECT.length;
console.log(`\n${total} tests — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
