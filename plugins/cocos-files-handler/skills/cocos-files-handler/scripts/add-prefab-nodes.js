#!/usr/bin/env node
/**
 * add-prefab-nodes.js
 *
 * Inserts a node subtree into a Cocos Creator .prefab or .scene file from a
 * simple JSON spec. Handles all index management, fileId generation, and
 * meta file UUID resolution automatically.
 *
 * Usage:
 *   node tools/add-prefab-nodes.js --file <prefab> --spec <spec.json> [--dry-run]
 *
 * Spec JSON format:
 * {
 *   "parentPath": "Settings",           // node path like "Settings/BottomLayout" or "ROOT"
 *   "insertAt": "first",               // "first" | "last" | "after:<childName>"
 *   "idempotencyName": "LanguageSettings", // skip if child with this name exists
 *   "node": { ... }                    // node descriptor (see below)
 * }
 *
 * Node descriptor:
 * {
 *   "name": "MyNode",
 *   "active": true,
 *   "position": [x, y, z],
 *   "layer": 33554432,                 // optional, defaults to 33554432
 *   "components": [ <component-descriptor>, ... ],
 *   "children": [ <node-descriptor>, ... ]
 * }
 *
 * Component descriptors:
 *   UITransform:  {"type":"cc.UITransform","size":[w,h],"anchor":[x,y]}
 *   Sprite:       {"type":"cc.Sprite","spriteFrame":"UUID@f9941","spriteType":0,"color":[r,g,b,a]}
 *   Label:        {"type":"cc.Label","text":"Hello","fontSize":28,"font":"UUID","align":0}
 *   Layout:       {"type":"cc.Layout","layoutType":2,"resizeMode":1,"spacingY":30,"spacingX":0,
 *                  "verticalDirection":1}  // 0=BOTTOM_TO_TOP (default!), 1=TOP_TO_BOTTOM
 *   BlockInput:   {"type":"cc.BlockInputEvents"}
 *   LocalizedText:{"type":"meta","metaFile":"assets/scripts/Components/LocalizedText.ts.meta",
 *                  "translationKey":"ui.settings.language"}
 *   Custom:       {"type":"meta","metaFile":"path/to/Script.ts.meta",
 *                  "properties":{"loaderPrefab":{"prefabMeta":"assets/prefabs/Loader.prefab.meta"}}}
 *
 * Note: 'meta' components whose .meta file does not exist are SKIPPED with a warning.
 * Re-run this script after opening Cocos Creator to generate missing .meta files.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(name);
    return idx !== -1 ? args[idx + 1] : null;
}

const filePath = getArg('--file');
const specPath = getArg('--spec');
const dryRun = args.includes('--dry-run');

if (!filePath || !specPath) {
    console.error('Usage: node tools/add-prefab-nodes.js --file <prefab> --spec <spec.json> [--dry-run]');
    process.exit(1);
}

const ROOT = process.cwd();
const absFile = path.join(ROOT, filePath);
const absSpec = path.join(ROOT, specPath);

if (!fs.existsSync(absFile)) { console.error(`File not found: ${absFile}`); process.exit(1); }
if (!fs.existsSync(absSpec)) { console.error(`Spec not found: ${absSpec}`); process.exit(1); }

// ── UUID helpers ──────────────────────────────────────────────────────────────

/** Compress a full UUID (36 chars with hyphens) to Cocos compact 23-char format. */
function compressUuid(uuid) {
    const hex = uuid.replace(/-/g, '');   // 32 hex chars
    const prefix = hex.slice(0, 5);       // first 5 chars as-is
    const rest = hex.slice(5);            // remaining 27 hex chars = 108 bits
    // Convert 27 hex chars (108 bits) → 18 base64url chars
    let bits = BigInt('0x' + rest);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    for (let i = 0; i < 18; i++) {
        result = chars[Number(bits & 63n)] + result;
        bits >>= 6n;
    }
    return prefix + result;
}

