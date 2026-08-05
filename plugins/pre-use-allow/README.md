# pre-use-allow

PreToolUse Bash auto-approval workflow with a parser-based check so per-command patterns can stay simple and safe.

Two parts:

1. **Plugin-served hook** (`hooks/approve-commands.js` + `hooks/approve-commands-core.js`) — parses each Bash command into sequence segments (`&&`, `||`, `;`) and pipe components (`|`), rejects unsafe shell constructs (`$(...)`, backticks, redirects, heredocs, background, subshells), and requires every component to match a per-segment pattern supplied by the project. Patterns grow project by project.
2. **Decision-aware observation** — a PostToolUse hook records each Bash command into `observed.jsonl` **only when it went through a user prompt** (i.e. the PreToolUse hook stayed neutral and the user manually approved). Auto-approved commands are skipped — they are already covered. PreToolUse appends a per-tool-call entry (keyed by `tool_use_id`) to `decisions.jsonl`; PostToolUse looks up its own entry there and decides whether to log. Keying by `tool_use_id` makes the mechanism race-free under long-running and interleaved tool calls. The `/pre-use-allow:pre-use-allow-run` slash command reads `observed.jsonl`, filters out already-covered commands (using the same parser the hook uses), and promotes the user-selected ones into the pattern list (with a fresh test case each).

## Why the parser

Earlier versions of this plugin asked each regex to handle both the shell structure (no `;`, no `>`, no `&&` injection) and the command verb. That left a class of leaks — e.g. `git status && rm -rf /tmp/foo` could be accidentally approved because the regex tail `(?:[^;\n>]|"[^"\n]*")*$` permitted `&&`. Splitting structural parsing out of the patterns makes those leaks impossible: the parser refuses any `&&`-chained segment whose verb isn't in the per-segment whitelist, and refuses redirects/substitutions outright.

## Install

```
/plugin install pre-use-allow@nshvyryaev-claude-marketplace
```

## Initialize a project

```
/pre-use-allow:pre-use-allow-init
```

Creates `.claude/pre-use-allow/` with:

- `patterns.js` — `segmentPatterns: RegExp[]`, the project's whitelist. **The only file a project owns.**
- `patterns.test.js` — the project's allow/deny boundary tests
- `.gitignore` — for the observation logs

The parser and the PreToolUse entry point stay in the plugin and are registered through
`hooks/hooks.json`; nothing to merge into `settings.json` for approval. You only add a `PostToolUse`
entry if you want the observation log.

### Where the patterns are read from

1. `<project>/.claude/pre-use-allow/patterns.js` — canonical since 0.6.0
2. `<project>/.claude/hooks/approve-commands-patterns.js` — pre-0.6.0 layout, still honoured

A project with no patterns file gets no decision at all, which is the right default for a project
that never opted in.

### Upgrading from a pre-0.6.0 project

Before 0.6.0 the entry point and parser were **copied into each project**. That meant parser fixes
never reached repos that had already been initialised — one project was still auto-approving
`<allowed command> && rm -rf <dir>` months after that hole was closed elsewhere. If
`.claude/hooks/approve-commands.js` exists, the plugin hook **stands down** so nothing breaks;
run `/pre-use-allow:pre-use-allow-init` to migrate, and note that a pre-0.4.0 `APPROVED_PATTERNS`
export has to be rewritten per-segment by hand rather than renamed.

## Grow the patterns

After working in the project for a while, run:

```
/pre-use-allow:pre-use-allow-run
```

It shows uncovered commands sorted by frequency, you pick which to whitelist, the slash command grows `approve-commands-patterns.js` and adds tests.

You can also ask Claude directly: "разреши команду X" / "allow X" — the `pre-use-allow` skill picks up the request, runs the safety check, adds the per-segment pattern, and verifies tests are green.

## What's inside

- `skills/pre-use-allow/SKILL.md` — the workflow Claude follows when growing patterns by hand.
- `templates/` — files copied into `.claude/hooks/` by init.
  - `approve-commands-core.js`
  - `approve-commands.js`
  - `approve-commands-patterns.js`
  - `approve-commands.test.js`
  - `observe-commands.js`
- `commands/pre-use-allow-init.md` — `/pre-use-allow:pre-use-allow-init`.
- `commands/pre-use-allow-run.md` — `/pre-use-allow:pre-use-allow-run`.
- `scripts/filter-observed.js` — used by the run command; imports the project's `approve-commands-core.js` and `approve-commands-patterns.js` to identify uncovered observations.

## Migration from 0.1.x → 0.2.0

The patterns file format changed:

- **Before:** `module.exports = { patterns: [/full-regex/, ...] }` where each regex had to cover an entire command string including any `cd ... &&` prefix and had to defensively block `;`, `&`, `|`, `>`.
- **After:** `module.exports = { segmentPatterns: [/single-bare-command/, ...] }` where each regex matches one segment after parsing. No defensive operator-blocking inside patterns — the parser handles it.

If you upgrade an existing project, run `/pre-use-allow:pre-use-allow-init` again to install the new core file, then rewrite `approve-commands-patterns.js` to the new shape. The `filter-observed.js` helper prints a clear error if it finds the legacy `patterns` export, pointing you at this migration.

## Version

`0.5.0` — race-free observation log. Decisions are now appended to a multi-entry `decisions.jsonl` keyed by `tool_use_id`, replacing the singleton `last-decision.json` from 0.3.x/0.4.x. Fixes a bug where long-running or interleaved tool calls saw their decision entry overwritten by a later PreToolUse, causing hook-approved commands to be mistakenly logged and user-approved long-running ones to be missed. A cmd-string fallback remains for the older Claude Code shapes that don't pass `tool_use_id`.

`0.4.0` — parser carve-out for safe redirects: `2>&1`, FD duplication (`>&N`, `<&N`), and `/dev/null` sinks (`> /dev/null`, `2> /dev/null`, `&> /dev/null`) are now consumed by the parser instead of rejected. Common diagnostic pipelines like `npm test 2>&1 | tail -40` and `find . 2>/dev/null | head -5` auto-approve when both segments match patterns. Redirects to real files remain rejected.

`0.3.0` — decision-aware observation: `observed.jsonl` contains only commands the user manually approved (each entry tagged `decision: "user-approved"`). Auto-approved-by-hook commands and user-denied commands are not logged.
