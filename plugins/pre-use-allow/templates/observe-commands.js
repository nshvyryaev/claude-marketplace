#!/usr/bin/env node
// PostToolUse hook for Bash. Appends each executed Bash command to
//   <project-root>/.claude/pre-use-allow/observed.jsonl
// ONLY when it did NOT auto-pass the pre-use-allow PreToolUse hook — i.e.
// when the user had to manually approve it via the Claude Code permission
// prompt. Commands that the hook already greenlights are skipped so the log
// stays focused on candidates for new auto-approval patterns.
//
// Mechanism: approve-commands.js writes its verdict for the current command
// to last-decision.json. If the verdict matches this command and equals
// 'allow', we don't append. Otherwise (neutral verdict, or missing file, or
// mismatch) we append with decision: 'user-approved' — PostToolUse only fires
// after a successful tool execution, so reaching this point means the user
// said yes at the prompt.
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

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = path.join(projectRoot, '.claude', 'pre-use-allow');
  const decisionPath = path.join(dir, 'last-decision.json');

  // If the most recent PreToolUse verdict for this exact command was 'allow',
  // it ran without any user interaction — nothing to log.
  if (wasHookAutoApproved(decisionPath, cmd)) return;

  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    command: cmd,
    decision: 'user-approved',
  }) + '\n';
  fs.appendFileSync(path.join(dir, 'observed.jsonl'), line);
});

function wasHookAutoApproved(decisionPath, cmd) {
  try {
    if (!fs.existsSync(decisionPath)) return false;
    const raw = fs.readFileSync(decisionPath, 'utf8').trim();
    if (!raw) return false;
    const obj = JSON.parse(raw);
    return obj && obj.verdict === 'allow' && obj.cmd === cmd;
  } catch {
    return false;
  }
}
