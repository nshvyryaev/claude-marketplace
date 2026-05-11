#!/usr/bin/env node
/**
 * create-anim-clip.js — Creates a Cocos Creator cc.AnimationClip (.anim) plus
 * its companion .anim.meta from a sprite-atlas (.plist.meta) source.
 *
 * Picks every sprite-frame in the atlas whose name starts with --name-prefix,
 * sorts them lexicographically (frame names are usually zero-padded — e.g.
 * dragon-3-idle-00 → dragon-3-idle-11), and emits a single ObjectTrack on
 * cc.Sprite.spriteFrame with one keyframe per frame at i / sample seconds.
 *
 * Usage:
 *   node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/create-anim-clip.js \
 *     --atlas-meta assets/resources/pets/dragon/teen/dragon-3-idle.plist.meta \
 *     --name-prefix "dragon-3-idle-" \
 *     --out assets/resources/pets/dragon/teen/idle.anim \
 *     [--clip-name idle]      default: filename without .anim
 *     [--sample 60]           keyframe rate (FPS); defaults to 60
 *     [--speed 1]             playback speed multiplier; defaults to 1
 *     [--wrap-mode 2]         1=Normal, 2=Loop; defaults to 2
 *     [--force]               allow overwrite; preserves uuid from existing .anim.meta
 *     [--dry-run]
 *
 * By default, refuses to overwrite the .anim or its .meta — delete first if
 * regenerating. Pass --force to allow overwrite; it preserves the uuid from any
 * existing .anim.meta to avoid breaking downstream prefab references.
 *
 * After generating, Cocos Creator must reimport the asset (it picks up the
 * file on focus or on `Project → Refresh`).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── Argument parsing ──────────────────────────────────────────────────────────

function getArg(name, defaultValue) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? process.argv[i + 1] : defaultValue;
}
const hasFlag = name => process.argv.includes('--' + name);

const atlasMeta = getArg('atlas-meta', null);
const namePrefix = getArg('name-prefix', null);
const outPath    = getArg('out', null);
const clipNameArg = getArg('clip-name', null);
const sample     = Number(getArg('sample', '60'));
const speed      = Number(getArg('speed', '1'));
const wrapMode   = parseInt(getArg('wrap-mode', '2'), 10);
const dryRun     = hasFlag('dry-run');
const force      = hasFlag('force');

if (!atlasMeta || !namePrefix || !outPath) {
    console.error(
        'Usage: create-anim-clip.js \\\n' +
        '  --atlas-meta <path/to/atlas.plist.meta> \\\n' +
        '  --name-prefix "<frame name prefix>" \\\n' +
        '  --out <path/to/output.anim> \\\n' +
        '  [--clip-name <name>] [--sample 60] [--speed 1] [--wrap-mode 2] [--force] [--dry-run]'
    );
    process.exit(1);
}

if (!Number.isFinite(sample) || sample <= 0) {
    console.error(`--sample must be a positive number, got: ${sample}`);
    process.exit(1);
}
if (!Number.isFinite(speed) || speed <= 0) {
    console.error(`--speed must be a positive number, got: ${speed}`);
    process.exit(1);
}
if (!Number.isInteger(wrapMode)) {
    console.error(`--wrap-mode must be an integer, got: ${wrapMode}`);
    process.exit(1);
}
if (!outPath.endsWith('.anim')) {
    console.error(`--out must end with .anim, got: ${outPath}`);
    process.exit(1);
}

// ── Read atlas meta and collect matching frames ───────────────────────────────

const metaAbs = path.resolve(ROOT_DIR, atlasMeta);
if (!fs.existsSync(metaAbs)) {
    console.error(`Atlas meta not found: ${metaAbs}`);
    process.exit(1);
}

let meta;
try {
    meta = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
} catch (e) {
    console.error(`Failed to parse atlas meta: ${e.message}`);
    process.exit(1);
}

const subMetas = meta.subMetas || {};
const frames = [];
for (const id of Object.keys(subMetas)) {
    const sub = subMetas[id];
    if (!sub || sub.importer !== 'sprite-frame') continue;
    if (typeof sub.name !== 'string' || !sub.name.startsWith(namePrefix)) continue;
    if (typeof sub.uuid !== 'string') continue;
    frames.push({ uuid: sub.uuid, name: sub.name });
}

if (frames.length === 0) {
    console.error(
        `No sprite-frame subMetas in ${atlasMeta} match prefix "${namePrefix}".\n` +
        `Available frame names: ${Object.values(subMetas)
            .filter(s => s && s.importer === 'sprite-frame')
            .map(s => s.name)
            .join(', ')}`
    );
    process.exit(1);
}

frames.sort((a, b) => a.name.localeCompare(b.name));

// ── Build cc.AnimationClip object graph ───────────────────────────────────────

const clipName = clipNameArg || path.basename(outPath, '.anim');
const interval = 1 / sample;
const duration = frames.length * interval;
const times = frames.map((_, i) => i * interval);
const values = frames.map(f => ({
    __uuid__: f.uuid,
    __expectedType__: 'cc.SpriteFrame',
}));

// Layout follows the file written by Cocos Creator itself (see
// assets/resources/pets/dragon/baby/idle.anim for a reference).
const objects = [
    {
        __type__: 'cc.AnimationClip',
        _name: clipName,
        _objFlags: 0,
        __editorExtras__: { embeddedPlayerGroups: [] },
        _native: '',
        sample,
        speed,
        wrapMode,
        enableTrsBlending: false,
        _duration: duration,
        // _hash is editor-internal; Cocos recomputes on save. 0 is safe.
        _hash: 0,
        _tracks: [{ __id__: 1 }],
        _exoticAnimation: null,
        _events: [],
        _embeddedPlayers: [],
        _additiveSettings: { __id__: 6 },
        _auxiliaryCurveEntries: [],
    },
    {
        __type__: 'cc.animation.ObjectTrack',
        _binding: {
            __type__: 'cc.animation.TrackBinding',
            path: { __id__: 2 },
            proxy: null,
        },
        _channel: { __id__: 4 },
    },
    {
        __type__: 'cc.animation.TrackPath',
        _paths: [{ __id__: 3 }, 'spriteFrame'],
    },
    {
        __type__: 'cc.animation.ComponentPath',
        component: 'cc.Sprite',
    },
    {
        __type__: 'cc.animation.Channel',
        _curve: { __id__: 5 },
    },
    {
        __type__: 'cc.ObjectCurve',
        _times: times,
        _values: values,
    },
    {
        __type__: 'cc.AnimationClipAdditiveSettings',
        enabled: false,
        refClip: null,
    },
];

// ── Resolve output paths and check overwrite policy ───────────────────────────

const animAbs    = path.resolve(ROOT_DIR, outPath);
const metaOutAbs = animAbs + '.meta';

let preservedUuid = null;
if (fs.existsSync(animAbs) && !force) {
    console.error(`Refusing to overwrite existing file: ${animAbs}`);
    console.error('Delete it first, pick a different --out path, or pass --force.');
    process.exit(1);
}
if (fs.existsSync(metaOutAbs) && !force) {
    console.error(`Refusing to overwrite existing meta: ${metaOutAbs}`);
    process.exit(1);
}
if (force && fs.existsSync(metaOutAbs)) {
    try {
        const existing = JSON.parse(fs.readFileSync(metaOutAbs, 'utf8'));
        if (typeof existing.uuid === 'string' && existing.uuid.length > 0) {
            preservedUuid = existing.uuid;
        }
    } catch (e) {
        console.error(`Warning: could not parse existing meta ${metaOutAbs}: ${e.message}`);
    }
}

// ── Build .anim.meta sidecar ──────────────────────────────────────────────────

const animMeta = {
    ver: '2.0.4',
    importer: 'animation-clip',
    imported: true,
    uuid: preservedUuid || crypto.randomUUID(),
    files: ['.bin'],
    subMetas: {},
    userData: { name: clipName },
};

console.log(`Atlas:        ${atlasMeta}`);
console.log(`Frame prefix: "${namePrefix}" → ${frames.length} frame(s)`);
console.log(`Output:       ${outPath}`);
console.log(`Clip:         name="${clipName}" sample=${sample} speed=${speed} wrapMode=${wrapMode} duration=${duration.toFixed(6)}s`);
console.log(`UUID:         ${animMeta.uuid}`);
console.log(`Frames (in playback order):`);
for (let i = 0; i < frames.length; i++) {
    console.log(`  [${String(i).padStart(2, '0')}] ${frames[i].name}  →  ${frames[i].uuid}`);
}

if (dryRun) {
    console.log('[dry-run] No files written.');
    process.exit(0);
}

fs.mkdirSync(path.dirname(animAbs), { recursive: true });
fs.writeFileSync(animAbs, JSON.stringify(objects, null, 2));
fs.writeFileSync(metaOutAbs, JSON.stringify(animMeta, null, 2));

console.log(`\nWrote: ${animAbs}`);
console.log(`Wrote: ${metaOutAbs}`);
