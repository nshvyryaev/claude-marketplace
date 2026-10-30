// Extract every file targeted by OpenCode V2 write/edit/patch tools.
// Patch operations can touch several files, so checking only input.path would
// let a patch bypass file guards.
export function toolFilePaths(tool, input = {}) {
  if (tool === 'write' || tool === 'edit') {
    return typeof input.path === 'string' ? [input.path] : [];
  }

  if (tool !== 'patch' || typeof input.patchText !== 'string') return [];

  const paths = [];
  for (const line of input.patchText.split(/\r?\n/)) {
    const match = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line)
      || /^\*\*\* Move to: (.+)$/.exec(line);
    if (match) paths.push(match[1].trim());
  }
  return [...new Set(paths)];
}
