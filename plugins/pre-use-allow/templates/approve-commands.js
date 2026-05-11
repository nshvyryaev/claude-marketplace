#!/usr/bin/env node
// PreToolUse hook for Bash. Auto-approves a command when every segment of it
// matches a per-segment whitelist pattern; otherwise stays neutral so Claude
// Code falls back to its usual permission flow.
//
// All structural work (splitting by &&, ||, ;, |, rejecting $(...), backticks,
// redirects, heredocs, subshells, background) lives in approve-commands-core.js.
// Patterns live in approve-commands-patterns.js.
//
// As a side effect, this hook appends its verdict for the current tool call
// to .claude/pre-use-allow/decisions.jsonl. The PostToolUse observer reads
// that file, finds its own entry by tool_use_id, and decides whether to log
// the command to observed.jsonl. Keying by tool_use_id (instead of by the
// command string in a singleton file) makes the mechanism race-free under
// long-running and interleaved tool calls.

const fs = require('fs');
const path = require('path');

const GC_MIN_LINES = 200;
const GC_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { process.stdout.write('{}'); return; }

  if (input?.tool_name !== 'Bash') { process.stdout.write('{}'); return; }
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string') { process.stdout.write('{}'); return; }
  const toolUseId = typeof input?.tool_use_id === 'string' ? input.tool_use_id : '';

  // Load core + patterns lazily so a missing/broken file degrades to neutral
  // (Claude Code will prompt the user) instead of crashing every Bash call.
  let isApproved, segmentPatterns;
  try {
    ({ isApproved } = require(path.join(__dirname, 'approve-commands-core.js')));
    ({ segmentPatterns } = require(path.join(__dirname, 'approve-commands-patterns.js')));
  } catch {
    recordDecision(toolUseId, cmd, 'neutral');
    process.stdout.write('{}');
    return;
  }
  if (typeof isApproved !== 'function' || !Array.isArray(segmentPatterns)) {
    recordDecision(toolUseId, cmd, 'neutral');
    process.stdout.write('{}');
    return;
  }

  if (isApproved(cmd, segmentPatterns)) {
    recordDecision(toolUseId, cmd, 'allow');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Matched pre-use-allow per-segment patterns',
      },
    }));
    return;
  }
  recordDecision(toolUseId, cmd, 'neutral');
  process.stdout.write('{}');
});

function recordDecision(toolUseId, cmd, verdict) {
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const dir = path.join(root, '.claude', 'pre-use-allow');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'decisions.jsonl');
    const line = JSON.stringify({
      tool_use_id: toolUseId,
      ts: new Date().toISOString(),
      cmd,
      verdict,
    }) + '\n';
    fs.appendFileSync(filePath, line);
    maybeGc(filePath);
  } catch {
    // best-effort — never fail the hook for an observer-side concern
  }
}

function maybeGc(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length < GC_MIN_LINES) return;
    const cutoff = Date.now() - GC_MAX_AGE_MS;
    const kept = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (new Date(obj.ts).getTime() >= cutoff) kept.push(line);
      } catch {
        // drop unparseable lines during GC
      }
    }
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
    fs.renameSync(tmp, filePath);
  } catch {
    // best-effort
  }
}
