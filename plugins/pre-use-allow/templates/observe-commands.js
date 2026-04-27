#!/usr/bin/env node
// PostToolUse hook for Bash. Appends every executed Bash command to
// .claude/pre-use-allow/observed.jsonl in the project root, for later
// promotion via /pre-use-allow:pre-use-allow-run.

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
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), command: cmd }) + '\n';
  fs.appendFileSync(path.join(dir, 'observed.jsonl'), line);
});
