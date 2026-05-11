#!/usr/bin/env node
/**
 * add-animation-clip.js — Idempotently appends a cc.AnimationClip __uuid__ to
 * the cc.Animation._clips array of a Cocos Creator prefab.
 *
 * Usage:
 *   node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/add-animation-clip.js \
 *     --file path/to/pet.prefab \
 *     --clip-uuid <animation-clip-uuid>
 *
 * Exits 0 (no-op) if the uuid is already present. Errors out if the prefab has
 * 0 or >1 cc.Animation components. Does not touch _defaultClip.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function getArg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? process.argv[i + 1] : def;
}

const filePath = getArg('file', null);
const clipUuid = getArg('clip-uuid', null);

if (!filePath || !clipUuid) {
    console.error(
        'Usage: add-animation-clip.js \\\n' +
        '  --file <path/to/prefab> \\\n' +
        '  --clip-uuid <animation-clip-uuid>'
    );
    process.exit(1);
}

const abs = path.resolve(ROOT_DIR, filePath);
if (!fs.existsSync(abs)) {
    console.error(`Prefab not found: ${abs}`);
    process.exit(1);
}

let data;
try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
} catch (e) {
    console.error(`Failed to parse prefab: ${e.message}`);
    process.exit(1);
}

if (!Array.isArray(data)) {
    console.error('Prefab top-level must be an array');
    process.exit(1);
}

const animations = data.filter(o => o && o.__type__ === 'cc.Animation');
if (animations.length === 0) {
    console.error('no cc.Animation component found in prefab');
    process.exit(1);
}
if (animations.length > 1) {
    console.error('multiple cc.Animation components found; not supported');
    process.exit(1);
}

const animation = animations[0];
if (!Array.isArray(animation._clips)) {
    console.error('cc.Animation._clips is not an array');
    process.exit(1);
}

const already = animation._clips.some(c => c && c.__uuid__ === clipUuid);
if (already) {
    console.log(`[no-op] ${clipUuid} already in _clips`);
    process.exit(0);
}

animation._clips.push({
    __uuid__: clipUuid,
    __expectedType__: 'cc.AnimationClip',
});

fs.writeFileSync(abs, JSON.stringify(data, null, 2));
console.log(`Added clip ${clipUuid} to ${filePath}`);
