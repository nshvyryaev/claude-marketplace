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
