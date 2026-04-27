#!/usr/bin/env node
// Read project's observed.jsonl + approve-commands-patterns.js, print one JSON
// line per UNCOVERED Bash command (i.e. not yet matched by any pattern), sorted
// by frequency desc. Used by /pre-use-allow:pre-use-allow-run.
//
// Project root is resolved from CLAUDE_PROJECT_DIR (set by Claude Code), with
// process.cwd() as fallback. Malformed JSONL lines are skipped, not fatal.

const fs = require('fs');
const path = require('path');

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const patternsPath = path.join(projectRoot, '.claude', 'hooks', 'approve-commands-patterns.js');
const observedPath = path.join(projectRoot, '.claude', 'pre-use-allow', 'observed.jsonl');

let patterns;
try { ({ patterns } = require(patternsPath)); }
catch (e) {
  process.stderr.write(`filter-observed: cannot load ${patternsPath}: ${e.message}\n`);
  process.exit(1);
}
if (!Array.isArray(patterns)) {
  process.stderr.write(`filter-observed: ${patternsPath} did not export a 'patterns' array\n`);
  process.exit(1);
}

if (!fs.existsSync(observedPath)) process.exit(0); // nothing to filter

const raw = fs.readFileSync(observedPath, 'utf8').trim();
if (!raw) process.exit(0);

const seen = new Map(); // command -> { ts, count }
for (const line of raw.split('\n')) {
  if (!line) continue;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  if (typeof o?.command !== 'string' || !o.command) continue;
  const cur = seen.get(o.command) || { ts: o.ts, count: 0 };
  cur.count++;
  cur.ts = o.ts;
  seen.set(o.command, cur);
}

const uncovered = [...seen.entries()]
  .filter(([cmd]) => !patterns.some((p) => p.test(cmd)))
  .sort((a, b) => b[1].count - a[1].count);

for (const [cmd, { count }] of uncovered) {
  process.stdout.write(JSON.stringify({ command: cmd, count }) + '\n');
}
