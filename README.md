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
| [cocos-files-handler](plugins/cocos-files-handler/) | Read/edit Cocos Creator `.scene`/`.prefab` files via safe Node scripts. Blocks direct text edits. Also carries the Cocos 3.x pitfalls reference and a static checker (`setActive`, `.json` imports, generated tsconfig) wired to a PostToolUse hook. |
| [acceptance](plugins/acceptance/) | Acceptance criteria as a first-class artefact: lifecycle, freeze hook, sign-off rules. |
| [verify-web](plugins/verify-web/) | Browser verification over raw CDP: scenarios, snapshot diffs, screenshots for visual judgement. |
| [verify-cocos](plugins/verify-cocos/) | Game-playing QA bot for Cocos Creator web builds: seeded deterministic runs, goal/tactic agent with configurable randomness, oracles, decision trace, replay. |
| [pre-use-allow](plugins/pre-use-allow/) | PreToolUse Bash auto-approval. The parser and hook ship with the plugin (so security fixes propagate); a project owns only its `patterns.js`. Includes observed-history promotion to grow the whitelist over time. |

## Install a plugin

```
/plugin install <name>@nshvyryaev-claude-marketplace
```
