#!/usr/bin/env node
// PostToolUse hook: after Claude writes a Cocos TypeScript file, run the static checks that
// tsc cannot catch (setActive, .json imports, edits to the generated tsconfig) and feed any
// findings back to the model so it fixes them in the same turn.
//
// PostToolUse runs after the write has landed, so this cannot deny the edit — it reports.
// `decision: "block"` here means "tell the model to deal with this", not "revert the file".

const path = require('path');

const { scanFile } = require(
    path.join(__dirname, '..', 'skills', 'cocos-files-handler', 'scripts', 'verify-cocos-code.js')
);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw || '{}'); } catch { process.stdout.write('{}'); return; }

    const filePath = input?.tool_input?.file_path;
    if (typeof filePath !== 'string') { process.stdout.write('{}'); return; }

    // Only TypeScript sources and the one generated file we care about.
    const isRelevant = /\.ts$/i.test(filePath) || /tsconfig\.cocos\.json$/i.test(filePath);
    if (!isRelevant) { process.stdout.write('{}'); return; }

    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);

    let findings = [];
    try { findings = scanFile(abs); } catch { process.stdout.write('{}'); return; }

    if (findings.length === 0) { process.stdout.write('{}'); return; }

    const lines = findings.map((f) => {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        const src = f.line ? `\n    ${f.text}` : '';
        return `- [${f.rule}] ${loc}${src}\n    → ${f.message}`;
    });

    const reason =
        `cocos-files-handler found ${findings.length} issue(s) in the file you just wrote. ` +
        `These are runtime/build failures that TypeScript does not catch — fix them now, ` +
        `before moving on:\n\n${lines.join('\n\n')}\n\n` +
        `If a finding is a genuine false positive, append \`// cocos-verify-ignore\` to that line.`;

    process.stdout.write(JSON.stringify({
        decision: 'block',
        reason,
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reason },
    }));
});
