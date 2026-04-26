# Marketplace Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `nshvyryaev-claude-marketplace` and ship two plugins (`cocos-files-handler` v0.1.0, `pre-use-allow` v0.1.0) so users can install via `/plugin marketplace add` + `/plugin install`.

**Architecture:** Single git repo containing `.claude-plugin/marketplace.json` (catalog) and `plugins/<name>/` (each plugin self-contained with its own `.claude-plugin/plugin.json`, skills, hooks, commands, templates). Plugins source files from existing skills at `e:\projects\ImageUncovered\.claude\skills\` and adapt paths to use `${CLAUDE_PLUGIN_ROOT}` at runtime.

**Tech Stack:** Node.js (≥18, no transpilation), plain regex for matchers, JSON for manifests, Markdown for skills/commands/docs. No npm dependencies anywhere.

**Spec:** [docs/superpowers/specs/2026-04-26-marketplace-bootstrap-design.md](../specs/2026-04-26-marketplace-bootstrap-design.md)

**Authoring conventions for the engineer**
- Every commit message ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` on its own line.
- Working dir is `e:\projects\claude-marketplace`. All file paths in this plan are relative to that root.
- Source-of-truth paths used in copy steps:
  - `e:\projects\ImageUncovered\.claude\skills\scene-prefab-tools\` (12 scripts + 3 md)
  - `e:\projects\ImageUncovered\.claude\skills\pre-use-allow\SKILL.md`
  - `e:\projects\ImageUncovered\.claude\hooks\approve-commands.js` / `approve-commands-patterns.js` / `approve-commands.test.js`

---

## File Structure

After implementation:

```
claude-marketplace/
├── .claude/settings.json                                      # already exists
├── .claude-plugin/marketplace.json                            # Task 1
├── .gitignore                                                 # Task 1
├── README.md                                                  # Task 1
├── docs/superpowers/
│   ├── specs/2026-04-26-marketplace-bootstrap-design.md       # exists
│   └── plans/2026-04-26-marketplace-bootstrap.md              # this file
└── plugins/
    ├── cocos-files-handler/
    │   ├── .claude-plugin/plugin.json                         # Task 2
    │   ├── README.md                                          # Task 11
    │   ├── plugin-development.md                              # Task 9
    │   ├── skills/cocos-files-handler/
    │   │   ├── SKILL.md                                       # Tasks 3, 4
    │   │   ├── layout.md                                      # Task 3
    │   │   ├── uitransform-positioning.md                     # Task 3
    │   │   └── scripts/*.js  (12 files)                       # Tasks 3, 5
    │   ├── hooks/
    │   │   ├── hooks.json                                     # Task 7
    │   │   ├── block-cocos-files.js                           # Task 6
    │   │   └── block-cocos-files.test.js                      # Task 6
    │   ├── templates/claude-md-section.md                     # Task 8
    │   └── commands/cocos-files-handler-init.md               # Task 10
    └── pre-use-allow/
        ├── .claude-plugin/plugin.json                         # Task 12
        ├── README.md                                          # Task 17
        ├── skills/pre-use-allow/SKILL.md                      # Task 12
        ├── templates/
        │   ├── approve-commands.js                            # Task 13
        │   ├── approve-commands-patterns.js                   # Task 13
        │   ├── approve-commands.test.js                       # Task 13
        │   └── observe-commands.js                            # Task 14
        ├── tests/observe-commands.test.js                     # Task 14
        └── commands/
            ├── pre-use-allow-init.md                          # Task 15
            └── pre-use-allow-run.md                           # Task 16
```

---

## Task 1: Marketplace skeleton

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Write `.claude-plugin/marketplace.json`**

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

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json'))"`
Expected: no output, exit 0.

- [ ] **Step 3: Write `README.md`**

```markdown
# nshvyryaev-claude-marketplace

Personal Claude Code plugins.

## Install the marketplace

```
/plugin marketplace add nshvyryaev/claude-marketplace
```

(Replace with the actual GitHub path after pushing.)

## Plugins

| Plugin | Description |
|---|---|
| [cocos-files-handler](plugins/cocos-files-handler/) | Read/edit Cocos Creator `.scene`/`.prefab` files via safe Node scripts. Blocks direct text edits. |
| [pre-use-allow](plugins/pre-use-allow/) | PreToolUse Bash auto-approval workflow. Includes observed-history promotion to grow whitelist over time. |

## Install a plugin

```
/plugin install <name>@nshvyryaev-claude-marketplace
```
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json README.md .gitignore && \
git commit -m "$(cat <<'EOF'
chore: marketplace skeleton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: cocos-files-handler — plugin manifest

**Files:**
- Create: `plugins/cocos-files-handler/.claude-plugin/plugin.json`

- [ ] **Step 1: Write `plugins/cocos-files-handler/.claude-plugin/plugin.json`**

```json
{
  "name": "cocos-files-handler",
  "version": "0.1.0",
  "description": "Read/edit Cocos Creator .scene/.prefab files via safe Node scripts; blocks direct edits.",
  "author": { "name": "Nikita Shvyryaev", "email": "nikitagsh@gmail.com" }
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/cocos-files-handler/.claude-plugin/plugin.json'))"`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add plugins/cocos-files-handler/.claude-plugin/plugin.json && \
git commit -m "$(cat <<'EOF'
feat(cocos-files-handler): plugin manifest v0.1.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: cocos-files-handler — copy skill files

**Files:**
- Create: `plugins/cocos-files-handler/skills/cocos-files-handler/SKILL.md` (copy)
- Create: `plugins/cocos-files-handler/skills/cocos-files-handler/layout.md` (copy)
- Create: `plugins/cocos-files-handler/skills/cocos-files-handler/uitransform-positioning.md` (copy)
- Create: `plugins/cocos-files-handler/skills/cocos-files-handler/scripts/*.js` (12 files copied as-is)

- [ ] **Step 1: Create the destination directory and copy files**

```bash
mkdir -p plugins/cocos-files-handler/skills/cocos-files-handler/scripts && \
cp /e/projects/ImageUncovered/.claude/skills/scene-prefab-tools/SKILL.md \
   /e/projects/ImageUncovered/.claude/skills/scene-prefab-tools/layout.md \
   /e/projects/ImageUncovered/.claude/skills/scene-prefab-tools/uitransform-positioning.md \
   plugins/cocos-files-handler/skills/cocos-files-handler/ && \
cp /e/projects/ImageUncovered/.claude/skills/scene-prefab-tools/scripts/*.js \
   plugins/cocos-files-handler/skills/cocos-files-handler/scripts/
```

- [ ] **Step 2: Verify file count**

Run: `ls plugins/cocos-files-handler/skills/cocos-files-handler/scripts/*.js | wc -l`
Expected: `12`.

Run: `ls plugins/cocos-files-handler/skills/cocos-files-handler/*.md | wc -l`
Expected: `3`.

- [ ] **Step 3: Commit**

```bash
git add plugins/cocos-files-handler/skills && \
git commit -m "$(cat <<'EOF'
feat(cocos-files-handler): vendor skill content from scene-prefab-tools

Verbatim copy. Path rewrites and default-path fixes follow in next tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: cocos-files-handler — rewrite SKILL.md paths and rename skill

**Files:**
- Modify: `plugins/cocos-files-handler/skills/cocos-files-handler/SKILL.md`

- [ ] **Step 1: Update frontmatter `name` field**

Find:
```
---
name: scene-prefab-tools
description: Working with Cocos Creator scenes and prefabs via Node.js scripts. Use when you need to inspect or modify prefab or scene.
---
```

Replace with:
```
---
name: cocos-files-handler
description: Working with Cocos Creator scenes and prefabs via Node.js scripts. Use when you need to inspect or modify prefab or scene.
---
```

- [ ] **Step 2: Replace all script-path references**

Replace every occurrence (use `replace_all`):
- `node .claude/skills/scene-prefab-tools/scripts/` → `node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/`
- `.claude/skills/scene-prefab-tools/scripts/patches.json` → `.claude/cocos-files-handler/patches.json` (the OUTPUT location for users; plugin directory is read-only at runtime)

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -n "scene-prefab-tools" plugins/cocos-files-handler/skills/cocos-files-handler/SKILL.md`
Expected: no output (exit 1 from grep is OK).

- [ ] **Step 4: Commit**

```bash
git add plugins/cocos-files-handler/skills/cocos-files-handler/SKILL.md && \
git commit -m "$(cat <<'EOF'
feat(cocos-files-handler): rename skill and rewrite paths to CLAUDE_PLUGIN_ROOT

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: cocos-files-handler — fix script default output path

The plugin directory is read-only at runtime. `extract-scene-strings.js` defaults its output to `path.join(__dirname, 'patches.json')` (line 156 in source) — that would fail. Fix to write into the project's `.claude/cocos-files-handler/patches.json`.

**Files:**
- Modify: `plugins/cocos-files-handler/skills/cocos-files-handler/scripts/extract-scene-strings.js`

- [ ] **Step 1: Audit other scripts for the same pattern**

Run: `grep -n "__dirname" plugins/cocos-files-handler/skills/cocos-files-handler/scripts/*.js`

If any script besides `extract-scene-strings.js` writes to `__dirname`, apply the same fix to it. (Reading from `__dirname` for static data files is fine — only writes are a problem.)

- [ ] **Step 2: Modify `extract-scene-strings.js` default output**

Find the existing default-path block (around line 147–156):

```js
// Determine output path — default to tools/patches.json to avoid UTF-16 issues
let outputPath;
const outArgIndex = process.argv.indexOf('--output');
if (outArgIndex !== -1 && process.argv[outArgIndex + 1]) {
  outputPath = process.argv[outArgIndex + 1];
} else {
  outputPath = path.join(__dirname, 'patches.json');
}
```

Replace with:

```js
// Determine output path. Default writes into the project's .claude/cocos-files-handler/
// directory (the plugin folder is read-only at runtime when installed via marketplace).
let outputPath;
const outArgIndex = process.argv.indexOf('--output');
if (outArgIndex !== -1 && process.argv[outArgIndex + 1]) {
  outputPath = process.argv[outArgIndex + 1];
} else {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  outputPath = path.join(projectRoot, '.claude', 'cocos-files-handler', 'patches.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}
```

- [ ] **Step 3: Verify the script still parses**

Run: `node --check plugins/cocos-files-handler/skills/cocos-files-handler/scripts/extract-scene-strings.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add plugins/cocos-files-handler/skills/cocos-files-handler/scripts/extract-scene-strings.js && \
git commit -m "$(cat <<'EOF'
fix(cocos-files-handler): default patches.json output to project .claude/

Plugin folder is read-only when installed; default to writable project path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: cocos-files-handler — guardrail hook (TDD)

**Files:**
- Create: `plugins/cocos-files-handler/hooks/block-cocos-files.test.js`
- Create: `plugins/cocos-files-handler/hooks/block-cocos-files.js`

- [ ] **Step 1: Write the failing test**

`plugins/cocos-files-handler/hooks/block-cocos-files.test.js`:

```js
#!/usr/bin/env node
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = path.join(__dirname, 'block-cocos-files.js');

function run(input) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

const cases = [
  ['blocks .scene Edit',     { tool_name: 'Edit',      tool_input: { file_path: 'assets/scenes/Main.scene' } },     'deny'],
  ['blocks .prefab Write',   { tool_name: 'Write',     tool_input: { file_path: 'assets/prefabs/Foo.prefab' } },    'deny'],
  ['blocks .prefab MultiEdit',{tool_name: 'MultiEdit', tool_input: { file_path: 'C:/x/Bar.PREFAB' } },              'deny'],
  ['allows .ts Edit',        { tool_name: 'Edit',      tool_input: { file_path: 'src/Foo.ts' } },                   undefined],
  ['allows .json Edit',      { tool_name: 'Edit',      tool_input: { file_path: 'a/b.json' } },                     undefined],
  ['no file_path → allow',   { tool_name: 'Edit',      tool_input: {} },                                            undefined],
];

let passed = 0;
for (const [label, input, expected] of cases) {
  const out = run(input);
  const decision = out.hookSpecificOutput?.permissionDecision;
  assert.strictEqual(decision, expected, `${label}: expected ${expected}, got ${decision}`);
  console.log(`  ok  ${label}`);
  passed++;
}
console.log(`\n${cases.length} tests — ${passed} passed, 0 failed`);
```

- [ ] **Step 2: Run test, expect failure**

Run: `node plugins/cocos-files-handler/hooks/block-cocos-files.test.js`
Expected: error like `Error: Cannot find module 'block-cocos-files.js'` or similar — the hook doesn't exist yet.

- [ ] **Step 3: Implement `plugins/cocos-files-handler/hooks/block-cocos-files.js`**

```js
#!/usr/bin/env node
// PreToolUse hook: deny direct Edit/Write/MultiEdit on Cocos .scene/.prefab files.
// Forces use of cocos-files-handler scripts instead.

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { process.stdout.write('{}'); return; }

  const filePath = input?.tool_input?.file_path;
  if (typeof filePath === 'string' && /\.(scene|prefab)$/i.test(filePath)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Use cocos-files-handler scripts (edit-prefab.js, add-component.js, ' +
          'patch-component-property.js, etc.) instead of editing .scene/.prefab files directly. ' +
          'See ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/SKILL.md.',
      },
    }));
    return;
  }
  process.stdout.write('{}');
});
```

- [ ] **Step 4: Run test, expect pass**

Run: `node plugins/cocos-files-handler/hooks/block-cocos-files.test.js`
Expected: ends with `6 tests — 6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/cocos-files-handler/hooks/ && \
git commit -m "$(cat <<'EOF'
feat(cocos-files-handler): PreToolUse guardrail blocking .scene/.prefab edits

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: cocos-files-handler — wire hooks.json

**Files:**
- Create: `plugins/cocos-files-handler/hooks/hooks.json`

- [ ] **Step 1: Write `plugins/cocos-files-handler/hooks/hooks.json`**

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

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/cocos-files-handler/hooks/hooks.json'))"`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add plugins/cocos-files-handler/hooks/hooks.json && \
git commit -m "$(cat <<'EOF'
feat(cocos-files-handler): register guardrail hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: cocos-files-handler — CLAUDE.md template

**Files:**
- Create: `plugins/cocos-files-handler/templates/claude-md-section.md`

- [ ] **Step 1: Write `plugins/cocos-files-handler/templates/claude-md-section.md`**

```markdown
<!-- cocos-files-handler:begin -->
## Cocos files (.scene / .prefab)

This project uses the `cocos-files-handler` plugin for safe edits to Cocos Creator scene and prefab files.

**Rules:**
- Never use `Edit`, `Write`, or `MultiEdit` on `*.scene` or `*.prefab` files. The plugin's PreToolUse hook will block such attempts.
- Always use the scripts shipped with the plugin (path: `${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/`). The skill's `SKILL.md` documents the full toolkit.
- Common operations:
  - Inspect structure: `node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/prefab-inspector.js --file <path>`
  - Edit a property: `node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/patch-component-property.js ...`
  - Structural ops (resize, set-position, create/move/reparent nodes): `node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/edit-prefab.js --ops <ops.json>`
  - Add component: `node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/add-component.js ...`
- Refer to `${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/layout.md` for `cc.Layout` rules and the BOTTOM_TO_TOP trap.
- Refer to `${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/uitransform-positioning.md` for anchor and z-order rules.

<!-- cocos-files-handler:end -->
```

- [ ] **Step 2: Commit**

```bash
git add plugins/cocos-files-handler/templates/claude-md-section.md && \
git commit -m "$(cat <<'EOF'
feat(cocos-files-handler): CLAUDE.md template for init

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: cocos-files-handler — plugin-development.md

**Files:**
- Create: `plugins/cocos-files-handler/plugin-development.md`

- [ ] **Step 1: Write `plugins/cocos-files-handler/plugin-development.md`**

```markdown
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

## Running tests

```
node hooks/block-cocos-files.test.js
```

Should end with `N tests — N passed, 0 failed`.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/cocos-files-handler/plugin-development.md && \
git commit -m "$(cat <<'EOF'
docs(cocos-files-handler): contributor guide

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: cocos-files-handler — init slash command

**Files:**
- Create: `plugins/cocos-files-handler/commands/cocos-files-handler-init.md`

- [ ] **Step 1: Write the command**

```markdown
---
description: Initialize CLAUDE.md with cocos-files-handler usage rules. Pass --contribute when developing the plugin from a local checkout.
argument-hint: "[--contribute]"
---

# cocos-files-handler-init

Initialize the current project's `CLAUDE.md` with cocos-files-handler usage rules. Two modes:

- **Default (consumer)** — appends a self-contained block describing the plugin's safety rules and script paths.
- **`--contribute`** — additionally appends a contributor sub-block pointing at the local plugin checkout, so when the user asks for new scripts/rules, you (Claude) edit plugin source instead of project-local files.

## Steps

1. **Determine mode.** Read the user's invocation. If args contain `--contribute`, set `MODE=contribute`. Else `MODE=consumer`.

2. **Load the consumer template.** Read `${CLAUDE_PLUGIN_ROOT}/templates/claude-md-section.md`. This is the canonical block content, including the `<!-- cocos-files-handler:begin -->` / `<!-- cocos-files-handler:end -->` markers.

3. **Locate the project's CLAUDE.md.** It's at `<project-root>/CLAUDE.md`. If the file doesn't exist, create it with a top-level `# Project notes` heading.

4. **Write or update the cocos-files-handler block.**
   - Search for the markers `<!-- cocos-files-handler:begin -->` and `<!-- cocos-files-handler:end -->`.
   - If both present: replace everything between them (inclusive) with the template content.
   - Otherwise: append a blank line + the template content to the end of CLAUDE.md.

5. **If `MODE=contribute`:** append a contributor sub-block immediately *before* the closing `<!-- cocos-files-handler:end -->` marker (so it stays inside the main block, idempotently replaceable).

   Sub-block format (use these literal markers, replace `<RESOLVED_PATH>` with the absolute path from `CLAUDE_PLUGIN_ROOT` resolved at command time):

   ```markdown

   <!-- cocos-files-handler:contribute:begin -->
   ### Contributor mode

   Plugin checkout: `<RESOLVED_PATH>`

   When asked to add new Cocos scripts, helper docs, or hook rules, edit files **in the checkout above** — not in this project's `.claude/`. Refer to `<RESOLVED_PATH>/plugin-development.md` for conventions, then bump `plugin.json#version` per semver.
   <!-- cocos-files-handler:contribute:end -->
   ```

   If a `<!-- cocos-files-handler:contribute:begin -->`/`<!-- cocos-files-handler:contribute:end -->` block already exists inside the main block, replace it.

6. **Resolve `<RESOLVED_PATH>`:** in step 5, evaluate `process.env.CLAUDE_PLUGIN_ROOT` via a small Node one-liner and embed the literal string into CLAUDE.md (not the variable — the contributor edits source on a fixed local path).

7. **Report.** Print:
   - Mode used.
   - Whether CLAUDE.md was created or updated.
   - The byte range / line numbers of the inserted block.

## Notes

- This command never edits files outside the project's `CLAUDE.md`.
- It is idempotent: running twice produces the same file.
- Running without `--contribute` after running with it preserves the contributor sub-block (do NOT strip it on consumer-mode runs — only the user can remove it manually).
```

- [ ] **Step 2: Commit**

```bash
git add plugins/cocos-files-handler/commands/cocos-files-handler-init.md && \
git commit -m "$(cat <<'EOF'
feat(cocos-files-handler): /cocos-files-handler-init slash command

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: cocos-files-handler — README

**Files:**
- Create: `plugins/cocos-files-handler/README.md`

- [ ] **Step 1: Write the README**

```markdown
# cocos-files-handler

Read and edit Cocos Creator `.scene` / `.prefab` files via safe Node scripts. Includes a PreToolUse hook that blocks direct text edits and forces use of the scripts.

## Install

```
/plugin install cocos-files-handler@nshvyryaev-claude-marketplace
```

## Initialize a project

After install, run inside any Cocos project:

```
/cocos-files-handler:cocos-files-handler-init
```

This appends a block to the project's `CLAUDE.md` describing the rules and the available scripts.

## Contributor mode

If you have this plugin checked out locally and want Claude to edit *plugin* source on your behalf:

```
/cocos-files-handler:cocos-files-handler-init --contribute
```

See `plugin-development.md` for conventions.

## What's inside

- `skills/cocos-files-handler/` — the skill (auto-invoked when working with scenes/prefabs) plus 12 Node scripts.
- `hooks/` — guardrail blocking `Edit`/`Write`/`MultiEdit` on `*.scene`/`*.prefab`.
- `commands/cocos-files-handler-init.md` — `/cocos-files-handler:cocos-files-handler-init` slash command.

## Version

`0.1.0`
```

- [ ] **Step 2: Commit**

```bash
git add plugins/cocos-files-handler/README.md && \
git commit -m "$(cat <<'EOF'
docs(cocos-files-handler): README

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: pre-use-allow — manifest + skill copy

**Files:**
- Create: `plugins/pre-use-allow/.claude-plugin/plugin.json`
- Create: `plugins/pre-use-allow/skills/pre-use-allow/SKILL.md`

- [ ] **Step 1: Write `plugins/pre-use-allow/.claude-plugin/plugin.json`**

```json
{
  "name": "pre-use-allow",
  "version": "0.1.0",
  "description": "PreToolUse Bash auto-approval workflow with observed-history promotion",
  "author": { "name": "Nikita Shvyryaev", "email": "nikitagsh@gmail.com" }
}
```

- [ ] **Step 2: Copy SKILL.md verbatim**

```bash
mkdir -p plugins/pre-use-allow/skills/pre-use-allow && \
cp /e/projects/ImageUncovered/.claude/skills/pre-use-allow/SKILL.md \
   plugins/pre-use-allow/skills/pre-use-allow/SKILL.md
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/pre-use-allow/.claude-plugin/plugin.json'))"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add plugins/pre-use-allow/.claude-plugin/ plugins/pre-use-allow/skills/ && \
git commit -m "$(cat <<'EOF'
feat(pre-use-allow): plugin manifest and skill v0.1.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: pre-use-allow — approve-commands templates (stripped starter)

**Files:**
- Create: `plugins/pre-use-allow/templates/approve-commands.js`
- Create: `plugins/pre-use-allow/templates/approve-commands-patterns.js`
- Create: `plugins/pre-use-allow/templates/approve-commands.test.js`

The source files at `e:\projects\ImageUncovered\.claude\hooks\` are project-specific (Cocos paths, project root references). The templates ship with a minimal universally-safe starter set so each project grows its own list via the skill workflow.

- [ ] **Step 1: Read source `approve-commands.js` for structure reference**

Run: `cat /e/projects/ImageUncovered/.claude/hooks/approve-commands.js`

Use the structure (stdin → JSON in → match → JSON out) as the basis. Project-specific bits should not appear in the template.

- [ ] **Step 2: Write `plugins/pre-use-allow/templates/approve-commands.js`**

```js
#!/usr/bin/env node
// PreToolUse hook for Bash. Auto-approves commands matching any pattern in
// approve-commands-patterns.js; otherwise stays neutral so Claude Code prompts the user.
//
// This file is the entry point. Patterns live in approve-commands-patterns.js
// (single source of truth, also imported by approve-commands.test.js).

const path = require('path');
const { patterns } = require(path.join(__dirname, 'approve-commands-patterns.js'));

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { process.stdout.write('{}'); return; }

  if (input?.tool_name !== 'Bash') { process.stdout.write('{}'); return; }
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string') { process.stdout.write('{}'); return; }

  if (patterns.some((p) => p.test(cmd))) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Matched a pre-use-allow pattern',
      },
    }));
    return;
  }
  process.stdout.write('{}');
});
```

- [ ] **Step 3: Write `plugins/pre-use-allow/templates/approve-commands-patterns.js`**

```js
// Source of truth for auto-approved Bash commands.
// Add new patterns by running /pre-use-allow:pre-use-allow-run, or by hand
// using the pre-use-allow skill workflow.
//
// Conventions (see SKILL.md for full reference):
//   - Use ^${P} as the prefix (P below) so a bare command and a `cd <project> && ...`
//     prefixed form both match.
//   - Use the 's' flag if the command can span multiple lines (heredocs).
//   - Block `;` injection in read-only patterns with [^;\n]*$ instead of .*.
//   - Block `>` redirection in read-only patterns: (?:[^>;\n]|"[^"\n]*")*$.
//   - Block --force / --hard with negative lookaheads when relevant.

// Optional `cd <anything> && ` prefix.
const P = '(?:cd [^\\n;]+ && )?';

const patterns = [
  // git status / log / diff (read-only)
  new RegExp(`^${P}git (?:status|log|diff)(?:[^;\\n>]|"[^"\\n]*")*$`),

  // node --version, node -v
  new RegExp(`^${P}node (?:--version|-v)$`),
];

module.exports = { patterns, P };
```

- [ ] **Step 4: Write `plugins/pre-use-allow/templates/approve-commands.test.js`**

```js
#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const { patterns } = require(path.join(__dirname, 'approve-commands-patterns.js'));

function matches(cmd) { return patterns.some((p) => p.test(cmd)); }

const SHOULD_APPROVE = [
  ['git status — bare',      'git status'],
  ['git log — bare',         'git log --oneline -5'],
  ['git diff — with cd',     'cd /tmp/repo && git diff'],
  ['node version',           'node --version'],
];

const SHOULD_REJECT = [
  ['rm -rf',                 'rm -rf /tmp/x'],
  ['git status with ;',      'git status; rm /tmp/x'],
  ['git status with >',      'git status > /tmp/leak'],
  ['unrelated bash',         'echo hello'],
];

let passed = 0, failed = 0;
for (const [label, cmd] of SHOULD_APPROVE) {
  try { assert.ok(matches(cmd), `should approve: ${cmd}`); console.log(`  ok    APPROVE  ${label}`); passed++; }
  catch (e) { console.log(`  FAIL  APPROVE  ${label}: ${e.message}`); failed++; }
}
for (const [label, cmd] of SHOULD_REJECT) {
  try { assert.ok(!matches(cmd), `should reject: ${cmd}`); console.log(`  ok    REJECT   ${label}`); passed++; }
  catch (e) { console.log(`  FAIL  REJECT   ${label}: ${e.message}`); failed++; }
}

const total = SHOULD_APPROVE.length + SHOULD_REJECT.length;
console.log(`\n${total} tests — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 5: Run the template's own tests**

```bash
node plugins/pre-use-allow/templates/approve-commands.test.js
```

Expected: `8 tests — 8 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add plugins/pre-use-allow/templates/approve-commands.js plugins/pre-use-allow/templates/approve-commands-patterns.js plugins/pre-use-allow/templates/approve-commands.test.js && \
git commit -m "$(cat <<'EOF'
feat(pre-use-allow): approve-commands hook + minimal pattern starter + tests

Templates copied to project's .claude/hooks/ on init.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: pre-use-allow — observe-commands template (TDD)

**Files:**
- Create: `plugins/pre-use-allow/tests/observe-commands.test.js`
- Create: `plugins/pre-use-allow/templates/observe-commands.js`

- [ ] **Step 1: Write the failing test**

`plugins/pre-use-allow/tests/observe-commands.test.js`:

```js
#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'templates', 'observe-commands.js');

function run(input, projectDir) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
}

function readLog(projectDir) {
  const p = path.join(projectDir, '.claude', 'pre-use-allow', 'observed.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pua-'));
let passed = 0;

// Case 1: Bash command with successful response is appended.
run({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, tool_response: { interrupted: false } }, tmp);
let log = readLog(tmp);
assert.strictEqual(log.length, 1, 'expected 1 entry');
assert.strictEqual(log[0].command, 'ls -la');
assert.ok(typeof log[0].ts === 'string' && log[0].ts.length > 0, 'ts present');
console.log('  ok  appends successful Bash command');
passed++;

// Case 2: A second command appends a second line.
run({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: { interrupted: false } }, tmp);
log = readLog(tmp);
assert.strictEqual(log.length, 2, 'expected 2 entries');
assert.strictEqual(log[1].command, 'echo hi');
console.log('  ok  appends second command');
passed++;

// Case 3: Non-Bash tool is ignored.
run({ tool_name: 'Edit', tool_input: { file_path: 'x.ts' } }, tmp);
log = readLog(tmp);
assert.strictEqual(log.length, 2, 'non-Bash should not append');
console.log('  ok  ignores non-Bash tool');
passed++;

// Case 4: Missing CLAUDE_PROJECT_DIR falls back to cwd().
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pua-cwd-'));
const r2 = spawnSync('node', [HOOK], {
  input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pwd' }, tool_response: {} }),
  encoding: 'utf8',
  cwd: tmp2,
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR')),
});
if (r2.status !== 0) throw new Error(`hook exited ${r2.status}: ${r2.stderr}`);
const log2 = readLog(tmp2);
assert.strictEqual(log2.length, 1, 'cwd fallback should append');
assert.strictEqual(log2[0].command, 'pwd');
console.log('  ok  falls back to cwd when CLAUDE_PROJECT_DIR missing');
passed++;

console.log(`\n4 tests — ${passed} passed, 0 failed`);
```

- [ ] **Step 2: Run test, expect failure**

Run: `node plugins/pre-use-allow/tests/observe-commands.test.js`
Expected: error like `Cannot find module ... observe-commands.js`.

- [ ] **Step 3: Implement `plugins/pre-use-allow/templates/observe-commands.js`**

```js
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
```

- [ ] **Step 4: Run test, expect pass**

Run: `node plugins/pre-use-allow/tests/observe-commands.test.js`
Expected: ends with `4 tests — 4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/pre-use-allow/tests/ plugins/pre-use-allow/templates/observe-commands.js && \
git commit -m "$(cat <<'EOF'
feat(pre-use-allow): observe-commands PostToolUse logger + tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: pre-use-allow — init slash command

**Files:**
- Create: `plugins/pre-use-allow/commands/pre-use-allow-init.md`

- [ ] **Step 1: Write the command**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add plugins/pre-use-allow/commands/pre-use-allow-init.md && \
git commit -m "$(cat <<'EOF'
feat(pre-use-allow): /pre-use-allow-init slash command

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: pre-use-allow — run slash command (observed-history promotion)

**Files:**
- Create: `plugins/pre-use-allow/commands/pre-use-allow-run.md`

- [ ] **Step 1: Write the command**

```markdown
---
description: Read .claude/pre-use-allow/observed.jsonl, present uncovered Bash commands, promote selected ones into the auto-approve patterns.
---

# pre-use-allow-run

Promote observed Bash commands into auto-approval patterns.

## Steps

1. **Read the observed log** at `<project-root>/.claude/pre-use-allow/observed.jsonl`. Each line is `{"ts": "...", "command": "..."}`. If the file is missing or empty, report "No observations yet — keep working and try again later." and stop.

2. **Deduplicate by `command`.** Keep the latest `ts` per distinct command. Count occurrences.

3. **Filter out already-covered commands.** Run a one-liner Node check that imports `<project-root>/.claude/hooks/approve-commands-patterns.js` and tests each command against the patterns. Drop any that already match.

   ```bash
   node -e "
   const {patterns} = require('./.claude/hooks/approve-commands-patterns.js');
   const lines = require('fs').readFileSync('./.claude/pre-use-allow/observed.jsonl','utf8').trim().split('\n').filter(Boolean);
   const seen = new Map();
   for (const l of lines) { const o = JSON.parse(l); const c = o.command; const cur = seen.get(c) || {ts: o.ts, count: 0}; cur.count++; cur.ts = o.ts; seen.set(c, cur); }
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
```

- [ ] **Step 2: Commit**

```bash
git add plugins/pre-use-allow/commands/pre-use-allow-run.md && \
git commit -m "$(cat <<'EOF'
feat(pre-use-allow): /pre-use-allow-run slash command for observed promotion

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: pre-use-allow — README

**Files:**
- Create: `plugins/pre-use-allow/README.md`

- [ ] **Step 1: Write the README**

```markdown
# pre-use-allow

PreToolUse Bash auto-approval workflow. Two parts:

1. **Per-project pattern hook** (`approve-commands.js`) — auto-approves Bash commands matching a regex list in `approve-commands-patterns.js`. The list grows over time, project by project.
2. **Observation + promotion** — a PostToolUse hook records every executed Bash command into `observed.jsonl`. The `/pre-use-allow:pre-use-allow-run` slash command reads that log, filters out already-covered commands, and promotes the user-selected ones into the pattern list (with a fresh test case each).

## Install

```
/plugin install pre-use-allow@nshvyryaev-claude-marketplace
```

## Initialize a project

```
/pre-use-allow:pre-use-allow-init
```

Copies the hook scaffold into `.claude/hooks/` and prints the settings.json snippet you need to merge.

## Promote observed commands

After working in the project for a while, run:

```
/pre-use-allow:pre-use-allow-run
```

It shows uncovered commands sorted by frequency, you pick which to whitelist, the slash command grows the pattern file and adds tests.

## What's inside

- `skills/pre-use-allow/SKILL.md` — the workflow Claude follows when growing patterns by hand.
- `templates/` — files copied to project's `.claude/hooks/` by init.
- `commands/pre-use-allow-init.md` — `/pre-use-allow:pre-use-allow-init`.
- `commands/pre-use-allow-run.md` — `/pre-use-allow:pre-use-allow-run`.

## Version

`0.1.0`
```

- [ ] **Step 2: Commit**

```bash
git add plugins/pre-use-allow/README.md && \
git commit -m "$(cat <<'EOF'
docs(pre-use-allow): README

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Final integration check + project settings commit

**Files:**
- Add: `.claude/settings.json` (already exists in working tree; commit it now)

- [ ] **Step 1: Verify final tree shape**

Run:
```bash
ls .claude-plugin/marketplace.json && \
ls plugins/cocos-files-handler/.claude-plugin/plugin.json && \
ls plugins/cocos-files-handler/skills/cocos-files-handler/SKILL.md && \
ls plugins/cocos-files-handler/skills/cocos-files-handler/scripts/*.js | wc -l && \
ls plugins/cocos-files-handler/hooks/hooks.json && \
ls plugins/cocos-files-handler/hooks/block-cocos-files.js && \
ls plugins/cocos-files-handler/commands/cocos-files-handler-init.md && \
ls plugins/pre-use-allow/.claude-plugin/plugin.json && \
ls plugins/pre-use-allow/skills/pre-use-allow/SKILL.md && \
ls plugins/pre-use-allow/templates/{approve-commands.js,approve-commands-patterns.js,approve-commands.test.js,observe-commands.js} && \
ls plugins/pre-use-allow/commands/{pre-use-allow-init.md,pre-use-allow-run.md}
```

Expected: every file lists, script count is `12`, no errors.

- [ ] **Step 2: Run all plugin tests**

```bash
node plugins/cocos-files-handler/hooks/block-cocos-files.test.js && \
node plugins/pre-use-allow/templates/approve-commands.test.js && \
node plugins/pre-use-allow/tests/observe-commands.test.js
```

Expected: all three end with `N tests — N passed, 0 failed`.

- [ ] **Step 3: Commit project settings**

```bash
git add .claude/settings.json && \
git commit -m "$(cat <<'EOF'
chore: project settings.json (read permissions for source skill paths)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: User-facing manual verification (handoff to user — Claude cannot run /plugin commands)**

Tell the user to run, in any Claude Code session:

```
/plugin marketplace add /e/projects/claude-marketplace
/plugin install cocos-files-handler@nshvyryaev-claude-marketplace
/plugin install pre-use-allow@nshvyryaev-claude-marketplace
```

Then verify:
- `/cocos-files-handler:cocos-files-handler-init` is listed by `/plugin list` and runs.
- `/pre-use-allow:pre-use-allow-init` is listed and runs.
- A test `Edit` against a fake `*.scene` path is denied by the guardrail (in a Cocos project that already has the plugin enabled).

Report any issues back as a follow-up plan.

- [ ] **Step 5: Push to GitHub (after user verifies locally)**

User runs:
```bash
git remote add origin https://github.com/nshvyryaev/claude-marketplace.git
git push -u origin master
```

After push, the marketplace can be installed by anyone via `/plugin marketplace add nshvyryaev/claude-marketplace`.
