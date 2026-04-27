#!/usr/bin/env node
/**
 * patch-component-property.js
 *
 * Sets (or adds) a property on an existing component in a Cocos Creator .scene or .prefab file.
 * The component is identified by node name + script .meta file UUID.
 *
 * Usage:
 *   node tools/patch-component-property.js \
 *     --file  assets/scenes/StartItch.scene \
 *     --node  LocalizationManager \
 *     --meta  assets/scripts/Managers/Global/LocalizationManager.ts.meta \
 *     --property defaultLocale \
 *     --value en \
 *     [--dry-run]
 *
 * --value is parsed as JSON first; if that fails it is treated as a plain string.
 * Examples:
 *   --value en          → "en"  (string)
 *   --value 42          → 42    (number)
 *   --value true        → true  (boolean)
 *   --value '{"a":1}'  → {a:1} (object)
 *
 * Special string substitutions (applied anywhere inside objects/arrays too):
 *   "@node:NodeName"                         → { __id__: <id of node in this file> }
 *   "@asset:path/to/x.meta"                  → { __uuid__, __expectedType__ inferred from extension }
 *   "@asset:path/to/x.meta:cc.Prefab"        → explicit expected type
 *
 * Examples:
 *   --value '"@node:MyChild"'                              → Node reference
 *   --value '"@asset:assets/prefabs/X.prefab.meta"'        → Prefab reference
 *   --value '{"target":"@node:X","prefab":"@asset:assets/prefabs/Y.prefab.meta"}'
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..');

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
    const argv = process.argv.slice(2);
    const result = { file: null, node: null, meta: null, type: null, property: null, value: undefined, dryRun: false };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--file':     result.file     = argv[++i]; break;
            case '--node':     result.node     = argv[++i]; break;
            case '--meta':     result.meta     = argv[++i]; break;
            case '--type':     result.type     = argv[++i]; break;
            case '--property': result.property = argv[++i]; break;
            case '--value':    result.value    = argv[++i]; break;
            case '--dry-run':  result.dryRun   = true;      break;
        }
    }

    if (!result.file || !result.node || (!result.meta && !result.type) || !result.property || result.value === undefined) {
        console.error('Usage: node tools/patch-component-property.js \\\n' +
            '  --file <scene-or-prefab> \\\n' +
            '  --node <NodeName> \\\n' +
            '  (--meta <path/to/Script.ts.meta> | --type <cc.BuiltinType>) \\\n' +
            '  --property <propName> \\\n' +
            '  --value <value> \\\n' +
            '  [--dry-run]\n' +
            '\n' +
            '--meta : patch a script component (UUID from .meta)\n' +
            '--type : patch a built-in Cocos component, e.g. cc.Widget');
        process.exit(1);
    }
    if (result.meta && result.type) {
        console.error('--meta and --type are mutually exclusive.');
        process.exit(1);
    }

    // Parse value: try JSON first, fall back to raw string
    try {
        result.value = JSON.parse(result.value);
    } catch (_) {
        // keep as string
    }

    return result;
}

// ── UUID helpers ──────────────────────────────────────────────────────────────

/**
 * Converts a full hyphenated UUID (from .meta) to Cocos Creator's compact 23-char format.
 */
function compressUuid(uuid) {
    const hex  = uuid.replace(/-/g, '');
    const tail = Buffer.from(hex.slice(5) + '0', 'hex').toString('base64').slice(0, 18);
    return hex.slice(0, 5) + tail;
}

function readMetaUuid(metaPath) {
    const abs = path.resolve(ROOT_DIR, metaPath);
    if (!fs.existsSync(abs)) {
        console.error(`Meta file not found: ${abs}`);
        console.error('Make sure the TypeScript file exists and Cocos Creator has generated its .meta file.');
        process.exit(1);
    }
    const meta = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!meta.uuid) {
        console.error(`No "uuid" field in meta file: ${abs}`);
        process.exit(1);
    }
    return compressUuid(meta.uuid);
}

function readAssetUuid(metaPath) {
    const abs = path.resolve(ROOT_DIR, metaPath);
    if (!fs.existsSync(abs)) throw new Error(`Asset meta not found: ${abs}`);
    const meta = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!meta.uuid) throw new Error(`No uuid in meta: ${abs}`);
    return meta.uuid;  // full form — matches how add-prefab-nodes writes @asset refs
}

