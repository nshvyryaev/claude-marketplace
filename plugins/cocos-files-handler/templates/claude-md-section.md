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
