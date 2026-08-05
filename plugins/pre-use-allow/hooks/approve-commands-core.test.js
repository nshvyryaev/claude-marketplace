#!/usr/bin/env node
const assert = require('assert');
const path = require('path');

const { parseAndSplit, isApproved } = require(path.join(__dirname, 'approve-commands-core.js'));
// The end-to-end verdict cases below run against the starter patterns a project gets from
// templates/patterns.js — they pin the parser's behaviour, not any one project's allow-list.
const { segmentPatterns } = require(path.join(__dirname, '..', 'templates', 'patterns.js'));

let passed = 0, failed = 0;
const fail = (label, msg) => { console.log(`  FAIL  ${label}: ${msg}`); failed++; };
const ok   = (label)      => { console.log(`  ok    ${label}`);          passed++; };

function check(label, fn) {
  try { fn(); ok(label); }
  catch (e) { fail(label, e.message); }
}

// -------------------------------------------------------------------------
// parseAndSplit: structural parsing
// -------------------------------------------------------------------------

const PARSE_OK = [
  ['simple',                      'git status',                            [['git status']]],
  ['cd && git',                   'cd /tmp && git status',                 [['cd /tmp'], ['git status']]],
  ['chain three with &&',         'cd /x && git status && git diff',       [['cd /x'], ['git status'], ['git diff']]],
  ['semicolon chain',             'git status; git log',                   [['git status'], ['git log']]],
  ['logical or',                  'git status || git log',                 [['git status'], ['git log']]],
  ['pipe single',                 'git log | git show',                    [['git log', 'git show']]],
  ['pipe + sequence',             'git log | git show && git status',      [['git log', 'git show'], ['git status']]],
  ['quoted ampersands kept',      'cd "E:\\proj a&b" && git status',       [['cd "E:\\proj a&b"'], ['git status']]],
  ['single-quoted operators',     "git log --grep 'a && b || c'",          [["git log --grep 'a && b || c'"]]],
  ['escaped ampersand in plain',  'git log \\&\\& foo',                    [['git log \\&\\& foo']]],
  ['Windows-style cd path',       'cd "E:\\projects\\garden-diary" && git status && git diff --stat HEAD',
                                                                            [['cd "E:\\projects\\garden-diary"'], ['git status'], ['git diff --stat HEAD']]],
  // Safe-redirect carve-out: 2>&1 is consumed by parser, not kept in segment text.
  ['stderr to stdout (2>&1)',     'npm test 2>&1',                         [['npm test']]],
  ['stderr to stdout + pipe',     'npm test 2>&1 | tail -40',              [['npm test', 'tail -40']]],
  ['stderr to /dev/null',         'find . 2>/dev/null',                    [['find .']]],
  ['stderr to /dev/null + pipe',  'find . -name foo 2>/dev/null | head -5', [['find . -name foo', 'head -5']]],
  ['stdout to /dev/null',         'noisy_cmd > /dev/null',                 [['noisy_cmd']]],
  ['both to /dev/null',           'cmd &>/dev/null',                       [['cmd']]],
  ['both to /dev/null w/ space',  'cmd &> /dev/null',                      [['cmd']]],
  ['stdin from fd 0',             'cmd <&0',                               [['cmd']]],
  ['stdout to fd 2',              'cmd >&2',                               [['cmd']]],
  ['1>&2 explicit',               'cmd 1>&2',                              [['cmd']]],
  ['safe redirect chained',       'npm test 2>&1 && echo done',            [['npm test'], ['echo done']]],
];

const PARSE_REJECT = [
  ['command substitution $()',    'git log $(rm -rf /)'],
  ['backticks',                   'git log `whoami`'],
  ['command sub in double quote', 'echo "$(rm -rf /)"'],
  ['backticks in double quote',   'echo "`whoami`"'],
  ['output redirect to file',     'git status > /tmp/leak'],
  ['append redirect to file',     'git status >> /tmp/leak'],
  ['input redirect from file',    'git apply < /tmp/x.patch'],
  ['stderr to file (not /dev/null)', 'cmd 2> errors.log'],
  ['both to file (&>file)',       'cmd &> output.log'],
  ['&>> append both',             'cmd &>> output.log'],
  ['/dev/null prefix-only path',  'cmd > /dev/null/foo'],
  ['heredoc',                     'cat <<EOF\nfoo\nEOF'],
  ['here-string',                 'cat <<<"foo"'],
  ['background single &',         'git status & rm -rf /tmp'],
  ['subshell parens',             '(git status)'],
  ['brace group',                 '{ git status; }'],
  ['unterminated double quote',   'git status "foo'],
  ['unterminated single quote',   "git status 'foo"],
  ['empty string',                ''],
  ['newline in command',          'git status\nrm -rf /'],
];

