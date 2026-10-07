#!/usr/bin/env node
/**
 * clone-scene.js — copies a Cocos Creator 3.x scene under a new asset uuid and
 * adds the copy to the build scene list.
 *
 * Usage:
 *   node clone-scene.js --file <src.scene> --out <dst.scene> [--name <SceneName>]
 *                       [--no-build] [--dry-run]
 *
 * What changes in the copy:
 *   - the scene asset uuid: a fresh one in <dst>.scene.meta, and every string
 *     equal to the old uuid inside the scene (cc.Scene._id, scene-local
 *     cc.PrefabInfo root/asset refs);
 *   - every non-empty node/component `_id` (22-char ids) — the editor keys nodes
 *     by them, two scenes sharing ids confuse it;
 *   - `_name` of cc.SceneAsset and cc.Scene (default: basename of --out).
 * Left as is: `__id__` indices, `fileId`s (local to a file, and nested prefab
 * overrides point at them), references to other assets.
 *
 * Build list: `profiles/v2/packages/builder.json` of the project. The copy goes
 * into `common.scenes` and into every build task whose scene list already has
 * the source scene — so a clone of a shipped scene ships too, and a dev-only
 * scene's clone stays out of platform builds. The file is the editor's: close
 * the editor (or reopen the build panel) so it does not overwrite the change.
 * `--no-build` skips this step.
 *
 * Idempotent: if <dst> already exists the copy is skipped, and only the build
 * list is brought up to date with the existing <dst>.scene.meta uuid.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const BUILDER_REL = path.join('profiles', 'v2', 'packages', 'builder.json');

// Same alphabet and length as add-prefab-nodes.js / create-prefab.js
function generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let id = '';
    for (let i = 0; i < 22; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function getArg(name, defaultValue) {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : defaultValue;
}
const hasFlag = name => argv.includes('--' + name);

const srcArg  = getArg('file', null);
const outArg  = getArg('out', null);
const noBuild = hasFlag('no-build');
const dryRun  = hasFlag('dry-run');

if (!srcArg || !outArg || !outArg.endsWith('.scene')) {
    console.error(
        'Usage: clone-scene.js --file <src.scene> --out <dst.scene> [--name <SceneName>]\n' +
        '  [--no-build] [--dry-run]'
    );
    process.exit(1);
}

const srcPath = path.resolve(ROOT, srcArg);
const outPath = path.resolve(ROOT, outArg);
const sceneName = getArg('name', path.basename(outPath, '.scene'));

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function dbUrl(absPath) {
    return 'db://' + path.relative(ROOT, absPath).split(path.sep).join('/');
}

if (!fs.existsSync(srcPath) || !fs.existsSync(srcPath + '.meta')) {
    console.error('Source scene or its .meta not found:', srcPath);
    process.exit(1);
}
const srcUuid = readJson(srcPath + '.meta').uuid;

// ── Clone ─────────────────────────────────────────────────────────────────────

let newUuid;

if (fs.existsSync(outPath)) {
    if (!fs.existsSync(outPath + '.meta')) {
        console.error('Target exists without .meta — open the editor to import it first:', outPath);
        process.exit(1);
    }
    newUuid = readJson(outPath + '.meta').uuid;
    console.log('Target already exists, copy skipped:', outPath);
} else {
    const objects = readJson(srcPath);
    if (!Array.isArray(objects) || objects[0]?.__type__ !== 'cc.SceneAsset') {
        console.error('Not a scene file (first object is not cc.SceneAsset):', srcPath);
        process.exit(1);
    }
    newUuid = crypto.randomUUID();

    // Old id → new id, applied to every string value so any by-id mention follows.
    const idMap = new Map([[srcUuid, newUuid]]);
    for (const obj of objects) {
        if (obj && typeof obj._id === 'string' && obj._id !== '' && obj._id !== srcUuid) {
            idMap.set(obj._id, generateId());
        }
    }
    const remap = value => {
        if (typeof value === 'string') return idMap.has(value) ? idMap.get(value) : value;
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === 'object') {
            const out = {};
            for (const k of Object.keys(value)) {
                out[k] = k === 'fileId' ? value[k] : remap(value[k]);
            }
            return out;
        }
        return value;
    };
    const cloned = remap(objects);
    for (const obj of cloned) {
        if (obj.__type__ === 'cc.SceneAsset' || obj.__type__ === 'cc.Scene') obj._name = sceneName;
    }

    const meta = readJson(srcPath + '.meta');
    meta.uuid = newUuid;

    if (dryRun) {
        console.log('[dry-run] Would create:', outPath, 'uuid', newUuid);
        console.log(`[dry-run] ${idMap.size - 1} node/component ids regenerated, name "${sceneName}"`);
    } else {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(cloned, null, 2));
        fs.writeFileSync(outPath + '.meta', JSON.stringify(meta, null, 2) + '\n');
        console.log('Created scene:', outPath, 'uuid', newUuid);
    }
}

// ── Build list ────────────────────────────────────────────────────────────────

if (noBuild) process.exit(0);

const builderPath = path.join(ROOT, BUILDER_REL);
if (!fs.existsSync(builderPath)) {
    console.warn('Build settings not found, scene not added to the build list:', builderPath);
    process.exit(0);
}

const builder = readJson(builderPath);
const entry = { url: dbUrl(outPath), uuid: newUuid };
const changed = [];

function addTo(list, label) {
    if (list.some(s => s.uuid === newUuid)) return;
    list.push({ ...entry });
    changed.push(label);
}

builder.common = builder.common || {};
builder.common.scenes = builder.common.scenes || [];
addTo(builder.common.scenes, 'common');

const tasks = builder.BuildTaskManager?.taskMap || {};
for (const [id, task] of Object.entries(tasks)) {
    const scenes = task.options?.scenes;
    if (Array.isArray(scenes) && scenes.some(s => s.uuid === srcUuid)) {
        addTo(scenes, `task ${task.options.taskName || task.options.outputName || id}`);
    }
}

if (changed.length === 0) {
    console.log('Build list already has the scene.');
} else if (dryRun) {
    console.log('[dry-run] Would add to build list:', changed.join(', '));
} else {
    fs.writeFileSync(builderPath, JSON.stringify(builder, null, 2));
    console.log('Added to build list:', changed.join(', '));
}
