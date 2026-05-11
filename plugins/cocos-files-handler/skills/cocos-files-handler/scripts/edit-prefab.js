#!/usr/bin/env node
/**
 * edit-prefab.js
 *
 * Applies a sequence of structural edits to a Cocos Creator .scene or .prefab file.
 * Operations are supplied as a JSON document: either a raw array of op objects,
 * or an object with an `ops` array.
 *
 * Usage:
 *   node .claude/skills/scene-prefab-tools/scripts/edit-prefab.js \
 *     --file assets/prefabs/Player.prefab \
 *     --ops  path/to/ops.json \
 *     [--dry-run]
 *
 * Supported ops:
 *
 *   { "op": "resize-uitransform",
 *     "node": "Player",
 *     "size": [32, 32],
 *     "anchor": [0.5, 0.5]         // optional
 *   }
 *
 *   { "op": "create-node",
 *     "name": "PlayerBackground",
 *     "parent": "Player",
 *     "position": [0, 0, 0],       // optional, default [0,0,0]
 *     "insertAt": "first",         // "first" | "last" | "after:ChildName", default "last"
 *     "uitransform": {             // optional; if present, adds a UITransform to the new node
 *       "size": [62, 62],
 *       "anchor": [0.5, 0.5]       // optional, default [0.5, 0.5]
 *     },
 *     "sprite": {                  // optional; adds a cc.Sprite
 *       "spriteFrameMeta": "assets/resources/sprites/foo.png.meta",
 *                                  // OR "spriteFrameUuid": "<mainUuid>@<subKey>"
 *       "color": [255, 255, 255, 255]  // optional
 *     },
 *     "uiOpacity": 255             // optional; adds cc.UIOpacity with given opacity (0..255)
 *   }
 *
 *   { "op": "delete-node",
 *     "node": "PlayerForeground"  // deletes node, descendants, their components and prefab-info;
 *                                 // rewrites all __id__ references in the file.
 *   }
 *
 *   { "op": "set-node-active",
 *     "node": "EvolutionCutscene",
 *     "active": true               // sets node._active (the serialized active flag)
 *   }
 *
 *   { "op": "move-component",
 *     "from": "Player",
 *     "to":   "PlayerBackground",
 *     "componentType": "cc.Sprite" // built-in type string, OR "meta:path/to/Script.ts.meta"
 *   }
 *
 *   { "op": "reparent",
 *     "node": "SomeChild",
 *     "newParent": "OtherParent",
 *     "insertAt": "last"           // optional, same syntax as create-node
 *   }
 *
 * Nodes are looked up by name within the file. Names must be unique among
 * the nodes you reference.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
    const argv = process.argv.slice(2);
    const result = { file: null, ops: null, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--file':    result.file   = argv[++i]; break;
            case '--ops':     result.ops    = argv[++i]; break;
            case '--dry-run': result.dryRun = true;      break;
            case '-h':
            case '--help':
                printUsage();
                process.exit(0);
        }
    }
    if (!result.file || !result.ops) {
        printUsage();
        process.exit(1);
    }
    return result;
}

function printUsage() {
    console.error(
        'Usage: node .claude/skills/scene-prefab-tools/scripts/edit-prefab.js \\\n' +
        '  --file <scene-or-prefab> \\\n' +
        '  --ops  <path/to/ops.json> \\\n' +
        '  [--dry-run]\n' +
        '\n' +
        'ops.json: either a JSON array of op objects, or {"ops": [...]}\n' +
        'Supported ops: resize-uitransform, create-node, move-component, reparent.\n' +
        'See the script header for the full schema.'
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function compressUuid(uuid) {
    const hex = uuid.replace(/-/g, '');
    const tail = Buffer.from(hex.slice(5) + '0', 'hex').toString('base64').slice(0, 18);
    return hex.slice(0, 5) + tail;
}

function readMetaUuid(metaPath) {
    if (!fs.existsSync(metaPath)) {
        throw new Error(`Meta file not found: ${metaPath}`);
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!meta.uuid) throw new Error(`No "uuid" field in meta file: ${metaPath}`);
    return meta.uuid;
}

function randomFileId() {
    return crypto.randomBytes(16).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, 22);
}

function findNodeIndex(arr, nameOrPath) {
    // Path form "Parent/Child/Grandchild" — resolves segment-by-segment, requires
    // each step to be unique among children of the previous node. Useful when
    // a leaf name (e.g. "Label", "Frame") is ambiguous globally.
    if (nameOrPath.includes('/')) {
        const segments = nameOrPath.split('/').filter((s) => s.length > 0);
        if (segments.length === 0) throw new Error(`Node "${nameOrPath}" — empty path`);
        let currentId = findNodeIndex(arr, segments[0]); // recurse for first segment (still requires uniqueness)
        for (let s = 1; s < segments.length; s++) {
            const segName = segments[s];
            const node = arr[currentId];
            const childMatches = [];
            for (const ref of node._children || []) {
                if (!ref || ref.__id__ == null) continue;
                const child = arr[ref.__id__];
                if (child && child.__type__ === 'cc.Node' && child._name === segName) {
                    childMatches.push(ref.__id__);
                }
            }
            if (childMatches.length === 0) {
                throw new Error(`Node "${nameOrPath}" — segment "${segName}" not found under "${segments[s - 1]}"`);
            }
            if (childMatches.length > 1) {
                throw new Error(`Node "${nameOrPath}" — segment "${segName}" is ambiguous (${childMatches.length} matches under "${segments[s - 1]}")`);
            }
            currentId = childMatches[0];
        }
        return currentId;
    }

    const matches = [];
    for (let i = 0; i < arr.length; i++) {
        const o = arr[i];
        if (o && o.__type__ === 'cc.Node' && o._name === nameOrPath) matches.push(i);
    }
    if (matches.length === 0) throw new Error(`Node "${nameOrPath}" not found`);
    if (matches.length > 1) throw new Error(`Node "${nameOrPath}" is ambiguous (${matches.length} matches) — use a path "Parent/Child" to disambiguate`);
    return matches[0];
}

function findUITransform(arr, nodeId) {
    const node = arr[nodeId];
    for (const ref of node._components || []) {
        const c = arr[ref.__id__];
        if (c && c.__type__ === 'cc.UITransform' && c.node && c.node.__id__ === nodeId) {
            return ref.__id__;
        }
    }
    return -1;
}

/** Resolve a componentType spec into a concrete __type__ string used in the file. */
function resolveComponentType(spec) {
    if (typeof spec !== 'string') throw new Error(`componentType must be a string`);
    if (spec.startsWith('meta:')) {
        const metaPath = spec.slice(5);
        return compressUuid(readMetaUuid(metaPath));
    }
    return spec; // built-in type, e.g. "cc.Sprite"
}

