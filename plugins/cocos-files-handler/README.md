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

- `skills/cocos-files-handler/` — the skill (auto-invoked when working with scenes/prefabs) plus 15 Node scripts.
- `skills/cocos-files-handler/cocos-pitfalls.md` — Cocos Creator 3.x API traps that the TypeScript compiler does not catch (`node.setActive()`, `.json` imports, editing the generated tsconfig, node-reference syntax).
- `hooks/` — two guardrails:
  - `block-cocos-files.js` (PreToolUse) blocks `Edit`/`Write`/`MultiEdit` on `*.scene`/`*.prefab`.
  - `verify-cocos-code.js` (PostToolUse) runs the static checks after every `.ts` write and reports findings back to the model.
- `commands/cocos-files-handler-init.md` — `/cocos-files-handler:cocos-files-handler-init` slash command.

## Checking code by hand

```
node skills/cocos-files-handler/scripts/verify-cocos-code.js --all
```

Exit code 1 when something is wrong. Suppress a false positive with a trailing `// cocos-verify-ignore`.

## Version

`0.5.0`
