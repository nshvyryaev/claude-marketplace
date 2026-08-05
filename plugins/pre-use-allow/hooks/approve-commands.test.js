#!/usr/bin/env node
// Tests for the plugin-served PreToolUse entry point: where it finds patterns, when it stands
// down, and that the parser still blocks operator injection when driven from here.

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'approve-commands.js');

const PATTERNS_SRC = `module.exports = { segmentPatterns: [
  /^git (?:status|log|diff)(?:\\s+\\S+)*$/,
  /^ls(?:\\s+\\S+)*$/,
] };\n`;

const roots = [];
function makeRoot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pua-'));
    roots.push(dir);
    return dir;
}
process.on('exit', () => roots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function write(root, rel, content) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
}

function run(root, command, toolName = 'Bash') {
    const r = spawnSync('node', [HOOK], {
        input: JSON.stringify({ tool_name: toolName, tool_input: { command }, tool_use_id: 'tu_1' }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
    return JSON.parse(r.stdout || '{}');
}

const decisionOf = (out) => out.hookSpecificOutput?.permissionDecision;

let passed = 0;
function check(label, actual, expected) {
    assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
    console.log(`  ok  ${label}`);
    passed++;
}

// ── pattern lookup ───────────────────────────────────────────────────────────
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', PATTERNS_SRC);
    check('canonical location is used', decisionOf(run(root, 'git status')), 'allow');
    check('unlisted command stays neutral', decisionOf(run(root, 'npm publish')), undefined);
}
{
    const root = makeRoot();
    write(root, '.claude/hooks/approve-commands-patterns.js', PATTERNS_SRC);
    check('pre-0.6.0 location still honoured', decisionOf(run(root, 'git status')), 'allow');
}
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', PATTERNS_SRC);
    write(root, '.claude/hooks/approve-commands-patterns.js',
        'module.exports = { segmentPatterns: [/^npm publish$/] };\n');
    check('canonical location wins over legacy', decisionOf(run(root, 'npm publish')), undefined);
}
{
    const root = makeRoot();
    check('project with no patterns gets no decision', decisionOf(run(root, 'git status')), undefined);
}
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', 'module.exports = { APPROVED_PATTERNS: [/^.*$/] };\n');
    check('legacy APPROVED_PATTERNS export is refused', decisionOf(run(root, 'rm -rf /')), undefined);
}
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', 'this is not valid javascript {{{\n');
    check('broken patterns file degrades to neutral', decisionOf(run(root, 'git status')), undefined);
}

// ── stand-down ───────────────────────────────────────────────────────────────
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', PATTERNS_SRC);
    write(root, '.claude/hooks/approve-commands.js', '// project-owned entry point\n');
    check('stands down when the project vendors its own entry',
        decisionOf(run(root, 'git status')), undefined);
}

// ── injection still blocked when driven from the plugin ──────────────────────
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', PATTERNS_SRC);
    const cases = [
        ['&& injection', 'git status && rm -rf assets'],
        ['; injection', 'git status ; rm -rf assets'],
        ['pipe to shell', 'git status | sh'],
        ['command substitution', 'git status $(rm -rf assets)'],
        ['backticks', 'git status `rm -rf assets`'],
        ['redirect to file', 'git status > /tmp/leak'],
    ];
    for (const [label, cmd] of cases) {
        check(`blocked: ${label}`, decisionOf(run(root, cmd)), undefined);
    }
    check('safe fd-dup still approved', decisionOf(run(root, 'git status 2>&1')), 'allow');
}

// ── non-Bash and malformed input ─────────────────────────────────────────────
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', PATTERNS_SRC);
    check('non-Bash tool ignored', decisionOf(run(root, 'git status', 'Read')), undefined);

    const r = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'malformed stdin should exit 0');
    assert.strictEqual(r.stdout.trim(), '{}', 'malformed stdin should emit {}');
    console.log('  ok  malformed stdin is ignored');
    passed++;
}

// ── observation log ──────────────────────────────────────────────────────────
{
    const root = makeRoot();
    write(root, '.claude/pre-use-allow/patterns.js', PATTERNS_SRC);
    fs.mkdirSync(path.join(root, '.claude', 'pre-use-allow'), { recursive: true });
    run(root, 'git status');
    run(root, 'npm publish');
    const log = fs.readFileSync(path.join(root, '.claude/pre-use-allow/decisions.jsonl'), 'utf8')
        .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepStrictEqual(log.map((e) => e.verdict), ['allow', 'neutral'], 'both verdicts logged');
    console.log('  ok  decisions are logged for the observer');
    passed++;
}

console.log(`\n${passed} tests — ${passed} passed, 0 failed`);
