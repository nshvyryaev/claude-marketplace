#!/usr/bin/env node
// PreToolUse hook for Bash. Auto-approves a command when every segment of it
// matches a per-segment whitelist pattern; otherwise stays neutral so Claude
// Code falls back to its usual permission flow.
//
// All structural work (splitting by &&, ||, ;, |, rejecting $(...), backticks,
// redirects, heredocs, subshells, background) lives in approve-commands-core.js.
// Patterns live in approve-commands-patterns.js.

const path = require('path');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { process.stdout.write('{}'); return; }

  if (input?.tool_name !== 'Bash') { process.stdout.write('{}'); return; }
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string') { process.stdout.write('{}'); return; }

  // Load core + patterns lazily so a missing/broken file degrades to neutral
  // (Claude Code will prompt the user) instead of crashing every Bash call.
  let isApproved, segmentPatterns;
  try {
    ({ isApproved } = require(path.join(__dirname, 'approve-commands-core.js')));
    ({ segmentPatterns } = require(path.join(__dirname, 'approve-commands-patterns.js')));
  } catch {
    process.stdout.write('{}');
    return;
  }
  if (typeof isApproved !== 'function' || !Array.isArray(segmentPatterns)) {
    process.stdout.write('{}');
    return;
  }

  if (isApproved(cmd, segmentPatterns)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Matched pre-use-allow per-segment patterns',
      },
    }));
    return;
  }
  process.stdout.write('{}');
});
