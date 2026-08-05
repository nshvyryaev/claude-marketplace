#!/usr/bin/env node
// Read the project's observed.jsonl + approve-commands-{core,patterns}.js,
// print one JSON line per UNCOVERED Bash command (i.e. not yet matched by the
// project's per-segment patterns), sorted by frequency desc. Used by
// /pre-use-allow:pre-use-allow-run.
//
// Project root is resolved from CLAUDE_PROJECT_DIR (set by Claude Code), with
// process.cwd() as fallback. Malformed JSONL lines are skipped, not fatal.

const fs = require('fs');
const path = require('path');

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const observedPath = path.join(projectRoot, '.claude', 'pre-use-allow', 'observed.jsonl');

// The parser lives with the plugin from 0.6.0 on, but a pre-0.6.0 project still vendors its own
// copy — and while it does, that copy is the one actually deciding, so prefer it.
const corePath = firstExisting([
  path.join(projectRoot, '.claude', 'hooks', 'approve-commands-core.js'),
  path.join(__dirname, '..', 'hooks', 'approve-commands-core.js'),
]);
// Same order as the hook's own lookup: canonical project location, then the pre-0.6.0 one.
const patternsPath = firstExisting([
  path.join(projectRoot, '.claude', 'pre-use-allow', 'patterns.js'),
  path.join(projectRoot, '.claude', 'hooks', 'approve-commands-patterns.js'),
]);

function firstExisting(candidates) {
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

let isApproved;
try { ({ isApproved } = require(corePath)); }
catch (e) {
  process.stderr.write(`filter-observed: cannot load ${corePath}: ${e.message}\n`);
  process.exit(1);
}

let segmentPatterns;
try { ({ segmentPatterns } = require(patternsPath)); }
catch (e) {
  process.stderr.write(`filter-observed: cannot load ${patternsPath}: ${e.message}\n`);
  process.exit(1);
}
if (!Array.isArray(segmentPatterns)) {
  process.stderr.write(`filter-observed: ${patternsPath} did not export a 'segmentPatterns' array\n`);
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
  .filter(([cmd]) => !isApproved(cmd, segmentPatterns))
  .sort((a, b) => b[1].count - a[1].count);

for (const [cmd, { count }] of uncovered) {
  process.stdout.write(JSON.stringify({ command: cmd, count }) + '\n');
}
