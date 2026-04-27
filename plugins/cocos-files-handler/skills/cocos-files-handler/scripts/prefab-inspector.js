#!/usr/bin/env node
/**
 * prefab-inspector.js
 *
 * Prints a human-readable tree of a Cocos Creator .prefab or .scene file.
 * Useful for understanding prefab structure before editing it via add-prefab-nodes.js.
 *
 * Usage:
 *   node tools/prefab-inspector.js --file assets/prefabs/Settings.prefab
 *   node tools/prefab-inspector.js --file assets/scenes/Settings.scene
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const fileArgIdx = args.indexOf('--file');
if (fileArgIdx === -1 || !args[fileArgIdx + 1]) {
    console.error('Usage: node tools/prefab-inspector.js --file <path>');
    process.exit(1);
}

const filePath = path.join(process.cwd(), args[fileArgIdx + 1]);
if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

const objects = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// ── Helpers ───────────────────────────────────────────────────────────────────

function getObj(id) {
    return objects[id];
}

/** Find the node object that owns a component (by searching for the component id in _components). */
function findOwnerNode(componentIdx) {
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.__type__ === 'cc.Node' && Array.isArray(obj._components)) {
            if (obj._components.some(c => c.__id__ === componentIdx)) return i;
        }
    }
    return -1;
}

/** Get all components for a node index. Returns array of {idx, obj} */
function getComponents(nodeIdx) {
    const node = getObj(nodeIdx);
    if (!node || !node._components) return [];
    return node._components.map(c => ({ idx: c.__id__, obj: getObj(c.__id__) }));
}

/** Get UITransform for a node. */
function getUITransform(nodeIdx) {
    const comps = getComponents(nodeIdx);
    return comps.find(c => c.obj?.__type__ === 'cc.UITransform')?.obj ?? null;
}

/** Format a color object as hex string. */
function formatColor(color) {
    if (!color) return '';
    const r = (color.r ?? 0).toString(16).padStart(2, '0');
    const g = (color.g ?? 0).toString(16).padStart(2, '0');
    const b = (color.b ?? 0).toString(16).padStart(2, '0');
    const a = color.a !== undefined && color.a !== 255 ? `/${color.a}` : '';
    return `#${r}${g}${b}${a}`;
}

/** Format anchor point. */
function formatAnchor(anchor) {
    if (!anchor) return '?';
    return `${anchor.x},${anchor.y}`;
}

/** Format position. */
function formatPos(lpos) {
    if (!lpos) return '';
    const x = Math.round(lpos.x);
    const y = Math.round(lpos.y);
    const z = lpos.z ? Math.round(lpos.z) : 0;
    if (z !== 0) return `pos:${x},${y},${z}`;
    return `pos:${x},${y}`;
}

/** Shorten a UUID to first 8 chars for display. */
function shortUuid(uuid) {
    if (!uuid) return '?';
    return uuid.split('@')[0].slice(0, 8) + '…';
}

/** Layout type names. */
const LAYOUT_TYPES = { 0: 'none', 1: 'horizontal', 2: 'vertical', 3: 'grid' };
const RESIZE_MODES = { 0: 'none', 1: 'container', 2: 'children' };

/** Format a single component for display. */
function formatComponent(comp) {
    const obj = comp.obj;
    if (!obj) return `[?@${comp.idx}]`;
    const type = obj.__type__;

    if (type === 'cc.UITransform') {
        const s = obj._contentSize;
        const a = obj._anchorPoint;
        return `[UITransform ${s?.width ?? '?'}×${s?.height ?? '?'} anchor:${formatAnchor(a)}]`;
    }
    if (type === 'cc.Sprite') {
        const uuid = obj._spriteFrame?.__uuid__ ?? obj._spriteFrame?.['__uuid__'];
        const color = obj._color;
        const colorStr = color ? ` color:${formatColor(color)}` : '';
        const uuidStr = uuid ? ` frame:${shortUuid(uuid)}` : '';
        return `[Sprite${colorStr}${uuidStr}]`;
    }
    if (type === 'cc.Label') {
        const text = obj._string ?? '';
        const fontSize = obj._fontSize ?? '?';
        const displayText = text.length > 20 ? text.slice(0, 20) + '…' : text;
        return `[Label "${displayText}" ${fontSize}px]`;
    }
    if (type === 'cc.Layout') {
        const lt = LAYOUT_TYPES[obj._layoutType] ?? obj._layoutType;
        const rm = RESIZE_MODES[obj._resizeMode] ?? obj._resizeMode;
        const gap = obj._spacingY !== undefined ? ` gapY:${obj._spacingY}` : '';
        const gapX = obj._spacingX !== undefined && obj._spacingX !== 0 ? ` gapX:${obj._spacingX}` : '';
        return `[Layout ${lt} resize:${rm}${gap}${gapX}]`;
    }
    if (type === 'cc.BlockInputEvents') return '[BlockInputEvents]';
    if (type === 'cc.RichText') return '[RichText]';
    if (type === 'cc.Button') return '[Button]';
    if (type === 'cc.ScrollView') return '[ScrollView]';
    if (type === 'cc.Mask') return '[Mask]';

    // Custom script component — show compact type + known properties
    const shortType = type.slice(0, 12) + (type.length > 12 ? '…' : '');
    const extra = obj.translationKey
        ? ` key:"${obj.translationKey}"`
        : obj.fullText !== undefined
        ? ` fullText:"${String(obj.fullText).slice(0, 20)}" delay:${obj.startDelay ?? 0}s dur:${obj.duration ?? 1}s`
        : '';
    const name = obj._name ? ` "${obj._name}"` : '';
    return `[${shortType}${name}${extra}]`;
}

