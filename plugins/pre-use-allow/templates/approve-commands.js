#!/usr/bin/env node
// PreToolUse hook for Bash. Auto-approves commands matching any pattern in
// approve-commands-patterns.js; otherwise stays neutral so Claude Code prompts the user.
//
// This file is the entry point. Patterns live in approve-commands-patterns.js
// (single source of truth, also imported by approve-commands.test.js).

const path = require('path');
const { patterns } = require(path.join(__dirname, 'approve-commands-patterns.js'));

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { process.stdout.write('{}'); return; }

  if (input?.tool_name !== 'Bash') { process.stdout.write('{}'); return; }
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string') { process.stdout.write('{}'); return; }

  if (patterns.some((p) => p.test(cmd))) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Matched a pre-use-allow pattern',
      },
    }));
    return;
  }
  process.stdout.write('{}');
});
