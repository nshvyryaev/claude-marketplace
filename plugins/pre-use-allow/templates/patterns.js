// Source of truth for auto-approved Bash commands.
//
// Each pattern in `segmentPatterns` matches a SINGLE bash command — no shell
// operators inside (&&, ||, ;, |, >, <, $(...), `...`, &). The hook splits
// the full command string and applies these patterns per pipe component.
// If every pipe component of every sequence segment matches a pattern, the
// command is approved.
//
// Conventions (see skills/pre-use-allow/SKILL.md for full reference):
//   - Match the bare command only. Do not try to include `cd X && ...` —
//     the host splits that into two segments (`cd X` and the next one) and
//     runs each through the patterns separately. The `cd` pattern below
//     covers the prefix once for all approved commands.
//   - Anchor with ^ and $ on every pattern.
//   - Restrict argument shapes. Bare `\S+` is fine for path-like args;
//     prefer specific character classes for refs, branches, and messages.
//   - You no longer need to block ;, &, |, > inside patterns — the parser
//     rejects them at the structural level.

const segmentPatterns = [
  // cd to any path (quoted or unquoted; unquoted must not contain whitespace)
  /^cd (?:"[^"\n]+"|'[^'\n]+'|\S+)$/,

  // read-only git verbs with arbitrary flag-and-arg tails
  /^git (?:status|log|diff|show)(?:\s+\S+)*$/,

  // node version
  /^node (?:--version|-v)$/,
];

module.exports = { segmentPatterns };
