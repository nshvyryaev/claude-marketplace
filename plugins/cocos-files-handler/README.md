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
