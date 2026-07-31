#!/usr/bin/env node
/**
 * add-localized-text.js
 *
 * Reads a patches JSON (produced and filled in from extract-scene-strings.js)
 * and adds a LocalizedText component to each Label node in the specified
 * Cocos Creator scene/prefab files.
 *
 * Usage:
 *   node tools/add-localized-text.js \
 *     --meta assets/scripts/Components/LocalizedText.ts.meta \
 *     --patches tools/patches.json [--dry-run]
 *
 * Prerequisites:
 *   - LocalizedText.ts must exist and Cocos Creator must have generated its .meta file
 *   - patches.json must have all translationKey fields filled in (empty keys are skipped)
 *
 * The script is idempotent: if a LocalizedText component already exists on a node,
 * it skips that node.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function parseArgs() {
    const args = process.argv.slice(2);
    const result = { meta: null, patches: null, dryRun: false };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--meta') result.meta = args[++i];
        else if (args[i] === '--patches') result.patches = args[++i];
        else if (args[i] === '--dry-run') result.dryRun = true;
    }

    if (!result.meta || !result.patches) {
        console.error('Usage: node add-localized-text.js --meta <path> --patches <path> [--dry-run]');
        process.exit(1);
    }

    return result;
}

/**
 * Converts a full hyphenated UUID (from .meta file) to Cocos Creator's compact 23-char format.
 * Algorithm: first 5 hex chars pass-through, remaining 27 hex + '0' → base64 → first 18 chars.
 */
function compressUuid(uuid) {
    const hex = uuid.replace(/-/g, '');
    const tail = Buffer.from(hex.slice(5) + '0', 'hex').toString('base64').slice(0, 18);
    return hex.slice(0, 5) + tail;
}

function readMeta(metaPath) {
    const abs = path.resolve(ROOT_DIR, metaPath);
    if (!fs.existsSync(abs)) {
        console.error(`Meta file not found: ${abs}`);
        console.error('Make sure LocalizedText.ts exists and Cocos Creator has generated its .meta file.');
        process.exit(1);
    }
    const meta = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const uuid = meta.uuid;
    if (!uuid) {
        console.error('No uuid found in meta file');
        process.exit(1);
    }
    return compressUuid(uuid);
}

function generateId() {
    return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, c =>
        c === '+' ? '-' : c === '/' ? '_' : ''
    ).slice(0, 22);
}

function findOwnerNode(objects, componentIdx) {
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.__type__ !== 'cc.Node') continue;
        if (!Array.isArray(obj._components)) continue;
        if (obj._components.some(c => c.__id__ === componentIdx)) return i;
    }
    return -1;
}

function hasLocalizedText(objects, nodeIdx, localizedTextType) {
    const node = objects[nodeIdx];
    if (!Array.isArray(node._components)) return false;
    for (const ref of node._components) {
        const comp = objects[ref.__id__];
        if (comp && comp.__type__ === localizedTextType) return true;
    }
    return false;
}

function applyPatch(filePath, patches, localizedTextType, dryRun) {
    const abs = path.resolve(ROOT_DIR, filePath);
    if (!fs.existsSync(abs)) {
        console.warn(`  File not found: ${abs}`);
        return 0;
    }

    let objects;
    try {
        objects = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
        console.error(`  Failed to parse ${abs}: ${e.message}`);
        return 0;
    }

    if (!Array.isArray(objects)) {
        console.warn(`  Not a JSON array: ${abs}`);
        return 0;
    }

    let modified = 0;

    for (const patch of patches) {
        if (!patch.translationKey) {
            console.log(`  SKIP (no key): [${patch.labelObjectIndex}] "${patch.text}"`);
            continue;
        }

        const labelIdx = patch.labelObjectIndex;
        if (labelIdx >= objects.length || objects[labelIdx]?.__type__ !== 'cc.Label') {
            console.warn(`  SKIP: labelObjectIndex ${labelIdx} is not a cc.Label in ${filePath}`);
            continue;
        }

        const nodeIdx = findOwnerNode(objects, labelIdx);
        if (nodeIdx < 0) {
            console.warn(`  SKIP: could not find owner node for label at index ${labelIdx}`);
            continue;
        }

        if (hasLocalizedText(objects, nodeIdx, localizedTextType)) {
            console.log(`  SKIP (already has LocalizedText): node "${objects[nodeIdx]._name}" [${patch.labelObjectIndex}]`);
            continue;
        }

        const newCompIdx = objects.length;
        const newComp = {
            __type__: localizedTextType,
            _name: '',
            _objFlags: 0,
            __editorExtras__: {},
            node: { __id__: nodeIdx },
            _enabled: true,
            __prefab: null,
            translationKey: patch.translationKey,
            _id: generateId(),
        };

        objects.push(newComp);
        objects[nodeIdx]._components.push({ __id__: newCompIdx });

        console.log(`  ADD LocalizedText key="${patch.translationKey}" to node "${objects[nodeIdx]._name}" [idx=${nodeIdx}]`);
        modified++;
    }

    if (modified > 0 && !dryRun) {
        fs.writeFileSync(abs, JSON.stringify(objects, null, 2), 'utf8');
        console.log(`  Saved ${abs} (${modified} changes)`);
    } else if (dryRun && modified > 0) {
        console.log(`  [DRY RUN] Would save ${modified} changes to ${abs}`);
    }

    return modified;
}

const args = parseArgs();
const localizedTextType = readMeta(args.meta);
console.log(`LocalizedText UUID: ${localizedTextType}`);

const patchesPath = path.resolve(ROOT_DIR, args.patches);
if (!fs.existsSync(patchesPath)) {
    console.error(`Patches file not found: ${patchesPath}`);
    process.exit(1);
}

const allPatches = JSON.parse(fs.readFileSync(patchesPath, 'utf8'));

// Group patches by file
const byFile = {};
for (const patch of allPatches) {
    if (!patch.translationKey) continue;
    if (!byFile[patch.file]) byFile[patch.file] = [];
    byFile[patch.file].push(patch);
}

let totalModified = 0;

for (const [filePath, patches] of Object.entries(byFile)) {
    console.log(`\nProcessing: ${filePath}`);
    totalModified += applyPatch(filePath, patches, localizedTextType, args.dryRun);
}

console.log(`\nDone. Total changes: ${totalModified}`);
if (args.dryRun) console.log('(Dry run — no files written)');
