#!/usr/bin/env node
/**
 * create-prefab.js — creates a new minimal Cocos Creator 3.x prefab file.
 *
 * Usage:
 *   node .claude/skills/scene-prefab-tools/scripts/create-prefab.js \
 *     --file <output.prefab> --name <RootNodeName> \
 *     [--width <w>]           default: 100
 *     [--height <h>]          default: 100
 *     [--anchor-x <ax>]       default: 0.5
 *     [--anchor-y <ay>]       default: 0.5
 *     [--active <true|false>] default: true
 *     [--sprite-frame <uuid@sub>]    adds a cc.Sprite to the root
 *     [--sprite-color <r,g,b,a>]     sprite tint (default: 255,255,255,255)
 *     [--dry-run]
 *
 * The file must NOT already exist. The script refuses to overwrite.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────────

// Same implementation as add-prefab-nodes.js — keeps IDs uniform across the suite
function generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let id = '';
    for (let i = 0; i < 22; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}
const makeVec3  = (x,y,z) => ({ __type__: 'cc.Vec3', x, y, z });
const makeVec2  = (x,y)   => ({ __type__: 'cc.Vec2', x, y });
const makeQuat  = ()      => ({ __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 });
const makeSize  = (w,h)   => ({ __type__: 'cc.Size', width: w, height: h });
const makeColor = (r,g,b,a) => ({ __type__: 'cc.Color', r, g, b, a });

// ── Argument parsing ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function getArg(name, defaultValue) {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : defaultValue;
}
const hasFlag = name => argv.includes('--' + name);

const outFile     = getArg('file',      null);
const rootName    = getArg('name',      null);
const width       = parseFloat(getArg('width',     '100'));
const height      = parseFloat(getArg('height',    '100'));
const anchorX     = parseFloat(getArg('anchor-x',  '0.5'));
const anchorY     = parseFloat(getArg('anchor-y',  '0.5'));
const active      = getArg('active', 'true') !== 'false';
const spriteFrame = getArg('sprite-frame', null);
const spriteColor = getArg('sprite-color', '255,255,255,255');
const dryRun      = hasFlag('dry-run');

if (!outFile || !rootName) {
    console.error(
        'Usage: create-prefab.js --file <path> --name <RootName>\n' +
        '  [--width w] [--height h] [--anchor-x ax] [--anchor-y ay]\n' +
        '  [--active true|false]\n' +
        '  [--sprite-frame uuid@sub] [--sprite-color r,g,b,a]\n' +
        '  [--dry-run]'
    );
    process.exit(1);
}

// ── Build prefab JSON array ───────────────────────────────────────────────────

const objects   = [];
const PREFAB    = 0;   // index of cc.Prefab
const ROOT_NODE = 1;   // index of root cc.Node
const rootComponentRefs = [];   // filled as we add components

// 0 — cc.Prefab
objects.push({
    __type__: 'cc.Prefab',
    _name: rootName,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    data: { __id__: ROOT_NODE },
    optimizationPolicy: 0,
    persistent: false,
});

// 1 — root cc.Node (placeholder; _prefab and _components filled below)
const rootNodeObj = {
    __type__: 'cc.Node',
    _name: rootName,
    _objFlags: 0,
    __editorExtras__: {},
    _parent: null,
    _children: [],
    _active: active,
    _components: rootComponentRefs,
    _prefab: null,          // filled after PrefabInfo is pushed
    _lpos: makeVec3(0, 0, 0),
    _lrot: makeQuat(),
    _lscale: makeVec3(1, 1, 1),
    _mobility: 0,
    _layer: 33554432,
    _euler: makeVec3(0, 0, 0),
    _id: '',
};
objects.push(rootNodeObj);   // index 1

// UITransform
const uitIdx      = objects.length;
const uitInfoIdx  = uitIdx + 1;
objects.push({
    __type__: 'cc.UITransform',
    _name: '', _objFlags: 0, __editorExtras__: {},
    node: { __id__: ROOT_NODE },
    _enabled: true,
    __prefab: { __id__: uitInfoIdx },
    _contentSize: makeSize(width, height),
    _anchorPoint: makeVec2(anchorX, anchorY),
    _id: '',
});
objects.push({ __type__: 'cc.CompPrefabInfo', fileId: generateId() });
rootComponentRefs.push({ __id__: uitIdx });

// Optional Sprite
if (spriteFrame) {
    const [r, g, b, a] = spriteColor.split(',').map(Number);
    const sprIdx     = objects.length;
    const sprInfoIdx = sprIdx + 1;
    objects.push({
        __type__: 'cc.Sprite',
        _name: '', _objFlags: 0, __editorExtras__: {},
        node: { __id__: ROOT_NODE },
        _enabled: true,
        __prefab: { __id__: sprInfoIdx },
        _customMaterial: null,
        _srcBlendFactor: 2,
        _dstBlendFactor: 4,
        _color: makeColor(r, g, b, a),
        _spriteFrame: { __uuid__: spriteFrame, __expectedType__: 'cc.SpriteFrame' },
        _type: 0, _fillType: 0, _sizeMode: 0,
        _fillCenter: makeVec2(0, 0), _fillStart: 0, _fillRange: 0,
        _isTrimmedMode: true, _useGrayscale: false, _atlas: null,
        _id: '',
    });
    objects.push({ __type__: 'cc.CompPrefabInfo', fileId: generateId() });
    rootComponentRefs.push({ __id__: sprIdx });
}

// PrefabInfo (must be last; root node's _prefab points here)
const prefabInfoIdx = objects.length;
objects.push({
    __type__: 'cc.PrefabInfo',
    root: { __id__: ROOT_NODE },
    asset: { __id__: PREFAB },
    fileId: generateId(),
    instance: null,
    targetOverrides: null,
    nestedPrefabInstanceRoots: null,
});
rootNodeObj._prefab = { __id__: prefabInfoIdx };

// ── Output ────────────────────────────────────────────────────────────────────

const json    = JSON.stringify(objects, null, 2);
const absPath = path.resolve(outFile);

if (dryRun) {
    console.log('[dry-run] Would create:', absPath);
    console.log(json.slice(0, 400) + '\n...');
    process.exit(0);
}

if (fs.existsSync(absPath)) {
    console.error('File already exists:', absPath);
    console.error('Delete it first or choose a different path.');
    process.exit(1);
}

fs.mkdirSync(path.dirname(absPath), { recursive: true });
fs.writeFileSync(absPath, json);
console.log('Created prefab:', absPath);
