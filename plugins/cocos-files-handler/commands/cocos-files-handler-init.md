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
   - If both present:
     - Before replacing, extract any nested `<!-- cocos-files-handler:contribute:begin -->` ... `<!-- cocos-files-handler:contribute:end -->` sub-block from the existing content.
     - Replace everything between the outer markers (inclusive) with the template content.
     - If a contributor sub-block was extracted, re-insert it just before the closing `<!-- cocos-files-handler:end -->` marker. (This preserves contributor mode across consumer-mode reruns — see Notes.)
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
