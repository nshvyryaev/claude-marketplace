import fs from 'node:fs';
import path from 'node:path';
import { parseCriteria, isLocked } from '../scripts/lib/criteria.mjs';
import { toolFilePaths } from '../../../shared/opencode/tool-targets.mjs';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..');
const ACCEPTANCE_CLI = path.join(PLUGIN_ROOT, 'scripts', 'acceptance.mjs');

function statusFromRawText(text) {
  for (const line of text.split('\n').slice(0, 20)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('status:')) return trimmed.slice('status:'.length).trim();
  }
  return null;
}

// Preserve the Claude hook's fail-open behaviour, except that a visible locked
// status still fails closed when the criteria file cannot be parsed.
export function acceptanceViolation(projectRoot, filePath) {
  const resolved = path.resolve(projectRoot, filePath);
  const acceptanceDir = path.resolve(projectRoot, 'docs', 'acceptance');
  if (resolved !== acceptanceDir && !resolved.startsWith(acceptanceDir + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;

  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }

  let status;
  try {
    status = parseCriteria(text).meta.status;
  } catch {
    status = statusFromRawText(text);
    if (status === null || !isLocked(status)) return null;
  }
  if (!isLocked(status)) return null;

  const relative = path.relative(projectRoot, resolved);
  const slug = path.basename(resolved).replace(/[.]md$/, '');
  return `Файл критериев ${relative} в статусе «${status}» и правке не подлежит.\n\n`
    + 'Если критерий действительно требует изменения, сначала разморозьте его с записью причины:\n'
    + `  node "${ACCEPTANCE_CLI}" unfreeze ${slug} --reason "почему критерий меняется"\n\n`
    + 'Разморозка возвращает файл в draft, и работу придётся подтверждать заново.';
}

const plugin = {
  id: 'acceptance',
  async setup(ctx) {
    const projectRoot = ctx.location.directory;
    await ctx.tool.hook('execute.before', (event) => {
      for (const filePath of toolFilePaths(event.tool, event.input)) {
        const reason = acceptanceViolation(projectRoot, filePath);
        if (reason) throw new Error(reason);
      }
    });
  },
};

export default plugin;