function inferExpectedType(metaPath) {
    // Extension before `.meta` → Cocos asset type.
    const lower = metaPath.toLowerCase();
    if (lower.endsWith('.prefab.meta')) return 'cc.Prefab';
    if (lower.endsWith('.scene.meta'))  return 'cc.SceneAsset';
    if (/\.(png|jpg|jpeg|webp)\.meta$/.test(lower)) return 'cc.SpriteFrame';
    if (/\.(ttf|otf)\.meta$/.test(lower))            return 'cc.TTFFont';
    if (/\.(mp3|ogg|wav)\.meta$/.test(lower))        return 'cc.AudioClip';
    if (lower.endsWith('.json.meta'))                return 'cc.JsonAsset';
    return 'cc.Asset';
}

function findNodeIndex(objects, name) {
    for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (o && o.__type__ === 'cc.Node' && o._name === name) return i;
    }
    return -1;
}

/** Recursively rewrite "@node:..." / "@asset:..." strings into Cocos reference objects. */
function rewriteRefs(value, objects) {
    if (typeof value === 'string') {
        if (value.startsWith('@node:')) {
            const name = value.slice(6);
            const id = findNodeIndex(objects, name);
            if (id < 0) throw new Error(`@node:${name} — node not found in file`);
            return { __id__: id };
        }
        if (value.startsWith('@asset:')) {
            const rest = value.slice(7);
            const metaIdx = rest.indexOf('.meta');
            if (metaIdx < 0) throw new Error(`@asset: expected a path ending in .meta, got "${rest}"`);
            const metaPath = rest.slice(0, metaIdx + '.meta'.length);
            const afterMeta = rest.slice(metaIdx + '.meta'.length);
            let expectedType;
            if (afterMeta.startsWith(':'))       expectedType = afterMeta.slice(1);
            else if (afterMeta === '')           expectedType = inferExpectedType(metaPath);
            else throw new Error(`@asset: unexpected trailing content after .meta: "${afterMeta}"`);
            return { __uuid__: readAssetUuid(metaPath), __expectedType__: expectedType };
        }
        return value;
    }
    if (Array.isArray(value))                return value.map(v => rewriteRefs(v, objects));
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) out[key] = rewriteRefs(value[key], objects);
        return out;
    }
    return value;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs();

let compactUuid;
if (args.type) {
    if (!/^cc\.[A-Za-z][A-Za-z0-9_]*$/.test(args.type)) {
        console.error(`--type must look like "cc.Foo", got: ${args.type}`);
        process.exit(1);
    }
    compactUuid = args.type;
    console.log(`Component type: ${args.type} (built-in)`);
} else {
    compactUuid = readMetaUuid(args.meta);
    console.log(`Component UUID (compact): ${compactUuid}`);
}

const fileAbs = path.resolve(ROOT_DIR, args.file);
if (!fs.existsSync(fileAbs)) {
    console.error(`File not found: ${fileAbs}`);
    process.exit(1);
}

let objects;
try {
    objects = JSON.parse(fs.readFileSync(fileAbs, 'utf8'));
} catch (e) {
    console.error(`Failed to parse file: ${e.message}`);
    process.exit(1);
}

if (!Array.isArray(objects)) {
    console.error('File is not a JSON array — not a valid Cocos Creator scene/prefab.');
    process.exit(1);
}

// Find the cc.Node with matching _name
const nodeIdx = objects.findIndex(obj => obj.__type__ === 'cc.Node' && obj._name === args.node);
if (nodeIdx < 0) {
    console.error(`Node "${args.node}" not found in ${args.file}`);
    process.exit(1);
}

const nodeObj = objects[nodeIdx];
console.log(`Found node "${args.node}" at index ${nodeIdx}`);

// Find the component on that node whose __type__ matches the compact UUID
const componentRef = (nodeObj._components ?? []).find(ref => {
    const comp = objects[ref.__id__];
    return comp && comp.__type__ === compactUuid;
});

if (!componentRef) {
    console.error(`Component with UUID "${compactUuid}" not found on node "${args.node}"`);
    console.error('Verify that the --meta points to the correct script and that the node has this component.');
    process.exit(1);
}

const compIdx = componentRef.__id__;
const compObj = objects[compIdx];
console.log(`Found component at index ${compIdx}`);

// Set the property (with @node:/@asset: rewriting so references resolve correctly)
const previousValue = compObj[args.property];
const rewrittenValue = rewriteRefs(args.value, objects);
compObj[args.property] = rewrittenValue;

console.log(`Property "${args.property}": ${JSON.stringify(previousValue)} → ${JSON.stringify(rewrittenValue)}`);

if (args.dryRun) {
    console.log('[dry-run] No changes written.');
    process.exit(0);
}

fs.writeFileSync(fileAbs, JSON.stringify(objects, null, 2));
console.log(`Saved: ${args.file}`);