function isPrefab(arr) {
    return arr.some(o => o && o.__type__ === 'cc.Prefab');
}

/** Find the prefab's root cc.Node id via cc.Prefab.data. */
function findPrefabRootId(arr) {
    const prefab = arr.find(o => o && o.__type__ === 'cc.Prefab');
    return prefab && prefab.data && prefab.data.__id__;
}

function insertChildRef(parent, childRef, insertAt, arr) {
    parent._children = parent._children || [];
    if (!insertAt || insertAt === 'last') {
        parent._children.push(childRef);
        return;
    }
    if (insertAt === 'first') {
        parent._children.unshift(childRef);
        return;
    }
    if (insertAt.startsWith('after:')) {
        const afterName = insertAt.slice('after:'.length);
        const idx = parent._children.findIndex(ref => {
            const n = arr[ref.__id__];
            return n && n._name === afterName;
        });
        if (idx < 0) throw new Error(`insertAt "after:${afterName}": sibling not found`);
        parent._children.splice(idx + 1, 0, childRef);
        return;
    }
    throw new Error(`Unknown insertAt: ${insertAt}`);
}

// ── Ops ───────────────────────────────────────────────────────────────────────

function opResizeUITransform(arr, op) {
    const nodeId = findNodeIndex(arr, op.node);
    const utId = findUITransform(arr, nodeId);
    if (utId < 0) throw new Error(`Node "${op.node}" has no UITransform`);
    if (!Array.isArray(op.size) || op.size.length !== 2) {
        throw new Error(`resize-uitransform: "size" must be [width, height]`);
    }
    const ut = arr[utId];
    const oldW = ut._contentSize.width, oldH = ut._contentSize.height;
    ut._contentSize = { __type__: 'cc.Size', width: op.size[0], height: op.size[1] };
    let msg = `resize-uitransform "${op.node}": ${oldW}x${oldH} → ${op.size[0]}x${op.size[1]}`;
    if (Array.isArray(op.anchor) && op.anchor.length === 2) {
        ut._anchorPoint = { __type__: 'cc.Vec2', x: op.anchor[0], y: op.anchor[1] };
        msg += `, anchor → ${op.anchor[0]},${op.anchor[1]}`;
    }
    console.log('  ' + msg);
}