/** Read a .meta file and return the compressed UUID. Returns null if file doesn't exist. */
function readMetaUuid(metaFilePath) {
    const absPath = path.isAbsolute(metaFilePath)
        ? metaFilePath
        : path.join(ROOT, metaFilePath);
    if (!fs.existsSync(absPath)) return null;
    const meta = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const uuid = meta.uuid;
    if (!uuid) throw new Error(`No uuid in meta file: ${absPath}`);
    return compressUuid(uuid);
}

/** Read a prefab .meta file to get the asset UUID for @property(Prefab) refs. */
function readPrefabAssetUuid(metaFilePath) {
    // Accept "assets/prefabs/Loader.prefab.meta" or "assets/prefabs/Loader.prefab"
    const candidates = [
        path.join(ROOT, metaFilePath),
        path.join(ROOT, metaFilePath + '.meta'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (meta.uuid) return meta.uuid;
        }
    }
    throw new Error(`Prefab meta file not found: ${metaFilePath}`);
}

// ── Random ID generation ──────────────────────────────────────────────────────

/** Generate a random 22-char ID for fileIds. */
function generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let id = '';
    for (let i = 0; i < 22; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

// ── Prefab traversal ──────────────────────────────────────────────────────────

/** Find a node index by path like "Settings/BottomLayout" or just "Settings". */
function findNodeByPath(objects, nodePath) {
    if (nodePath === 'ROOT') {
        for (let i = 0; i < objects.length; i++) {
            if (objects[i].__type__ === 'cc.Node' && !objects[i]._parent) return i;
        }
        return -1;
    }

    // Build parent-chain paths for all nodes
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.__type__ !== 'cc.Node') continue;

        // Build path by following parent chain
        let p = obj._name;
        let cur = obj;
        while (cur._parent && cur._parent.__id__ !== undefined) {
            const parentIdx = cur._parent.__id__;
            const parent = objects[parentIdx];
            if (!parent || !parent._name) break;
            p = parent._name + '/' + p;
            cur = parent;
            if (!cur._parent) break;
        }

        if (p === nodePath || obj._name === nodePath) return i;
    }
    return -1;
}

// ── Object builders ───────────────────────────────────────────────────────────

function makeCompPrefabInfo() {
    return { __type__: 'cc.CompPrefabInfo', fileId: generateId() };
}

function makePrefabInfo(rootIdx, assetIdx) {
    return {
        __type__: 'cc.PrefabInfo',
        root: { __id__: rootIdx },
        asset: { __id__: assetIdx },
        fileId: generateId(),
        instance: null,
        targetOverrides: null,
        nestedPrefabInstanceRoots: null,
    };
}

const makeVec3 = (x, y, z) => ({ __type__: 'cc.Vec3', x, y, z });
const makeQuat = () => ({ __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 });
const makeVec2 = (x, y) => ({ __type__: 'cc.Vec2', x, y });
const makeColor = (r, g, b, a) => ({ __type__: 'cc.Color', r, g, b, a });
const makeSize = (w, h) => ({ __type__: 'cc.Size', width: w, height: h });

// ── Component builders ────────────────────────────────────────────────────────

/**
 * Build objects for a single component descriptor.
 * Returns { objs: [...], compIdx: number } where compIdx is the index of the component itself.
 * Returns null if the component should be skipped (e.g. missing meta file).
 *
 * NOTE: nextIdx() MUST only be called AFTER a null-check for skip conditions.
 * This ensures no index slots are consumed for skipped components.
 */
