# Marketplace Bootstrap — Design

**Date:** 2026-04-26
**Topic:** Initial scaffold for `nshvyryaev-claude-marketplace` and its first two plugins (`cocos-files-handler`, `pre-use-allow`).

## Goal

Turn the empty `e:\projects\claude-marketplace` repository into a Claude Code plugin marketplace that ships two plugins. End users install via `/plugin marketplace add nshvyryaev/claude-marketplace` (or whatever GitHub path) followed by `/plugin install <plugin>@nshvyryaev-claude-marketplace`.

Each plugin is wrapped from existing skills in `e:\projects\ImageUncovered\.claude\skills\`:

- `scene-prefab-tools` → `cocos-files-handler` plugin (skill + 12 scripts + guardrail hook + init command)
- `pre-use-allow` → `pre-use-allow` plugin (skill + init command + auto-collect run command + observer hook)

Both plugins start at `version: 0.1.0`.

## Non-goals

- No unit tests on the plugins themselves at this stage (manual verification via `/plugin install` is enough for v0.1.0).
- No custom UI for promoting observed commands — the run command works in the normal conversational slash-command flow.
- No CI/release automation; publishing = `git push` to GitHub.
- No backwards-compat shim for the old `scene-prefab-tools` skill name in the source project. The source skill stays untouched and continues to work; the plugin is a fresh artifact.

## Marketplace structure

Repository root layout:

```
e:\projects\claude-marketplace\
├── .claude-plugin\
│   └── marketplace.json
├── plugins\
│   ├── cocos-files-handler\
│   └── pre-use-allow\
├── docs\superpowers\specs\
│   └── 2026-04-26-marketplace-bootstrap-design.md
└── README.md
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "nshvyryaev-claude-marketplace",
  "owner": { "name": "Nikita Shvyryaev", "email": "nikitagsh@gmail.com" },
  "metadata": { "description": "Personal Claude Code plugins" },
  "plugins": [
    {
      "name": "cocos-files-handler",
      "source": "./plugins/cocos-files-handler",
      "description": "Cocos Creator scenes/prefabs editor with guardrail hook"
    },
    {
      "name": "pre-use-allow",
      "source": "./plugins/pre-use-allow",
      "description": "PreToolUse Bash auto-approval workflow with observed-history promotion"
    }
  ]
}
```

`README.md` documents:
- `/plugin marketplace add <github-path>` command
- Available plugins and what they do
- Where to file issues / contribute

## Plugin 1 — `cocos-files-handler`

### Layout

```
plugins/cocos-files-handler/
├── .claude-plugin/plugin.json
├── skills/cocos-files-handler/
│   ├── SKILL.md
│   ├── layout.md
│   ├── uitransform-positioning.md
│   └── scripts/
│       ├── add-component.js
│       ├── add-locale-keys.js
│       ├── add-localized-text.js
│       ├── add-manager-to-scene.js
│       ├── add-prefab-nodes.js
│       ├── create-prefab.js
│       ├── edit-prefab.js
│       ├── extract-scene-strings.js
│       ├── find-sprite-frame.js
│       ├── fix-uuid-compact.js
│       ├── patch-component-property.js
│       └── prefab-inspector.js
├── hooks/
│   ├── hooks.json
│   └── block-cocos-files.js
├── commands/
│   └── cocos-files-handler-init.md
├── templates/
│   └── claude-md-section.md
├── plugin-development.md
└── README.md
```

### `plugin.json`

```json
{
  "name": "cocos-files-handler",
  "version": "0.1.0",
  "description": "Read/edit Cocos Creator .scene/.prefab files via safe Node scripts; blocks direct edits.",
  "author": { "name": "Nikita Shvyryaev", "email": "nikitagsh@gmail.com" }
}
```

### Skill

Copy source files from `e:\projects\ImageUncovered\.claude\skills\scene-prefab-tools\` (`SKILL.md`, `layout.md`, `uitransform-positioning.md`, all 12 `scripts/*.js`).

Edits to `SKILL.md`:
- Frontmatter `name: cocos-files-handler` (was `scene-prefab-tools`).
- Frontmatter description preserved.
- All script invocations rewritten from `node .claude/skills/scene-prefab-tools/scripts/<x>.js` to `node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/<x>.js`. Affects ~25 lines across the file.
- The "patches.json output path" inside scripts (e.g. `extract-scene-strings.js` writes into the skill folder by default) — leave script behavior alone but update the documented examples in SKILL.md to write into the project's `.claude/cocos-files-handler/patches.json` so plugin code stays read-only at runtime.

Edits to scripts: minimal. If any script has a hardcoded `.claude/skills/scene-prefab-tools/...` path for **input/output of patches.json**, switch its default to a project-relative `.claude/cocos-files-handler/` path. (Investigate during implementation; most scripts take explicit `--file` / `--patches` args and don't need changes.)

### Guardrail hook

`hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/block-cocos-files.js" }
        ]
      }
    ]
  }
}
```

`block-cocos-files.js`:
- Reads hook input from stdin (JSON: `tool_name`, `tool_input.file_path`).
- If `file_path` ends in `.scene` or `.prefab` (case-insensitive), output `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Use cocos-files-handler scripts (e.g. edit-prefab.js, add-component.js, patch-component-property.js) instead of editing this file directly. See ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/SKILL.md." } }` and exit 0.
- Otherwise output `{}` and exit 0.

### `cocos-files-handler-init` command

`commands/cocos-files-handler-init.md` — the slash command becomes `/cocos-files-handler:cocos-files-handler-init`.

Frontmatter:
```yaml
---
description: Initialize CLAUDE.md with cocos-files-handler usage rules. Use --contribute when developing the plugin from a local checkout.
argument-hint: "[--contribute]"
---
```

Body (instructions Claude follows when the slash command fires):
1. Read `${CLAUDE_PLUGIN_ROOT}/templates/claude-md-section.md`.
2. Detect whether the project's `CLAUDE.md` already contains the markers `<!-- cocos-files-handler:begin -->` / `<!-- cocos-files-handler:end -->`. If present, replace the block; if absent, append a new block.
3. The block includes: forbid direct `Edit`/`Write`/`MultiEdit` on `*.scene`/`*.prefab` (the hook enforces this anyway, but the rule belongs in CLAUDE.md so Claude doesn't try); list of available scripts with one-line summaries; pointers to `layout.md` and `uitransform-positioning.md` via `${CLAUDE_PLUGIN_ROOT}` paths (literal, not expanded — Claude expands at runtime).
4. **If `--contribute` was passed:** also append a contributor sub-block (between `<!-- cocos-files-handler:contribute:begin -->` / `<!-- cocos-files-handler:contribute:end -->` markers nested inside the main block). The sub-block embeds the **resolved absolute path** to the plugin checkout (read from `CLAUDE_PLUGIN_ROOT` at init time and written as a literal string into CLAUDE.md — not `${CLAUDE_PLUGIN_ROOT}`, because the contributor edits source on a fixed local path). Sub-block content:
   - The resolved absolute path.
   - A literal-path reference to `<resolved-path>/plugin-development.md`.
   - Instruction: "When asked to add new Cocos scripts or rules, edit files in the plugin checkout above (not in `.claude/` of this project). Bump `plugin.json` version on non-trivial changes."

### `templates/claude-md-section.md`

Static markdown shipped with the plugin. Contains the consumer-block content (item 3 above). Contributor sub-block content is generated dynamically by the init command (it embeds the resolved checkout path).

### `plugin-development.md`

Plugin contributor guide (~30 lines). Covers:
- Where new scripts go (`skills/cocos-files-handler/scripts/`).
- Required script conventions: idempotent, accept `--dry-run`, take explicit `--file` arg.
- How to update SKILL.md when adding a script (table row + section if it has nuance).
- Versioning: semver, bump `plugin.json#version` per non-trivial change.
- Hook policy: do not extend `block-cocos-files.js` to other extensions without discussion (changes user-facing behavior).

## Plugin 2 — `pre-use-allow`

### Layout

```
plugins/pre-use-allow/
├── .claude-plugin/plugin.json
├── skills/pre-use-allow/
│   └── SKILL.md
├── commands/
│   ├── pre-use-allow-init.md
│   └── pre-use-allow-run.md
├── templates/
│   ├── approve-commands.js
│   ├── approve-commands-patterns.js
│   ├── approve-commands.test.js
│   └── observe-commands.js
└── README.md
```

### `plugin.json`

```json
{
  "name": "pre-use-allow",
  "version": "0.1.0",
  "description": "PreToolUse Bash auto-approval workflow with observed-history promotion",
  "author": { "name": "Nikita Shvyryaev", "email": "nikitagsh@gmail.com" }
}
```

### Skill

Copy `e:\projects\ImageUncovered\.claude\skills\pre-use-allow\SKILL.md` verbatim. The skill's body documents the existing safety-check + pattern + test workflow and continues to apply unchanged — it operates on the project's copy of `approve-commands-patterns.js` after init.

Frontmatter `name` stays `pre-use-allow`.

### Templates

The four files in `templates/` are copies of what currently lives in `e:\projects\ImageUncovered\.claude\hooks\`:

- `approve-commands.js` (~880 bytes) — entry point that imports patterns and decides allow/ask.
- `approve-commands-patterns.js` (~7.9 KB in source; for the **template** strip project-specific patterns and ship a minimal starter set with comments showing how to add new entries — patterns are project-specific, the template should not assume Cocos paths).
- `approve-commands.test.js` (~10.8 KB; same strip — keep test scaffolding and a couple of representative SHOULD_APPROVE / SHOULD_REJECT cases as examples).
- `observe-commands.js` (new, ~30 lines) — PostToolUse Bash logger:
  - Reads hook input from stdin.
  - If `tool_name === "Bash"` and `tool_response` indicates success, append a JSON line to `<project-root>/.claude/pre-use-allow/observed.jsonl` containing `{ts, command}`.
  - Project root is read from `$CLAUDE_PROJECT_DIR` (Claude Code env var), with fallback to `process.cwd()`.
  - Creates the directory if missing. Append-only.

### `pre-use-allow-init` command

Slash command `/pre-use-allow:pre-use-allow-init`. Body instructs Claude to:

1. Confirm with user before any writes.
2. Copy four template files from `${CLAUDE_PLUGIN_ROOT}/templates/` to project's `.claude/hooks/`. If a target file already exists, **do not overwrite** — print a diff and ask user how to proceed (skip / overwrite / merge by hand).
3. Create `.claude/pre-use-allow/` with a `.gitignore` that ignores `observed.jsonl` (observations are local to a developer's session, shouldn't be committed).
4. Print the settings.json snippet the user needs to add (PreToolUse + PostToolUse registration), but do not edit settings.json automatically. Snippet:
   ```json
   {
     "hooks": {
       "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/hooks/approve-commands.js" }] }],
       "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/hooks/observe-commands.js" }] }]
     }
   }
   ```
5. Run `node .claude/hooks/approve-commands.test.js` to confirm the scaffold is green.

### `pre-use-allow-run` command

Slash command `/pre-use-allow:pre-use-allow-run`. Body instructs Claude to:

1. Read `.claude/pre-use-allow/observed.jsonl`. If missing or empty: report and exit.
2. Build a deduplicated list of distinct commands (last-seen timestamp).
3. Filter out commands already auto-approved by current patterns by requiring `./.claude/hooks/approve-commands-patterns.js` and testing each candidate against its exported regex array. Implementation choice (small inline `node -e` snippet vs. a one-off helper at `templates/filter-observed.js`) made during the implementation step — both are equivalent.
4. Present the remaining list as a numbered table to the user, sorted by frequency descending.
5. Ask the user to pick indices to promote (e.g. `1,3,7-9`).
6. For each picked command, invoke the `pre-use-allow` skill workflow (safety check → add/extend pattern in `.claude/hooks/approve-commands-patterns.js` → add SHOULD_APPROVE test case in `.claude/hooks/approve-commands.test.js`).
7. After all pattern edits, run the test suite once. If green: report success. If red: stop and surface the failure for the user to fix.

## Versioning & publishing

- Plugins start at `0.1.0`. Semver. Bump on each non-trivial change.
- The marketplace itself has no version.
- "Publishing" = pushing this repo to GitHub. End users add it via `/plugin marketplace add <owner>/<repo>` once it's there.
- README.md at repo root explains all of the above.

## Risk / open questions

- **Plugin scripts writing to `.claude/cocos-files-handler/patches.json`:** need to verify during implementation that none of the 12 scripts hardcode an output path that breaks when the plugin is read-only. If any do, switch to project-relative defaults (or accept a `--patches-out` arg) — fix in implementation, document any deviation here.
- **`approve-commands-patterns.js` template stripping:** how minimal should the starter set be? Plan: keep only universally-safe patterns (e.g. `git status`, `git diff`, `node --version`) and clear comments showing the conventions. Project-specific patterns (Cocos paths, `cd /e/projects/ImageUncovered`) are removed — those grow naturally in each project via the skill workflow.
- **`observe-commands.js` env var:** confirm `CLAUDE_PROJECT_DIR` is the right env var Claude Code exposes to hooks. If wrong, the script still works via `process.cwd()` fallback, but the canonical path matters for cross-platform correctness.