function resolveSpriteFrameUuid(spriteSpec) {
    if (spriteSpec.spriteFrameUuid) return spriteSpec.spriteFrameUuid;
    if (!spriteSpec.spriteFrameMeta) {
        throw new Error(`create-node: sprite needs "spriteFrameMeta" or "spriteFrameUuid"`);
    }
    const meta = JSON.parse(fs.readFileSync(spriteSpec.spriteFrameMeta, 'utf8'));
    if (!meta.uuid) throw new Error(`No uuid in meta: ${spriteSpec.spriteFrameMeta}`);
    const subs = meta.subMetas || {};
    let subKey = null;
    for (const key of Object.keys(subs)) {
        if (subs[key] && subs[key].importer === 'sprite-frame') { subKey = key; break; }
    }
    if (!subKey) throw new Error(`No sprite-frame subMeta in ${spriteSpec.spriteFrameMeta}`);
    return `${meta.uuid}@${subKey}`;
}

function opCreateNode(arr, op) {
    if (!op.name) throw new Error(`create-node: "name" is required`);
    if (!op.parent) throw new Error(`create-node: "parent" is required`);
    const parentId = findNodeIndex(arr, op.parent);

    // Idempotency: skip if parent already has a child with this name.
    const parent = arr[parentId];
    for (const ref of parent._children || []) {
        if (arr[ref.__id__] && arr[ref.__id__]._name === op.name) {
            console.log(`  create-node "${op.name}": already present, skipping`);
            return;
        }
    }

    const fileIsPrefab = isPrefab(arr);
    const prefabRootId = fileIsPrefab ? findPrefabRootId(arr) : null;
    const pos = op.position || [0, 0, 0];

    // Plan: compute the ids of the new node and every component/prefab-info
    // we're about to push, so cross-references resolve correctly.
    const newNodeId = arr.length;
    const plan = [];
    plan.push({ kind: 'node' });
    if (op.uitransform) {
        plan.push({ kind: 'ut' });
        if (fileIsPrefab) plan.push({ kind: 'ut-info' });
    }
    if (op.sprite) {
        plan.push({ kind: 'sprite' });
        if (fileIsPrefab) plan.push({ kind: 'sprite-info' });
    }
    if (op.uiOpacity !== undefined) {
        plan.push({ kind: 'uiop' });
        if (fileIsPrefab) plan.push({ kind: 'uiop-info' });
    }
    if (fileIsPrefab) plan.push({ kind: 'node-info' });

    const idOf = (kind) => newNodeId + plan.findIndex(p => p.kind === kind);

    const components = [];
    if (op.uitransform) components.push({ __id__: idOf('ut') });
    if (op.sprite)      components.push({ __id__: idOf('sprite') });
    if (op.uiOpacity !== undefined) components.push({ __id__: idOf('uiop') });

    const newNode = {
        __type__: 'cc.Node',
        _name: op.name,
        _objFlags: 0,
        __editorExtras__: {},
        _parent: { __id__: parentId },
        _children: [],
        _active: true,
        _components: components,
        _prefab: fileIsPrefab ? { __id__: idOf('node-info') } : null,
        _lpos: { __type__: 'cc.Vec3', x: pos[0], y: pos[1], z: pos[2] },
        _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
        _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
        _mobility: 0,
        _layer: 33554432,
        _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _id: '',
    };
    arr.push(newNode);

    if (op.uitransform) {
        const anchor = op.uitransform.anchor || [0.5, 0.5];
        arr.push({
            __type__: 'cc.UITransform',
            _name: '',
            _objFlags: 0,
            __editorExtras__: {},
            node: { __id__: newNodeId },
            _enabled: true,
            __prefab: fileIsPrefab ? { __id__: idOf('ut-info') } : null,
            _contentSize: { __type__: 'cc.Size', width: op.uitransform.size[0], height: op.uitransform.size[1] },
            _anchorPoint: { __type__: 'cc.Vec2', x: anchor[0], y: anchor[1] },
            _id: '',
        });
        if (fileIsPrefab) arr.push({ __type__: 'cc.CompPrefabInfo', fileId: randomFileId() });
    }

    if (op.sprite) {
        const sfUuid = resolveSpriteFrameUuid(op.sprite);
        const color = op.sprite.color || [255, 255, 255, 255];
        arr.push({
            __type__: 'cc.Sprite',
            _name: '',
            _objFlags: 0,
            __editorExtras__: {},
            node: { __id__: newNodeId },
            _enabled: true,
            __prefab: fileIsPrefab ? { __id__: idOf('sprite-info') } : null,
            _customMaterial: null,
            _srcBlendFactor: 2,
            _dstBlendFactor: 4,
            _color: { __type__: 'cc.Color', r: color[0], g: color[1], b: color[2], a: color[3] },
            _spriteFrame: { __uuid__: sfUuid, __expectedType__: 'cc.SpriteFrame' },
            _type: 0,
            _fillType: 0,
            _sizeMode: 1,
            _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
            _fillStart: 0,
            _fillRange: 0,
            _isTrimmedMode: true,
            _useGrayscale: false,
            _atlas: null,
            _id: '',
        });
        if (fileIsPrefab) arr.push({ __type__: 'cc.CompPrefabInfo', fileId: randomFileId() });
    }

    if (op.uiOpacity !== undefined) {
        arr.push({
            __type__: 'cc.UIOpacity',
            _name: '',
            _objFlags: 0,
            __editorExtras__: {},
            node: { __id__: newNodeId },
            _enabled: true,
            __prefab: fileIsPrefab ? { __id__: idOf('uiop-info') } : null,
            _opacity: op.uiOpacity,
            _id: '',
        });
        if (fileIsPrefab) arr.push({ __type__: 'cc.CompPrefabInfo', fileId: randomFileId() });
    }

    if (fileIsPrefab) {
        arr.push({
            __type__: 'cc.PrefabInfo',
            root: { __id__: prefabRootId },
            asset: { __id__: 0 },
            fileId: randomFileId(),
            instance: null,
            targetOverrides: null,
            nestedPrefabInstanceRoots: null,
        });
    }

    insertChildRef(parent, { __id__: newNodeId }, op.insertAt, arr);

    let msg = `create-node "${op.name}" under "${op.parent}" at id ${newNodeId}`;
    if (op.uitransform) msg += ` +UITransform ${op.uitransform.size[0]}x${op.uitransform.size[1]}`;
    if (op.sprite)      msg += ` +Sprite`;
    if (op.uiOpacity !== undefined) msg += ` +UIOpacity ${op.uiOpacity}`;
    console.log('  ' + msg);
}