function buildComponent(desc, nodeIdx, nextIdx) {
    if (desc.type === 'cc.UITransform') {
        const compIdx = nextIdx();
        const compPrefabIdx = nextIdx();
        const [w, h] = desc.size ?? [100, 100];
        const [ax, ay] = desc.anchor ?? [0.5, 0.5];
        return {
            compIdx,
            objs: [
                {
                    __type__: 'cc.UITransform',
                    _name: '', _objFlags: 0, __editorExtras__: {},
                    node: { __id__: nodeIdx },
                    _enabled: true,
                    __prefab: { __id__: compPrefabIdx },
                    _contentSize: makeSize(w, h),
                    _anchorPoint: makeVec2(ax, ay),
                    _id: '',
                },
                makeCompPrefabInfo(),
            ],
        };
    }

    if (desc.type === 'cc.Sprite') {
        const compIdx = nextIdx();
        const compPrefabIdx = nextIdx();
        const [r, g, b, a] = desc.color ?? [255, 255, 255, 255];
        return {
            compIdx,
            objs: [
                {
                    __type__: 'cc.Sprite',
                    _name: '', _objFlags: 0, __editorExtras__: {},
                    node: { __id__: nodeIdx },
                    _enabled: true,
                    __prefab: { __id__: compPrefabIdx },
                    _customMaterial: null,
                    _srcBlendFactor: 2,
                    _dstBlendFactor: 4,
                    _color: makeColor(r, g, b, a),
                    _spriteFrame: desc.spriteFrame
                        ? { __uuid__: desc.spriteFrame, __expectedType__: 'cc.SpriteFrame' }
                        : null,
                    _type: desc.spriteType ?? 0,
                    _fillType: 0, _sizeMode: 0,
                    _fillCenter: makeVec2(0, 0),
                    _fillStart: 0, _fillRange: 0,
                    _isTrimmedMode: true, _useGrayscale: false,
                    _atlas: null, _id: '',
                },
                makeCompPrefabInfo(),
            ],
        };
    }

    if (desc.type === 'cc.Label') {
        const compIdx = nextIdx();
        const compPrefabIdx = nextIdx();
        return {
            compIdx,
            objs: [
                {
                    __type__: 'cc.Label',
                    _name: '', _objFlags: 0, __editorExtras__: {},
                    node: { __id__: nodeIdx },
                    _enabled: true,
                    __prefab: { __id__: compPrefabIdx },
                    _customMaterial: null,
                    _srcBlendFactor: 2, _dstBlendFactor: 4,
                    _color: makeColor(255, 255, 255, 255),
                    _string: desc.text ?? '',
                    _horizontalAlign: desc.align ?? 0,
                    _verticalAlign: 1,
                    _actualFontSize: desc.fontSize ?? 28,
                    _fontSize: desc.fontSize ?? 28,
                    _fontFamily: 'Arial',
                    _lineHeight: desc.fontSize ?? 28,
                    _overflow: 0, _enableWrapText: true,
                    _font: desc.font
                        ? { __uuid__: desc.font, __expectedType__: 'cc.TTFFont' }
                        : null,
                    _isSystemFontUsed: !desc.font,
                    _spacingX: 0, _isItalic: false, _isBold: false,
                    _isUnderline: false, _underlineHeight: 2, _cacheMode: 0,
                    _enableOutline: false,
                    _outlineColor: makeColor(0, 0, 0, 255), _outlineWidth: 2,
                    _enableShadow: false,
                    _shadowColor: makeColor(0, 0, 0, 255),
                    _shadowOffset: makeVec2(2, 2), _shadowBlur: 2,
                    _id: '',
                },
                makeCompPrefabInfo(),
            ],
        };
    }

    if (desc.type === 'cc.Layout') {
        const compIdx = nextIdx();
        const compPrefabIdx = nextIdx();
        return {
            compIdx,
            objs: [
                {
                    __type__: 'cc.Layout',
                    _name: '', _objFlags: 0, __editorExtras__: {},
                    node: { __id__: nodeIdx },
                    _enabled: true,
                    __prefab: { __id__: compPrefabIdx },
                    _resizeMode: desc.resizeMode ?? 1,
                    _layoutType: desc.layoutType ?? 2,
                    _cellSize: makeSize(40, 40),
                    _startAxis: 0,
                    _paddingLeft: desc.paddingLeft ?? 0,
                    _paddingRight: desc.paddingRight ?? 0,
                    _paddingTop: desc.paddingTop ?? 0,
                    _paddingBottom: desc.paddingBottom ?? 0,
                    _spacingX: desc.spacingX ?? 0,
                    _spacingY: desc.spacingY ?? 0,
                    _verticalDirection: desc.verticalDirection ?? 0, _horizontalDirection: 0,
                    _constraint: 0, _constraintNum: 2,
                    _affectedByScale: false, _isAlign: false,
                    _id: '',
                },
                makeCompPrefabInfo(),
            ],
        };
    }

    if (desc.type === 'cc.BlockInputEvents') {
        const compIdx = nextIdx();
        const compPrefabIdx = nextIdx();
        return {
            compIdx,
            objs: [
                {
                    __type__: 'cc.BlockInputEvents',
                    _name: '', _objFlags: 0, __editorExtras__: {},
                    node: { __id__: nodeIdx },
                    _enabled: true,
                    __prefab: { __id__: compPrefabIdx },
                    _id: '',
                },
                makeCompPrefabInfo(),
            ],
        };
    }

    if (desc.type === 'meta') {
        // Check meta BEFORE consuming any index slots
        const compactType = readMetaUuid(desc.metaFile);
        if (compactType === null) {
            console.warn(`[add-prefab-nodes] SKIPPED: meta file not found: ${desc.metaFile}`);
            console.warn(`  → Open Cocos Creator to auto-generate .meta files, then re-run.`);
            return null; // Skip — no index consumed
        }

        const compIdx = nextIdx(); // Only now consume index
        const obj = {
            __type__: compactType,
            _name: '', _objFlags: 0, __editorExtras__: {},
            node: { __id__: nodeIdx },
            _enabled: true,
            __prefab: null,
            _id: generateId(),
        };
        if (desc.translationKey !== undefined) obj.translationKey = desc.translationKey;
        if (desc.properties) {
            for (const [key, val] of Object.entries(desc.properties)) {
                if (val && val.prefabMeta) {
                    obj[key] = { __uuid__: readPrefabAssetUuid(val.prefabMeta), __expectedType__: 'cc.Prefab' };
                } else {
                    obj[key] = val;
                }
            }
        }
        return { compIdx, objs: [obj] };
    }

    if (desc.type === 'cc.Graphics') {
        const compIdx = nextIdx();
        const compPrefabIdx = nextIdx();
        return {
            compIdx,
            objs: [
                {
                    __type__: 'cc.Graphics',
                    _name: '', _objFlags: 0, __editorExtras__: {},
                    node: { __id__: nodeIdx },
                    _enabled: true,
                    __prefab: { __id__: compPrefabIdx },
                    _customMaterial: null,
                    _srcBlendFactor: 2, _dstBlendFactor: 4,
                    _lineWidth: 1,
                    _strokeColor: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
                    _fillColor: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
                    _lineCap: 0, _lineJoin: 0, _miterLimit: 10,
                    _id: '',
                },
                makeCompPrefabInfo(),
            ],
        };
    }

    throw new Error(`Unknown component type: ${desc.type}`);
}

