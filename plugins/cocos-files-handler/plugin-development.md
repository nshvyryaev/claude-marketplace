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

## Resolved: `__dirname`-derived paths in vendored scripts

Several scripts used to compute a `ROOT`/`ROOT_DIR`/`ASSETS_DIR` from `__dirname`. That was correct in the original deployment under `<project>/.claude/skills/scene-prefab-tools/scripts/`, but **does not resolve when the plugin is installed via marketplace** (the plugin folder is far from the user's Cocos project root) — it produced spurious "Meta file not found" errors.

**Status (v0.5.0): fixed everywhere.** Every script resolves its root as `process.env.CLAUDE_PROJECT_DIR || process.cwd()`. The last five (`add-locale-keys.js`, `add-localized-text.js`, `add-manager-to-scene.js`, `extract-scene-strings.js`, `fix-uuid-compact.js`) were migrated in v0.5.0.

**When adding a script, use the same pattern.** Never derive a project path from `__dirname` — that path points inside the plugin, which is read-only at runtime.

## The code checker

`skills/cocos-files-handler/scripts/verify-cocos-code.js` holds static checks for Cocos 3.x TypeScript that `tsc` cannot catch (`cocos-pitfalls.md` explains the rationale behind each rule). It is both a CLI and a module — `hooks/verify-cocos-code.js` requires it, so each rule has exactly one implementation.

Adding a rule:

1. Append to `RULES` (matched per source line) or `FILE_RULES` (matched against the file path).
2. The `message` must state **what breaks** and **what to write instead** — the hook feeds it verbatim to the model, so a vague message costs a round-trip.
3. Add cases to `__tests__/verify-cocos-code.test.mjs` covering both a violation and a legitimate near-miss. False positives are worse than a missing rule: the hook fires on every `.ts` write, and a noisy rule trains the model to ignore it.
4. Smoke-test against real projects before shipping — `CLAUDE_PROJECT_DIR=<project> node ... --all` over ImageUncovered / CodingDream / FarmArena should stay clean.

Rules must stay project-agnostic. Anything tied to one repo's conventions (magic-number policy, folder layout) belongs in that project's `CLAUDE.md`, not here.

## Running tests

```
node hooks/block-cocos-files.test.js
node hooks/verify-cocos-code.test.js
node --test skills/cocos-files-handler/scripts/__tests__/*.test.mjs
```

The hook tests should each end with `N tests — N passed, 0 failed`; the script suite should report `fail 0`.

Note the trailing `*.test.mjs` glob — passing the bare directory to `node --test` fails with
`Cannot find module` on Node 24.
