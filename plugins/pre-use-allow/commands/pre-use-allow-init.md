---
description: Copy approve-commands hook scaffold and observer into the current project's .claude/hooks/.
---

# pre-use-allow-init

Install the pre-use-allow scaffold into the current project. Always confirms with the user before any write.

## Steps

1. **Confirm with user.** State you are about to create files in `<project-root>/.claude/hooks/` and `<project-root>/.claude/pre-use-allow/`. Ask for confirmation. Stop if denied.

2. **Copy the four template files** from `${CLAUDE_PLUGIN_ROOT}/templates/` to `<project-root>/.claude/hooks/`:
   - `approve-commands.js`
   - `approve-commands-patterns.js`
   - `approve-commands.test.js`
   - `observe-commands.js`

   For each: if the destination already exists, do NOT overwrite. Print a unified diff (`diff -u`) and ask the user how to proceed (skip / overwrite / merge by hand). Default is skip.

3. **Create the observation directory**: `<project-root>/.claude/pre-use-allow/`. Create it if missing.

4. **Write `.claude/pre-use-allow/.gitignore`** (overwrite OK, single line):

   ```
   observed.jsonl
   ```

5. **Print the settings.json snippet** the user must add to `<project-root>/.claude/settings.json`. Do NOT edit settings.json automatically — it may have other entries you'd clobber. Snippet:

   ```json
   {
     "hooks": {
       "PreToolUse": [
         { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/hooks/approve-commands.js" }] }
       ],
       "PostToolUse": [
         { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/hooks/observe-commands.js" }] }
       ]
     }
   }
   ```

   Tell the user: "Merge this with your existing settings.json `hooks` block. If you don't have one, paste this whole object."

6. **Run the test suite** to confirm the scaffold is green:

   ```
   node .claude/hooks/approve-commands.test.js
   ```

   Expected: `N tests — N passed, 0 failed`. If red, surface the failure and stop.

7. **Report final state**: which files were created, which were skipped, and the next step (add the snippet to settings.json, then start using `pre-use-allow` skill or `/pre-use-allow:pre-use-allow-run` to grow the patterns).
