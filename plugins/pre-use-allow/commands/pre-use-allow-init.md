---
description: Set up pre-use-allow in the current project — creates the project's patterns file and the observation directory.
---

# pre-use-allow-init

Opt the current project into pre-use-allow. Always confirms with the user before any write.

**Since 0.6.0 the parser and the PreToolUse entry point ship with the plugin** and are registered
through `hooks/hooks.json`. They are no longer copied into the project. A project owns exactly one
file — its patterns — so parser and security fixes arrive with a plugin update instead of going
stale in each repo.

## Steps

1. **Confirm with user.** State you are about to create `<project-root>/.claude/pre-use-allow/`
   with `patterns.js`, `patterns.test.js` and `.gitignore`. Ask for confirmation. Stop if denied.

2. **Detect a pre-0.6.0 install.** If `<project-root>/.claude/hooks/approve-commands.js` exists,
   the project is on the old vendored scaffold. The plugin hook deliberately **stands down** while
   that file is present, so the project keeps working untouched. Offer the migration:

   - Move the patterns: `.claude/hooks/approve-commands-patterns.js` →
     `.claude/pre-use-allow/patterns.js`.
     - If it exports `segmentPatterns` (0.4.0+), the file moves as-is.
     - If it exports `APPROVED_PATTERNS` (pre-0.4.0), those are **whole-command** regexes and must
       be rewritten per-segment by hand — do not mechanically rename the export, it silently
       changes what each pattern means. Pre-0.4.0 patterns typically also carry a live `&&`
       injection hole (they block `;` but not `&&`), so flag that to the user.
   - Delete `.claude/hooks/approve-commands.js`, `approve-commands-core.js` and
     `approve-commands.test.js`.
   - Remove the project's `PreToolUse` → `approve-commands.js` entry from `.claude/settings.json`;
     the plugin registers the hook now.

   If the user declines the migration, stop — leave the old scaffold in place.

3. **Copy `templates/patterns.js`** to `<project-root>/.claude/pre-use-allow/patterns.js`.
   If the destination exists, do NOT overwrite: print a `diff -u` and ask (default is skip).

4. **Copy `templates/observe-commands.js`** to `<project-root>/.claude/hooks/observe-commands.js`
   if the user wants the observation log (needed by `/pre-use-allow:pre-use-allow-run`). This one is
   still project-side, because it is a PostToolUse logger the project may want to customise.

5. **Write `.claude/pre-use-allow/.gitignore`** (overwrite OK):

   ```
   observed.jsonl
   decisions.jsonl
   last-decision.json
   ```

   `decisions.jsonl` is a scratch log written by the PreToolUse hook — one line per tool call with
   the verdict keyed by `tool_use_id`. The PostToolUse observer reads it to tell auto-approved
   commands from user-approved ones. `last-decision.json` is the legacy single-entry file from
   0.3.x; the current hooks ignore it and you can delete it. None of these should be committed.

   Note the hook only writes `decisions.jsonl` when `.claude/pre-use-allow/` already exists — a
   project that never ran init produces no log.

6. **Print the settings.json snippet** for the observer only. Do NOT edit settings.json
   automatically — it may have other entries you'd clobber. **Do not add a PreToolUse entry**; the
   plugin provides it.

   ```json
   {
     "hooks": {
       "PostToolUse": [
         { "matcher": "Bash", "hooks": [{ "type": "command", "command": "H=\"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/observe-commands.js\"; if [ -f \"$H\" ]; then exec node \"$H\"; fi" }] }
       ]
     }
   }
   ```

   The path must go through `$CLAUDE_PROJECT_DIR` rather than a bare relative
   `node .claude/hooks/observe-commands.js`. Hook commands are resolved against the session's
   **current** working directory, which moves when the agent works inside a git worktree or an
   additional working directory. `.claude/` is normally gitignored, so a worktree checkout has no
   `.claude/hooks/` at all, and every single Bash call then fails the hook with a `MODULE_NOT_FOUND`
   error. The `[ -f ]` guard makes the hook a silent no-op (exit 0) when the file really is absent
   instead of spamming errors, and `exec` keeps the script's own exit code intact.

7. **Run the project's test suite** to confirm the patterns are green:

   ```
   node .claude/pre-use-allow/patterns.test.js
   ```

   Expected: `N tests — N passed, 0 failed`. If red, surface the failure and stop.

8. **Report final state**: which files were created or skipped, whether a pre-0.6.0 scaffold was
   migrated, and the next step (use the `pre-use-allow` skill or `/pre-use-allow:pre-use-allow-run`
   to grow the patterns).
