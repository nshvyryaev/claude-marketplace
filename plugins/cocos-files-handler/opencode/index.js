import path from 'node:path';
import { createRequire } from 'node:module';
import { toolFilePaths } from '../../../shared/opencode/tool-targets.mjs';

const require = createRequire(import.meta.url);
const { scanFile } = require('../skills/cocos-files-handler/scripts/verify-cocos-code.js');

const DIRECT_EDIT_REASON =
  'Use cocos-files-handler scripts (edit-prefab.js, add-component.js, '
  + 'patch-component-property.js, etc.) instead of editing .scene/.prefab files directly. '
  + 'See the cocos-files-handler skill (SKILL.md) for the full toolkit.';

function relevantSource(filePath) {
  return /\.ts$/i.test(filePath) || /tsconfig\.cocos\.json$/i.test(filePath);
}

export function verificationReason(findings) {
  if (findings.length === 0) return null;
  const lines = findings.map((finding) => {
    const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    const src = finding.line ? `\n    ${finding.text}` : '';
    return `- [${finding.rule}] ${loc}${src}\n    → ${finding.message}`;
  });
  return `cocos-files-handler found ${findings.length} issue(s) in the file(s) you just wrote. `
    + 'These are runtime/build failures that TypeScript does not catch — fix them now, '
    + `before moving on:\n\n${lines.join('\n\n')}\n\n`
    + 'If a finding is a genuine false positive, append `// cocos-verify-ignore` to that line.';
}

function appendContext(event, reason) {
  const content = Array.isArray(event.result?.content) ? event.result.content : [];
  event.result = {
    ...(event.result || {}),
    content: [...content, { type: 'text', text: reason }],
  };
}

const plugin = {
  id: 'cocos-files-handler',
  async setup(ctx) {
    const projectRoot = ctx.location.directory;

    await ctx.tool.hook('execute.before', (event) => {
      const paths = toolFilePaths(event.tool, event.input);
      if (paths.some((filePath) => /\.(scene|prefab)$/i.test(filePath))) {
        throw new Error(DIRECT_EDIT_REASON);
      }
    });

    await ctx.tool.hook('execute.after', (event) => {
      if (event.status !== 'completed') return;
      const findings = [];
      for (const filePath of toolFilePaths(event.tool, event.input)) {
        if (!relevantSource(filePath)) continue;
        const absolute = path.resolve(projectRoot, filePath);
        try {
          findings.push(...scanFile(absolute, projectRoot));
        } catch {
          // Match the Claude PostToolUse hook: a checker failure must not break
          // every subsequent write in the session.
        }
      }
      const reason = verificationReason(findings);
      if (reason) appendContext(event, reason);
    });
  },
};

export default plugin;