function opDeleteNode(arr, op) {
    if (!op.node) throw new Error(`delete-node: "node" is required`);
    const nodeId = findNodeIndex(arr, op.node);

    // Collect all objects to delete: descendant nodes + their components + prefab-infos.
    const toDelete = new Set();
    const queue = [nodeId];
    while (queue.length) {
        const id = queue.shift();
        if (toDelete.has(id)) continue;
        toDelete.add(id);
        const n = arr[id];
        if (!n || n.__type__ !== 'cc.Node') continue;
        for (const ref of n._components || []) {
            if (ref && ref.__id__ != null && !toDelete.has(ref.__id__)) {
                toDelete.add(ref.__id__);
                const comp = arr[ref.__id__];
                if (comp && comp.__prefab && comp.__prefab.__id__ != null) {
                    toDelete.add(comp.__prefab.__id__);
                }
            }
        }
        if (n._prefab && n._prefab.__id__ != null) toDelete.add(n._prefab.__id__);
        for (const childRef of n._children || []) {
            if (childRef && childRef.__id__ != null) queue.push(childRef.__id__);
        }
    }

    // Unlink from parent's _children.
    const node = arr[nodeId];
    if (node._parent && node._parent.__id__ != null) {
        const parent = arr[node._parent.__id__];
        if (parent && Array.isArray(parent._children)) {
            parent._children = parent._children.filter(r => r.__id__ !== nodeId);
        }
    }

    // Build remap old→new for retained objects.
    const remap = new Array(arr.length);
    let newIdx = 0;
    for (let i = 0; i < arr.length; i++) {
        if (toDelete.has(i)) { remap[i] = -1; continue; }
        remap[i] = newIdx++;
    }

    // Rewrite all __id__ references in retained objects.
    function rewrite(value) {
        if (value == null) return value;
        if (Array.isArray(value)) {
            for (let i = value.length - 1; i >= 0; i--) {
                const v = value[i];
                if (v && typeof v === 'object' && typeof v.__id__ === 'number') {
                    const mapped = remap[v.__id__];
                    if (mapped < 0) { value.splice(i, 1); continue; }
                    v.__id__ = mapped;
                } else {
                    rewrite(v);
                }
            }
            return value;
        }
        if (typeof value === 'object') {
            for (const k of Object.keys(value)) {
                const v = value[k];
                if (v && typeof v === 'object' && typeof v.__id__ === 'number' && Object.keys(v).length === 1) {
                    const mapped = remap[v.__id__];
                    if (mapped < 0) { value[k] = null; continue; }
                    v.__id__ = mapped;
                } else {
                    rewrite(v);
                }
            }
        }
        return value;
    }

    const retained = [];
    for (let i = 0; i < arr.length; i++) {
        if (!toDelete.has(i)) retained.push(arr[i]);
    }
    for (const obj of retained) rewrite(obj);

    arr.length = 0;
    for (const o of retained) arr.push(o);

    console.log(`  delete-node "${op.node}": removed ${toDelete.size} objects (node + descendants + components)`);
}