console.log('parseAndSplit — structural acceptance');
for (const [label, input, expected] of PARSE_OK) {
  check(`  parse OK   ${label}`, () => {
    const r = parseAndSplit(input);
    assert.ok(r.ok, `expected ok, got rejection: ${r.reason}`);
    assert.deepStrictEqual(r.segments, expected, `segments mismatch:\n  got      ${JSON.stringify(r.segments)}\n  expected ${JSON.stringify(expected)}`);
  });
}

console.log('parseAndSplit — structural rejection');
for (const [label, input] of PARSE_REJECT) {
  check(`  parse REJ  ${label}`, () => {
    const r = parseAndSplit(input);
    assert.ok(!r.ok, `expected rejection, got ok with segments ${JSON.stringify(r.segments)}`);
  });
}

// -------------------------------------------------------------------------
// isApproved: end-to-end verdict against the default segmentPatterns
// -------------------------------------------------------------------------

const SHOULD_APPROVE = [
  ['git status — bare',                  'git status'],
  ['git log with flags',                 'git log --oneline -5'],
  ['git diff with arg',                  'git diff HEAD'],
  ['git show',                           'git show HEAD'],
  ['cd unquoted',                        'cd /tmp/repo'],
  ['cd double-quoted',                   'cd "E:\\projects\\garden-diary"'],
  ['cd single-quoted',                   "cd '/tmp/with spaces'"],
  ['cd && git',                          'cd /tmp/repo && git diff'],
  ['cd && git && git',                   'cd "E:\\projects\\garden-diary" && git status && git diff --stat HEAD'],
  ['node --version',                     'node --version'],
  ['node -v',                            'node -v'],
  ['git log pipe git show',              'git log -1 | git show'],
];

const SHOULD_REJECT = [
  ['rm -rf alone',                       'rm -rf /tmp/x'],
  ['; rm injection',                     'git status; rm /tmp/x'],
  ['&& rm injection (the old hole)',     'git status && rm -rf /tmp/foo'],
  ['|| rm injection',                    'git status || rm -rf /tmp/foo'],
  ['pipe to shell',                      'git status | sh'],
  ['pipe to bash',                       'git log | bash'],
  ['redirect to file',                   'git status > /tmp/leak'],
  ['append redirect',                    'git log >> /tmp/leak'],
  ['command substitution',               'git status $(rm -rf /tmp/foo)'],
  ['backtick substitution',              'git status `whoami`'],
  ['background &',                       'git status & rm -rf /tmp/foo'],
  ['subshell parens',                    '(git status && rm -rf /tmp/foo)'],
  ['unrelated bash',                     'echo hello'],
  ['heredoc',                            'git status <<EOF\nfoo\nEOF'],
  ['eval through alias',                 'git status && eval "rm -rf /"'],
  ['cd to safe but second cmd unsafe',   'cd /tmp && rm -rf /tmp/foo'],
  ['cd followed by uncovered',           'cd /tmp && echo hi'],
  ['unterminated quote',                 'git status "foo'],
  ['empty',                              ''],
];

console.log('\nisApproved — should approve');
for (const [label, cmd] of SHOULD_APPROVE) {
  check(`  APPROVE  ${label}`, () => {
    assert.ok(isApproved(cmd, segmentPatterns), `expected approve, was rejected: ${cmd}`);
  });
}

console.log('\nisApproved — should reject');
for (const [label, cmd] of SHOULD_REJECT) {
  check(`  REJECT   ${label}`, () => {
    assert.ok(!isApproved(cmd, segmentPatterns), `expected reject, was approved: ${cmd}`);
  });
}

const total = PARSE_OK.length + PARSE_REJECT.length + SHOULD_APPROVE.length + SHOULD_REJECT.length;
console.log(`\n${total} tests — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
