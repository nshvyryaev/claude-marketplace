---
description: Read .claude/pre-use-allow/observed.jsonl, present uncovered Bash commands, promote selected ones into the auto-approve patterns.
---

# pre-use-allow-run

Promote observed Bash commands into auto-approval patterns.

## Steps

1. **Read the observed log** at `<project-root>/.claude/pre-use-allow/observed.jsonl`. Each line is `{"ts": "...", "command": "..."}`. If the file is missing or empty, report "No observations yet — keep working and try again later." and stop.

2. **Deduplicate by `command`.** Count occurrences. Keep the most recently observed `ts` per distinct command (observations are appended in chronological order, so the last seen is the latest).

3. **Filter out already-covered commands.** Run the helper script shipped with the plugin. It imports the project's `.claude/hooks/approve-commands-patterns.js`, dedupes observations, drops covered ones, and prints one JSON line per uncovered command (`{"command": "...", "count": N}`) sorted by frequency desc. Malformed JSONL lines are skipped silently.

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/filter-observed.js
   ```

   Empty stdout means nothing to promote.

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
   - Parse the command into segments (the same way the hook does) and add or extend a per-segment regex in `<project-root>/.claude/hooks/approve-commands-patterns.js` (`segmentPatterns` array). One pattern per distinct bare command — do NOT include `&&`, `;`, `|`, `>`, or `cd ... &&` prefixes in the pattern; the parser handles those.
   - Add a `SHOULD_APPROVE` test case in `<project-root>/.claude/hooks/approve-commands.test.js` using the original full command string (parser exercise included).

7. **After all selected commands are processed**, run the test suite once:

   ```
   node .claude/hooks/approve-commands.test.js
   ```

   Expected: `N tests — N passed, 0 failed`. If red, surface the failure (show which pattern caused it) and stop without removing the partial work — the user will fix and re-run tests.

8. **Optionally truncate `observed.jsonl`** of the promoted commands. Ask the user: "Promoted N commands. Remove their entries from observed.jsonl? (y/n)". If yes, rewrite the file keeping only entries whose `command` is NOT in the promoted set.

9. **Report final state**: which patterns were added, how many tests pass, and any remaining uncovered commands count.