function opMoveComponent(arr, op) {
    if (!op.from || !op.to || !op.componentType) {
        throw new Error(`move-component: "from", "to", and "componentType" are required`);
    }
    const fromId = findNodeIndex(arr, op.from);
    const toId = findNodeIndex(arr, op.to);
    const typeStr = resolveComponentType(op.componentType);

    const fromNode = arr[fromId];
    const toNode = arr[toId];

    const idx = (fromNode._components || []).findIndex(ref => {
        const c = arr[ref.__id__];
        return c && c.__type__ === typeStr;
    });
    if (idx < 0) throw new Error(`move-component: ${op.componentType} not found on "${op.from}"`);
    const ref = fromNode._components[idx];

    // Idempotency: if the component is already on `to` (because of a previous run),
    // warn but don't duplicate.
    const alreadyOnTarget = (toNode._components || []).some(r => r.__id__ === ref.__id__);
    if (alreadyOnTarget) {
        console.log(`  move-component ${op.componentType} "${op.from}" → "${op.to}": already on target`);
        return;
    }

    fromNode._components.splice(idx, 1);
    toNode._components = toNode._components || [];
    toNode._components.push(ref);
    arr[ref.__id__].node = { __id__: toId };

    console.log(`  move-component ${op.componentType} "${op.from}" → "${op.to}" (comp id ${ref.__id__})`);
}

