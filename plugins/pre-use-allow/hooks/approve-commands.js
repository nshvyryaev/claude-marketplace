#!/usr/bin/env node
// PreToolUse hook for Bash, served by the plugin itself.
//
// Why this exists
// ---------------
// Until 0.6.0 the whole scaffold (entry + parser + patterns + observer) was copied into every
// project by `/pre-use-allow:pre-use-allow-init`. Only the *patterns* are project-specific; the
// parser is generic. Vendoring it meant parser fixes never reached projects that had already been
// initialised — one project ran a build that auto-approved `<allowed command> && rm -rf <dir>`
// months after that hole was closed elsewhere.
//
// So: the parser ships with the plugin and updates with it. The project owns only its patterns.
//
// Pattern lookup, first hit wins:
//   1. <project>/.claude/pre-use-allow/patterns.js      ← canonical from 0.6.0
//   2. <project>/.claude/hooks/approve-commands-patterns.js  ← pre-0.6.0 layout, still honoured
//
// A project with no patterns file gets no decision at all (normal permission prompts), which is
// the correct default for a project that never opted in.

const fs = require('fs');
const path = require('path');

const GC_MIN_LINES = 200;
const GC_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// A project that still has its own vendored entry point owns the decision — stand down so the
// two hooks cannot both answer for the same call.
const VENDORED_ENTRY = path.join(PROJECT_ROOT, '.claude', 'hooks', 'approve-commands.js');

const PATTERN_CANDIDATES = [
    path.join(PROJECT_ROOT, '.claude', 'pre-use-allow', 'patterns.js'),
    path.join(PROJECT_ROOT, '.claude', 'hooks', 'approve-commands-patterns.js'),
];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw || '{}'); } catch { return neutral(); }

    if (input?.tool_name !== 'Bash') return neutral();
    const cmd = input?.tool_input?.command;
    if (typeof cmd !== 'string') return neutral();

    if (fs.existsSync(VENDORED_ENTRY)) return neutral();

    const toolUseId = typeof input?.tool_use_id === 'string' ? input.tool_use_id : '';

    const segmentPatterns = loadPatterns();
    if (!segmentPatterns) return neutral();

    let isApproved;
    try {
        ({ isApproved } = require(path.join(__dirname, 'approve-commands-core.js')));
    } catch {
        return neutral(toolUseId, cmd);
    }
    if (typeof isApproved !== 'function') return neutral(toolUseId, cmd);

    let approved = false;
    try { approved = isApproved(cmd, segmentPatterns); } catch { approved = false; }

    if (!approved) return neutral(toolUseId, cmd);

    recordDecision(toolUseId, cmd, 'allow');
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'Matched pre-use-allow per-segment patterns',
        },
    }));
});

/** Load the project's segmentPatterns, or null when the project has none / the file is broken. */
function loadPatterns() {
    for (const candidate of PATTERN_CANDIDATES) {
        if (!fs.existsSync(candidate)) continue;
        try {
            const mod = require(candidate);
            const patterns = mod.segmentPatterns;
            if (Array.isArray(patterns)) return patterns;
            // A pre-0.4 file exporting APPROVED_PATTERNS is deliberately NOT accepted: those are
            // whole-command regexes and feeding them to the per-segment matcher would silently
            // change what they mean. Such a project keeps its vendored hook until it migrates.
        } catch {
            // fall through to the next candidate
        }
    }
    return null;
}

/** Emit "no opinion" and, when we know the call, log the verdict for the observer. */
function neutral(toolUseId, cmd) {
    if (typeof cmd === 'string') recordDecision(toolUseId || '', cmd, 'neutral');
    process.stdout.write('{}');
}

function recordDecision(toolUseId, cmd, verdict) {
    try {
        const dir = path.join(PROJECT_ROOT, '.claude', 'pre-use-allow');
        if (!fs.existsSync(dir)) return; // project hasn't opted into observation
        const filePath = path.join(dir, 'decisions.jsonl');
        fs.appendFileSync(filePath, JSON.stringify({
            tool_use_id: toolUseId,
            ts: new Date().toISOString(),
            cmd,
            verdict,
        }) + '\n');
        maybeGc(filePath);
    } catch {
        // best-effort — never fail the hook for an observer-side concern
    }
}

function maybeGc(filePath) {
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        if (lines.length < GC_MIN_LINES) return;
        const cutoff = Date.now() - GC_MAX_AGE_MS;
        const kept = lines.filter((line) => {
            try { return new Date(JSON.parse(line).ts).getTime() >= cutoff; } catch { return false; }
        });
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
        fs.renameSync(tmp, filePath);
    } catch {
        // best-effort
    }
}