/** Print a node and its children recursively. */
function printNode(nodeIdx, prefix, isLast) {
    const node = getObj(nodeIdx);
    if (!node || node.__type__ !== 'cc.Node') return;

    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    const uitr = getUITransform(nodeIdx);
    const s = uitr?._contentSize;
    const a = uitr?._anchorPoint;
    const sizeStr = s ? `${Math.round(s.width)}×${Math.round(s.height)}` : '';
    const anchorStr = a ? ` anchor:${formatAnchor(a)}` : '';
    const posStr = node._lpos ? ` ${formatPos(node._lpos)}` : '';
    const activeStr = node._active === false ? ' [INACTIVE]' : '';

    const header = `[${nodeIdx}] ${node._name}${activeStr} (${sizeStr}${anchorStr}${posStr})`;

    // Components (skip UITransform since it's already in header, skip PrefabInfo/CompPrefabInfo)
    const skipTypes = new Set(['cc.UITransform', 'cc.PrefabInfo', 'cc.CompPrefabInfo']);
    const compStrings = getComponents(nodeIdx)
        .filter(c => c.obj && !skipTypes.has(c.obj.__type__))
        .map(c => formatComponent(c));

    const compLine = compStrings.length > 0 ? `\n${prefix}${childPrefix}    ${compStrings.join(' ')}` : '';

    console.log(`${prefix}${connector}${header}${compLine}`);

    const children = node._children ?? [];
    children.forEach((childRef, i) => {
        const isChildLast = i === children.length - 1;
        printNode(childRef.__id__, prefix + childPrefix, isChildLast);
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const fileName = path.basename(filePath);
console.log(`\nPREFAB: ${fileName}`);
console.log('='.repeat(60));

// Find root nodes:
//   .scene files  → cc.Scene object's _children (Canvas etc.)
//   .prefab files → cc.Node with no parent, or cc.Prefab.data
const rootNodes = [];
const sceneObj = objects.find(o => o.__type__ === 'cc.Scene');
if (sceneObj) {
    // Scene file: top-level nodes are children of cc.Scene
    (sceneObj._children ?? []).forEach(ref => rootNodes.push(ref.__id__));
} else {
    // Prefab file: nodes with no parent
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.__type__ === 'cc.Node' && (!obj._parent || obj._parent === null)) {
            rootNodes.push(i);
        }
    }
    if (rootNodes.length === 0) {
        const prefabInfo = objects.find(o => o.__type__ === 'cc.Prefab');
        if (prefabInfo?.data?.__id__ !== undefined) {
            rootNodes.push(prefabInfo.data.__id__);
        }
    }
}

rootNodes.forEach((rootIdx, i) => {
    const isLast = i === rootNodes.length - 1;
    const root = getObj(rootIdx);
    if (!root) return;

    const uitr = getUITransform(rootIdx);
    const s = uitr?._contentSize;
    const sizeStr = s ? `${Math.round(s.width)}×${Math.round(s.height)}` : '';
    const activeStr = root._active === false ? ' [INACTIVE]' : '';
    console.log(`\n[${rootIdx}] ${root._name}${activeStr} (${sizeStr})`);

    const skipTypes = new Set(['cc.UITransform', 'cc.PrefabInfo', 'cc.CompPrefabInfo']);
    const compStrings = getComponents(rootIdx)
        .filter(c => c.obj && !skipTypes.has(c.obj.__type__))
        .map(c => formatComponent(c));
    if (compStrings.length > 0) {
        console.log(`    ${compStrings.join(' ')}`);
    }

    const children = root._children ?? [];
    children.forEach((childRef, ci) => {
        const isChildLast = ci === children.length - 1;
        printNode(childRef.__id__, '', isChildLast);
    });
});

console.log('\n' + '='.repeat(60));
console.log(`Total objects in file: ${objects.length}`);
console.log(`Index range for new nodes: ${objects.length} and above\n`);