function opReparent(arr, op) {
    if (!op.node || !op.newParent) {
        throw new Error(`reparent: "node" and "newParent" are required`);
    }
    const nodeId = findNodeIndex(arr, op.node);
    const newParentId = findNodeIndex(arr, op.newParent);
    const node = arr[nodeId];
    const oldParentRef = node._parent;
    if (oldParentRef && oldParentRef.__id__ != null) {
        const oldParent = arr[oldParentRef.__id__];
        if (oldParent && oldParent._children) {
            oldParent._children = oldParent._children.filter(r => r.__id__ !== nodeId);
        }
    }
    node._parent = { __id__: newParentId };
    insertChildRef(arr[newParentId], { __id__: nodeId }, op.insertAt, arr);
    console.log(`  reparent "${op.node}" → "${op.newParent}"`);
}

/**
 * set-position: sets the local position (_lpos) of a node.
 *   { "op": "set-position", "node": "MyNode", "position": [x, y, z] }
 * z defaults to 0 if not supplied (i.e. "position" may be [x, y]).
 */
function opSetPosition(arr, op) {
    if (!op.node) throw new Error(`set-position: "node" is required`);
    if (!Array.isArray(op.position) || op.position.length < 2) {
        throw new Error(`set-position: "position" must be [x, y] or [x, y, z]`);
    }
    const nodeId = findNodeIndex(arr, op.node);
    const node = arr[nodeId];
    const [x, y, z = 0] = op.position;
    const old = node._lpos || {};
    node._lpos = { __type__: 'cc.Vec3', x, y, z };
    // Keep _euler in sync (only z matters for 2D UI, usually 0)
    if (!node._euler) node._euler = { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 };
    console.log(`  set-position "${op.node}": (${old.x ?? 0},${old.y ?? 0},${old.z ?? 0}) → (${x},${y},${z})`);
}

function opSetNodeActive(arr, op) {
    if (!op.node) throw new Error(`set-node-active: "node" is required`);
    if (typeof op.active !== 'boolean') {
        throw new Error(`set-node-active: "active" must be a boolean`);
    }
    const nodeId = findNodeIndex(arr, op.node);
    const node = arr[nodeId];
    const old = node._active;
    node._active = op.active;
    console.log(`  set-node-active "${op.node}": ${old} → ${op.active}`);
}

const OPS = {
    'resize-uitransform': opResizeUITransform,
    'create-node':        opCreateNode,
    'delete-node':        opDeleteNode,
    'move-component':     opMoveComponent,
    'reparent':           opReparent,
    'set-position':       opSetPosition,
    'set-node-active':    opSetNodeActive,
};

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const args = parseArgs();

    if (!fs.existsSync(args.file)) {
        console.error(`File not found: ${args.file}`);
        process.exit(1);
    }
    if (!fs.existsSync(args.ops)) {
        console.error(`Ops file not found: ${args.ops}`);
        process.exit(1);
    }

    const arr = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    if (!Array.isArray(arr)) {
        console.error(`${args.file} is not a JSON array — not a valid Cocos scene/prefab.`);
        process.exit(1);
    }

    let opsDoc = JSON.parse(fs.readFileSync(args.ops, 'utf8'));
    const ops = Array.isArray(opsDoc) ? opsDoc : opsDoc.ops;
    if (!Array.isArray(ops)) {
        console.error(`${args.ops}: expected an array or an object with "ops" array.`);
        process.exit(1);
    }

    console.log(`File:  ${args.file} (${isPrefab(arr) ? 'prefab' : 'scene'}, ${arr.length} objects)`);
    console.log(`Ops:   ${args.ops} (${ops.length} operations)`);
    console.log('');

    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const handler = OPS[op.op];
        if (!handler) throw new Error(`Unknown op "${op.op}" (index ${i})`);
        try {
            handler(arr, op);
        } catch (e) {
            console.error(`\n[op ${i} "${op.op}"] ${e.message}`);
            process.exit(1);
        }
    }

    console.log('');
    if (args.dryRun) {
        console.log('[dry-run] No changes written.');
        return;
    }
    fs.writeFileSync(args.file, JSON.stringify(arr, null, 2));
    console.log(`Saved: ${args.file} (${arr.length} objects)`);
}

main();
