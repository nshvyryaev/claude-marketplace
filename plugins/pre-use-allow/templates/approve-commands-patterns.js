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
