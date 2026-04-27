#!/usr/bin/env node
// PreToolUse hook: deny direct Edit/Write/MultiEdit on Cocos .scene/.prefab files.
// Forces use of cocos-files-handler scripts instead.

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { process.stdout.write('{}'); return; }

  const filePath = input?.tool_input?.file_path;
  if (typeof filePath === 'string' && /\.(scene|prefab)$/i.test(filePath)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Use cocos-files-handler scripts (edit-prefab.js, add-component.js, ' +
          'patch-component-property.js, etc.) instead of editing .scene/.prefab files directly. ' +
          'See ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/SKILL.md.',
      },
    }));
    return;
  }
  process.stdout.write('{}');
});
