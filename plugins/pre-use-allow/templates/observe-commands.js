#!/usr/bin/env node
// PostToolUse hook for Bash. Appends each executed Bash command to
//   <project-root>/.claude/pre-use-allow/observed.jsonl
// ONLY when it did NOT auto-pass the pre-use-allow PreToolUse hook — i.e.
// when the user had to manually approve it via the Claude Code permission
// prompt. Commands the hook already greenlights are skipped so the log stays
// focused on candidates for new auto-approval patterns.
//
// Mechanism: approve-commands.js appended a verdict entry for this tool call
// (keyed by tool_use_id) to decisions.jsonl. We look up that entry. If the
// verdict was 'allow', we don't log. Otherwise we log to observed.jsonl with
// decision: 'user-approved' — PostToolUse only fires after a successful tool
// execution, so reaching this point means the user said yes at the prompt.
//
// If tool_use_id isn't in the hook input (older Claude Code or non-standard
// dispatch), we fall back to matching the most recent decision for the
// command string. This is the same fragile race the tool_use_id key fixes,
// but it remains a useful safety net so the observer never silently misses
// a user-approved command.
//
// Note: user-denied commands cannot be observed from PostToolUse (the tool
// did not run, so the hook is not invoked). They are not in this log.

const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { return; }

  if (input?.tool_name !== 'Bash') return;
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string' || !cmd) return;
  const toolUseId = typeof input?.tool_use_id === 'string' ? input.tool_use_id : '';

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = path.join(projectRoot, '.claude', 'pre-use-allow');
  const decisionsPath = path.join(dir, 'decisions.jsonl');

  const decision = findDecision(decisionsPath, toolUseId, cmd);
  if (decision && decision.verdict === 'allow') return; // auto-approved by hook → no need to log

  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    command: cmd,
    decision: 'user-approved',
  }) + '\n';
  fs.appendFileSync(path.join(dir, 'observed.jsonl'), line);
});

// Find the PreToolUse decision for the current tool call. Match by
// tool_use_id when available (race-free, unique per call); otherwise fall
// back to the most-recent decision whose `cmd` equals the current command.
function findDecision(decisionsPath, toolUseId, cmd) {
  try {
    if (!fs.existsSync(decisionsPath)) return null;
    const raw = fs.readFileSync(decisionsPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    // Scan from newest to oldest.
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      if (toolUseId && obj.tool_use_id === toolUseId) return obj;
      if (!toolUseId && obj.cmd === cmd) return obj;
    }
  } catch {
    // best-effort
  }
  return null;
}
