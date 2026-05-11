// Shared logic for the pre-use-allow hook.
//
// Architecture
// ------------
// Instead of asking each regex to handle shell structure (operators, quotes,
// redirects), we split that responsibility:
//
//   1. parseAndSplit(cmd) parses the bash command and returns the list of
//      sequence segments. Each sequence segment is a list of pipe components
//      (one entry if there is no pipe). Parsing rejects unsafe shell
//      constructs outright: command substitution, backticks, redirects,
//      heredocs, background, control flow, subshells, unterminated quotes.
//
//   2. isApproved(cmd, segmentPatterns) parses the command and requires every
//      pipe component of every sequence segment to match one of the user's
//      segmentPatterns (per-segment regexes that describe a single safe
//      command, no shell operators inside).
//
// This way patterns are simple, declarative, and impossible to bypass with
// `&& rm`, `; rm`, `| sh`, `$(...)`, etc. — the parser blocks the syntax,
// the patterns whitelist the verbs.

const STATE_PLAIN = 'plain';
const STATE_SINGLE = 'single';
const STATE_DOUBLE = 'double';

// Parse a bash command into an array of sequence segments. Returns
// { ok: true, segments: string[][] } on success, where each outer item is a
// sequence-step (separated by &&, ||, ;) and each inner item is a pipe
// component (separated by |). On unsafe input returns { ok: false, reason }.
function parseAndSplit(cmd) {
  if (typeof cmd !== 'string') return { ok: false, reason: 'not a string' };
  if (cmd.length === 0) return { ok: false, reason: 'empty' };

  let buf = '';
  let pipes = [];
  const segments = [];
  let state = STATE_PLAIN;

  const flushBuf = () => {
    const t = buf.trim();
    if (t) pipes.push(t);
    buf = '';
  };
  const flushSegment = () => {
    flushBuf();
    if (pipes.length) segments.push(pipes);
    pipes = [];
  };

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const next = i + 1 < cmd.length ? cmd[i + 1] : '';

    if (state === STATE_SINGLE) {
      buf += c;
      if (c === "'") state = STATE_PLAIN;
      continue;
    }

    if (state === STATE_DOUBLE) {
      if (c === '\\' && next !== '') {
        buf += c + next;
        i++;
        continue;
      }
      if (c === '$' && next === '(') return { ok: false, reason: 'command substitution $(...) is not allowed' };
      if (c === '`') return { ok: false, reason: 'backtick substitution is not allowed' };
      buf += c;
      if (c === '"') state = STATE_PLAIN;
      continue;
    }

    // STATE_PLAIN
    if (c === "'") { buf += c; state = STATE_SINGLE; continue; }
    if (c === '"') { buf += c; state = STATE_DOUBLE; continue; }
    if (c === '\\' && next !== '') { buf += c + next; i++; continue; }

    if (c === '$' && next === '(') return { ok: false, reason: 'command substitution $(...) is not allowed' };
    if (c === '`') return { ok: false, reason: 'backtick substitution is not allowed' };
    if (c === '<' && next === '<') return { ok: false, reason: 'heredoc (<<) is not allowed' };
    if (c === '>' || c === '<') return { ok: false, reason: `redirect (${c}) is not allowed` };
    if (c === '(' || c === ')') return { ok: false, reason: 'subshell ( ) is not allowed' };
    if (c === '{' || c === '}') return { ok: false, reason: 'group { } is not allowed' };
    if (c === '\n') return { ok: false, reason: 'newline in command is not allowed' };

    if ((c === '&' && next === '&') || (c === '|' && next === '|')) {
      flushSegment();
      i++;
      continue;
    }
    if (c === '&') return { ok: false, reason: 'background (&) is not allowed' };
    if (c === ';') { flushSegment(); continue; }
    if (c === '|') { flushBuf(); continue; }

    buf += c;
  }

  if (state !== STATE_PLAIN) return { ok: false, reason: 'unterminated quote' };
  flushSegment();

  if (!segments.length) return { ok: false, reason: 'no command' };
  return { ok: true, segments };
}

// Decide if a bash command is fully covered by the user's per-segment
// regex patterns. Every pipe component of every sequence segment must match.
function isApproved(cmd, segmentPatterns) {
  if (!Array.isArray(segmentPatterns)) return false;
  const parsed = parseAndSplit(cmd);
  if (!parsed.ok) return false;
  for (const seg of parsed.segments) {
    for (const piece of seg) {
      if (!segmentPatterns.some((p) => p instanceof RegExp && p.test(piece))) {
        return false;
      }
    }
  }
  return true;
}

module.exports = { parseAndSplit, isApproved };