// ── Node builder ──────────────────────────────────────────────────────────────

/**
 * Build a flat list of Cocos prefab objects from a node descriptor tree.
 * Returns array of objects to append to the prefab JSON array.
 * The first element is the root node (at index = counter.value before call).
 */
function buildNodeSubtree(nodeDesc, parentNodeIdx, rootPrefabNodeIdx, assetIdx, counter) {
    function nextIdx() { return counter.value++; }

    function buildNode(desc, parentIdx) {
        const nodeIdx = nextIdx();
        const [px, py, pz] = desc.position ?? [0, 0, 0];

        // Build components
        const componentRefs = [];
        const componentObjects = [];
        for (const compDesc of (desc.components ?? [])) {
            const result = buildComponent(compDesc, nodeIdx, nextIdx);
            if (result === null) continue; // skipped
            componentRefs.push({ __id__: result.compIdx });
            componentObjects.push(...result.objs);
        }

        // Build children recursively
        const childRefs = [];
        const childObjects = [];
        for (const childDesc of (desc.children ?? [])) {
            const childIdx = counter.value; // index BEFORE building child
            childRefs.push({ __id__: childIdx });
            childObjects.push(...buildNode(childDesc, nodeIdx));
        }

        const prefabInfoIdx = nextIdx();

        const nodeObj = {
            __type__: 'cc.Node',
            _name: desc.name ?? 'Node',
            _objFlags: 0,
            __editorExtras__: {},
            _parent: parentIdx !== null ? { __id__: parentIdx } : null,
            _children: childRefs,
            _active: desc.active !== false,
            _components: componentRefs,
            _prefab: { __id__: prefabInfoIdx },
            _lpos: makeVec3(px, py, pz),
            _lrot: makeQuat(),
            _lscale: makeVec3(1, 1, 1),
            _mobility: 0,
            _layer: desc.layer ?? 33554432,
            _euler: makeVec3(0, 0, 0),
            _id: '',
        };

        const prefabInfoObj = makePrefabInfo(rootPrefabNodeIdx, assetIdx);

        // Order: [node, ...components, ...children, prefabInfo]
        return [nodeObj, ...componentObjects, ...childObjects, prefabInfoObj];
    }

    return buildNode(nodeDesc, parentNodeIdx);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const prefabArray = JSON.parse(fs.readFileSync(absFile, 'utf8'));
    const spec = JSON.parse(fs.readFileSync(absSpec, 'utf8'));

    // Find parent node
    const parentIdx = findNodeByPath(prefabArray, spec.parentPath ?? 'ROOT');
    if (parentIdx === -1) {
        console.error(`Parent node not found: "${spec.parentPath}"`);
        process.exit(1);
    }
    const parentNode = prefabArray[parentIdx];

    // Idempotency check
    if (spec.idempotencyName) {
        const exists = (parentNode._children ?? []).some(ref => {
            const child = prefabArray[ref.__id__];
            return child && child._name === spec.idempotencyName;
        });
        if (exists) {
            console.log(`[add-prefab-nodes] "${spec.idempotencyName}" already exists in "${spec.parentPath}". Skipping.`);
            return;
        }
    }

    // Resolve prefab root/asset indices
    const hasPrefabObj = prefabArray[0]?.__type__ === 'cc.Prefab';
    const assetIdx = hasPrefabObj ? 0 : 0;
    let rootPrefabNodeIdx = hasPrefabObj ? 1 : 0;
    if (!hasPrefabObj) {
        for (let i = 0; i < prefabArray.length; i++) {
            if (prefabArray[i].__type__ === 'cc.Node' && !prefabArray[i]._parent) {
                rootPrefabNodeIdx = i;
                break;
            }
        }
    }

    const counter = { value: prefabArray.length };
    const newRootIdx = counter.value;

    const newObjects = buildNodeSubtree(
        spec.node,
        parentIdx,
        rootPrefabNodeIdx,
        assetIdx,
        counter
    );

    console.log(`[add-prefab-nodes] Adding ${newObjects.length} objects starting at index ${newRootIdx}`);

    // Insert child reference into parent
    const insertAt = spec.insertAt ?? 'last';
    if (insertAt === 'first') {
        parentNode._children.unshift({ __id__: newRootIdx });
    } else if (typeof insertAt === 'string' && insertAt.startsWith('after:')) {
        const afterName = insertAt.slice('after:'.length);
        const afterIdx = (parentNode._children ?? []).findIndex(ref => {
            const child = prefabArray[ref.__id__];
            return child && child._name === afterName;
        });
        if (afterIdx === -1) {
            console.warn(`[add-prefab-nodes] "after:${afterName}" not found in parent, appending at end`);
            parentNode._children.push({ __id__: newRootIdx });
        } else {
            parentNode._children.splice(afterIdx + 1, 0, { __id__: newRootIdx });
        }
    } else {
        parentNode._children.push({ __id__: newRootIdx });
    }

    prefabArray.push(...newObjects);

    if (dryRun) {
        console.log('[add-prefab-nodes] DRY RUN — no file written.');
        console.log(`Parent "${spec.parentPath}" children after: ${JSON.stringify(parentNode._children)}`);
        return;
    }

    fs.writeFileSync(absFile, JSON.stringify(prefabArray, null, 2), 'utf8');
    console.log(`[add-prefab-nodes] Written to ${filePath} (${prefabArray.length} total objects)`);
}

main();
