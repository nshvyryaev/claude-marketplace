---
description: Read .claude/pre-use-allow/observed.jsonl, present uncovered Bash commands, promote selected ones into the auto-approve patterns.
---

# pre-use-allow-run

Promote observed Bash commands into auto-approval patterns.

## Steps

1. **Read the observed log** at `<project-root>/.claude/pre-use-allow/observed.jsonl`. Each line is `{"ts": "...", "command": "..."}`. If the file is missing or empty, report "No observations yet — keep working and try again later." and stop.

2. **Deduplicate by `command`.** Count occurrences. Keep the most recently observed `ts` per distinct command (observations are appended in chronological order, so the last seen is the latest).

3. **Filter out already-covered commands.** Run a Node check that imports `<project-root>/.claude/hooks/approve-commands-patterns.js` and tests each command against the patterns. Drop any that already match. Skip malformed JSONL lines instead of crashing.

   ```bash
   node -e "
   const {patterns} = require('./.claude/hooks/approve-commands-patterns.js');
   const lines = require('fs').readFileSync('./.claude/pre-use-allow/observed.jsonl','utf8').trim().split('\n').filter(Boolean);
   const seen = new Map();
   for (const l of lines) {
     let o;
     try { o = JSON.parse(l); } catch { continue; }
     if (typeof o?.command !== 'string') continue;
     const c = o.command;
     const cur = seen.get(c) || { ts: o.ts, count: 0 };
     cur.count++;
     cur.ts = o.ts;
     seen.set(c, cur);
   }
   const uncov = [...seen.entries()].filter(([c]) => !patterns.some((p) => p.test(c)));
   uncov.sort((a, b) => b[1].count - a[1].count);
   for (const [c, {count}] of uncov) console.log(JSON.stringify({c, count}));
   "
   ```

4. **Present the list** to the user as a numbered table sorted by count desc:

   ```
   #  count  command
   1  12     npm test
   2  4      ls -la
   ...
   ```

   If empty: "All observed commands are already covered. Nothing to promote." → stop.

5. **Ask the user** which indices to promote. Accept formats: `1,3,5`, `1-3`, `all`, or empty (cancel).

6. **For each picked command**, follow the `pre-use-allow` skill workflow:
   - Run the safety check from `${CLAUDE_PLUGIN_ROOT}/skills/pre-use-allow/SKILL.md` Step 1. If unsafe, warn the user and require confirmation.
   - Add or extend a regex in `<project-root>/.claude/hooks/approve-commands-patterns.js`.
   - Add a `SHOULD_APPROVE` test case in `<project-root>/.claude/hooks/approve-commands.test.js`.

7. **After all selected commands are processed**, run the test suite once:

   ```
   node .claude/hooks/approve-commands.test.js
   ```

   Expected: `N tests — N passed, 0 failed`. If red, surface the failure (show which pattern caused it) and stop without removing the partial work — the user will fix and re-run tests.

8. **Optionally truncate `observed.jsonl`** of the promoted commands. Ask the user: "Promoted N commands. Remove their entries from observed.jsonl? (y/n)". If yes, rewrite the file keeping only entries whose `command` is NOT in the promoted set.

9. **Report final state**: which patterns were added, how many tests pass, and any remaining uncovered commands count.
