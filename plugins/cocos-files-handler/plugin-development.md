# cocos-files-handler — Plugin Development Guide

This document is for contributors editing the plugin's source (e.g. via `cocos-files-handler-init --contribute`).

## Where things live

- Scripts: `skills/cocos-files-handler/scripts/*.js` — one file per operation.
- Skill docs: `skills/cocos-files-handler/SKILL.md`, `layout.md`, `uitransform-positioning.md`.
- Hooks: `hooks/block-cocos-files.js` (+ `block-cocos-files.test.js`), `hooks/hooks.json`.
- Init template: `templates/claude-md-section.md`.

## Adding a new script

1. Create `skills/cocos-files-handler/scripts/<name>.js`. Conventions:
   - Idempotent — safe to re-run.
   - Accepts `--file <path>` for the target.
   - Accepts `--dry-run` (prints the planned change, writes nothing).
   - Validates inputs and exits non-zero on misuse.
   - Writes only to the project (`process.env.CLAUDE_PROJECT_DIR || process.cwd()`), never to `__dirname`.
2. Update `SKILL.md`:
   - Add a row to the tools table at the top.
   - If the script has nuance (e.g. layout rules), add a section explaining traps.
3. Bump `plugin.json#version` per semver — patch for fixes, minor for new scripts/commands, major for breaking flag changes.

## Editing the guardrail

`hooks/block-cocos-files.js` blocks `Edit|Write|MultiEdit` on `*.scene`/`*.prefab`. Do not extend its scope to other extensions without discussion — it's user-facing behavior. Always update `block-cocos-files.test.js` together with the hook.

The hook deliberately produces no stderr/log output. Claude Code surfaces `permissionDecisionReason` to the user in-band, and stderr from a hook can leak into the transcript and look like errors. If you need debug logging, gate it behind an env var (`process.env.COCOS_HANDLER_DEBUG === '1'` → append to a file).

## Known caveat: `__dirname`-derived paths in vendored scripts

Several scripts compute a `ROOT`/`ROOT_DIR`/`ASSETS_DIR` from `__dirname`. These were correct in the original deployment under `<project>/.claude/skills/scene-prefab-tools/scripts/`, but **do not resolve correctly when the plugin is installed via marketplace** (the plugin folder is far from the user's Cocos project root).

**Status (v0.2.0):** `add-component.js`, `patch-component-property.js`, and the new `create-anim-clip.js` use `process.env.CLAUDE_PROJECT_DIR || process.cwd()` — they work from any cwd / installation layout.

**Still pending:** `add-locale-keys.js`, `add-localized-text.js`, `add-manager-to-scene.js`, `extract-scene-strings.js`, `fix-uuid-compact.js` still derive their root from `__dirname`. Marketplace-installed users should pass explicit `--file` / `--meta` / etc. flags for those, or run `process.env.CLAUDE_PROJECT_DIR` matches the actual Cocos project root. Switch each one to the env-var pattern and bump the minor version when migrating.

## Running tests

```
node hooks/block-cocos-files.test.js
```

Should end with `N tests — N passed, 0 failed`.
