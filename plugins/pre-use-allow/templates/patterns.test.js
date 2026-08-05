#!/usr/bin/env node
// Tests for this project's segmentPatterns.
//
// Structural injection (&&, ;, |, $(), backticks, redirects, heredocs) is covered centrally by the
// pre-use-allow plugin's own suite and applies to every pattern here — do not repeat it. What this
// file locks down is *this project's* allow/deny boundary: each pattern you add should gain a
// SHOULD_APPROVE case, and each dangerous near-neighbour a SHOULD_REJECT case.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { segmentPatterns } = require(path.join(__dirname, 'patterns.js'));
const { isApproved } = require(resolveCore());

/**
 * Find approve-commands-core.js. Checked in order:
 *   1. ${CLAUDE_PLUGIN_ROOT}/hooks — when run from the plugin itself
 *   2. the installed plugin cache — 0.6.0+ keeps core in hooks/, older builds in templates/
 *
 * Note: on Windows $HOME may point at C:\WINDOWS\system32\config\systemprofile, so USERPROFILE is
 * the reliable way to reach the real home directory.
 */
function resolveCore() {
    const candidates = [];

    if (process.env.CLAUDE_PLUGIN_ROOT) {
        candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks', 'approve-commands-core.js'));
    }

    const base = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.claude', 'plugins', 'cache', 'nshvyryaev-claude-marketplace', 'pre-use-allow'
    );
    if (fs.existsSync(base)) {
        for (const v of fs.readdirSync(base).sort().reverse()) {
            candidates.push(path.join(base, v, 'hooks', 'approve-commands-core.js'));
            candidates.push(path.join(base, v, 'templates', 'approve-commands-core.js'));
        }
    }

    const hit = candidates.find((p) => fs.existsSync(p));
    if (!hit) throw new Error(`approve-commands-core.js not found. Looked in:\n  ${candidates.join('\n  ')}`);
    return hit;
}

const SHOULD_APPROVE = [
    ['git status', 'git status'],
    ['git diff with args', 'git diff --stat HEAD'],
    ['read-only pipeline', 'cat package.json | head -20'],
];

const SHOULD_REJECT = [
    ['rm', 'rm -rf src'],
    ['npm publish', 'npm publish'],
    ['curl', 'curl https://example.com'],
    ['sudo', 'sudo rm -rf /'],
];

let passed = 0, failed = 0;
for (const [label, cmd] of SHOULD_APPROVE) {
    if (isApproved(cmd, segmentPatterns)) { console.log(`  ok      approve: ${label}`); passed++; }
    else { console.log(`  FAIL    approve: ${label} — not matched: ${cmd}`); failed++; }
}
for (const [label, cmd] of SHOULD_REJECT) {
    if (!isApproved(cmd, segmentPatterns)) { console.log(`  ok      reject:  ${label}`); passed++; }
    else { console.log(`  FAIL    reject:  ${label} — wrongly approved: ${cmd}`); failed++; }
}

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0);
