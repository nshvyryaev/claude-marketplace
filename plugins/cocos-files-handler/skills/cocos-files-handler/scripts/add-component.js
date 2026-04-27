#!/usr/bin/env node
/**
 * add-component.js
 *
 * Adds a script component to an existing node in a Cocos Creator .scene or .prefab file.
 * The component type is resolved from a TypeScript .meta file (compact UUID).
 *
 * Idempotent: if the node already has a component of the given type, the script
 * reports it and exits without duplicating (unless --force is passed).
 *
 * Usage:
 *   node .claude/skills/scene-prefab-tools/scripts/add-component.js \
 *     --file  assets/scenes/Main.scene \
 *     --node  GameWorld \
 *     --meta  assets/scripts/prefabs/EnemySpawner.ts.meta \
 *     [--properties '{"count": 2, "speed": 600}'] \
 *     [--force] \
 *     [--dry-run]
 *
 * Property value encoding (inside --properties JSON):
 *   Plain values are stored as-is:
 *     "count": 2              → 2
 *     "enabled": true         → true
 *     "label": "hello"        → "hello"
 *
 *   Special string prefixes are rewritten into Cocos references:
 *     "@node:NodeName"        → { __id__: <id of node in this file> }
 *     "@asset:path/to/x.meta" → { __uuid__: <uuid from meta>, __expectedType__: "<inferred>" }
 *     "@asset:path/to/x.meta:cc.Prefab"
 *                             → { __uuid__: <uuid>, __expectedType__: "cc.Prefab" }
 *
 *   Nested objects/arrays are walked recursively, so references can appear anywhere.
 *
 * Examples:
 *   # Add EnemySpawner on GameWorld, referencing PlayScreenBG and Enemy.prefab.
 *   node .../add-component.js \
 *     --file assets/scenes/Main.scene \
 *     --node GameWorld \
 *     --meta assets/scripts/prefabs/EnemySpawner.ts.meta \
 *     --properties '{"enemyPrefab":"@asset:assets/prefabs/Enemy.prefab.meta","playArea":"@node:PlayScreenBG","count":2,"speed":600}'
 *
 *   # Add an empty SpawnPoint to a prefab root.
 *   node .../add-component.js \
 *     --file assets/prefabs/Player.prefab \
 *     --node Player \
 *     --meta assets/scripts/components/SpawnPoint.ts.meta
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..');

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
    const argv = process.argv.slice(2);
    const result = {
        file: null,
        node: null,
        meta: null,
        type: null,
        properties: null,
        force: false,
        dryRun: false,
    };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--file':       result.file       = argv[++i]; break;
            case '--node':       result.node       = argv[++i]; break;
            case '--meta':       result.meta       = argv[++i]; break;
            case '--type':       result.type       = argv[++i]; break;
            case '--properties': result.properties = argv[++i]; break;
            case '--force':      result.force      = true;      break;
            case '--dry-run':    result.dryRun     = true;      break;
            case '-h':
            case '--help':
                printUsage();
                process.exit(0);
        }
    }

    if (!result.file || !result.node || (!result.meta && !result.type)) {
        printUsage();
        process.exit(1);
    }
    if (result.meta && result.type) {
        console.error('--meta and --type are mutually exclusive. Use --meta for script components, --type for built-in cc.* types.');
        process.exit(1);
    }

    if (result.properties !== null) {
        try {
            result.properties = JSON.parse(result.properties);
        } catch (e) {
            console.error(`--properties is not valid JSON: ${e.message}`);
            process.exit(1);
        }
        if (typeof result.properties !== 'object' || Array.isArray(result.properties) || result.properties === null) {
            console.error('--properties must be a JSON object');
            process.exit(1);
        }
    }

    return result;
}

function printUsage() {
    console.error(
        'Usage: node .claude/skills/scene-prefab-tools/scripts/add-component.js \\\n' +
        '  --file <scene-or-prefab> \\\n' +
        '  --node <NodeName> \\\n' +
        '  (--meta <path/to/Script.ts.meta> | --type <cc.BuiltinType>) \\\n' +
        '  [--properties <json-object>] \\\n' +
        '  [--force] \\\n' +
        '  [--dry-run]\n' +
        '\n' +
        '--meta : add a script component (UUID resolved from .meta)\n' +
        '--type : add a built-in Cocos component, e.g. cc.Widget, cc.Button, cc.Layout\n' +
        '\n' +
        'Property values support special strings:\n' +
        '  "@node:NodeName"                         → { __id__: <id> }\n' +
        '  "@asset:path/to/x.meta"                  → { __uuid__, __expectedType__ inferred from extension }\n' +
        '  "@asset:path/to/x.meta:cc.Prefab"        → explicit expected type'
    );
}

// ── UUID helpers ──────────────────────────────────────────────────────────────

function compressUuid(uuid) {
    const hex = uuid.replace(/-/g, '');
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
    return meta.uuid;
}

function inferExpectedType(metaRelPath) {
    // Strip trailing .meta, look at the real asset extension.
    const asset = metaRelPath.replace(/\.meta$/, '');
    const ext = path.extname(asset).toLowerCase();
    switch (ext) {
        case '.prefab': return 'cc.Prefab';
        case '.scene':  return 'cc.SceneAsset';
        case '.png':
        case '.jpg':
        case '.jpeg':
        case '.webp':   return 'cc.SpriteFrame';
        case '.ttf':
        case '.otf':    return 'cc.TTFFont';
        case '.mp3':
        case '.ogg':
        case '.wav':    return 'cc.AudioClip';
        case '.json':   return 'cc.JsonAsset';
        default:        return 'cc.Asset';
    }
}

// ── Reference rewriting ───────────────────────────────────────────────────────

/**
 * Walks a value tree and rewrites "@node:..." and "@asset:..." strings
 * into Cocos reference objects. Uses `objects` (the full scene/prefab array)
 * to resolve node names.
 */
function rewriteRefs(value, objects) {
    if (typeof value === 'string') {
        if (value.startsWith('@node:')) {
            const name = value.slice(6);
            const id = findNodeIndex(objects, name);
            if (id < 0) {
                throw new Error(`@node:${name} — node not found in file`);
            }
            return { __id__: id };
        }
        if (value.startsWith('@asset:')) {
            const rest = value.slice(7);
            // Form: path/to/x.meta[:ExpectedType]
            // Colon is only used as separator when it appears AFTER the .meta suffix.
            const metaIdx = rest.indexOf('.meta');
            if (metaIdx < 0) {
                throw new Error(`@asset: expected a path ending in .meta, got "${rest}"`);
            }
            const metaPath = rest.slice(0, metaIdx + '.meta'.length);
            const afterMeta = rest.slice(metaIdx + '.meta'.length);
            let expectedType;
            if (afterMeta.startsWith(':')) {
                expectedType = afterMeta.slice(1);
            } else if (afterMeta === '') {
                expectedType = inferExpectedType(metaPath);
            } else {
                throw new Error(`@asset: unexpected trailing content after .meta: "${afterMeta}"`);
            }
            const uuid = readMetaUuid(metaPath);
            return { __uuid__: uuid, __expectedType__: expectedType };
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(v => rewriteRefs(v, objects));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = rewriteRefs(value[key], objects);
        }
        return out;
    }
    return value;
}

function findNodeIndex(objects, name) {
    for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (o && o.__type__ === 'cc.Node' && o._name === name) return i;
    }
    return -1;
}

// ── Prefab detection ──────────────────────────────────────────────────────────

/**
 * A file is a prefab if it contains a cc.Prefab object at the top.
 * Scene components use __prefab: null; prefab components have a CompPrefabInfo.
 */
function isPrefab(objects) {
    return objects.some(o => o && o.__type__ === 'cc.Prefab');
}

function randomFileId() {
    // Cocos uses 22-char base64url-ish IDs for CompPrefabInfo.fileId.
    return crypto
        .randomBytes(16)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
        .slice(0, 22);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
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
        const fullUuid = readMetaUuid(args.meta);
        compactUuid = compressUuid(fullUuid);
        console.log(`Component type: ${args.meta}`);
        console.log(`  full uuid:    ${fullUuid}`);
        console.log(`  compact uuid: ${compactUuid}`);
    }

    const fileAbs = path.resolve(ROOT_DIR, args.file);
    if (!fs.existsSync(fileAbs)) {
        console.error(`File not found: ${fileAbs}`);
        process.exit(1);
    }
    const objects = JSON.parse(fs.readFileSync(fileAbs, 'utf8'));
    if (!Array.isArray(objects)) {
        console.error('File is not a JSON array — not a valid Cocos Creator scene/prefab.');
        process.exit(1);
    }

    const nodeId = findNodeIndex(objects, args.node);
    if (nodeId < 0) {
        console.error(`Node "${args.node}" not found in ${args.file}`);
        process.exit(1);
    }
    const nodeObj = objects[nodeId];
    console.log(`Target node: "${args.node}" at id ${nodeId}`);

    // Idempotency check.
    const existingRef = (nodeObj._components ?? []).find(ref => {
        const c = objects[ref.__id__];
        return c && c.__type__ === compactUuid;
    });
    if (existingRef && !args.force) {
        console.log(`Component already present on node (id ${existingRef.__id__}). Use --force to add a duplicate.`);
        process.exit(0);
    }

    // Rewrite refs in properties.
    let extraFields = {};
    if (args.properties) {
        try {
            extraFields = rewriteRefs(args.properties, objects);
        } catch (e) {
            console.error(`Failed to resolve property references: ${e.message}`);
            process.exit(1);
        }
    }

    const fileIsPrefab = isPrefab(objects);
    console.log(`File kind:  ${fileIsPrefab ? 'prefab' : 'scene'}`);

    const compId = objects.length;
    let prefabInfoId = null;

    const component = {
        __type__: compactUuid,
        _name: '',
        _objFlags: 0,
        __editorExtras__: {},
        node: { __id__: nodeId },
        _enabled: true,
        __prefab: null, // filled below for prefabs
        ...extraFields,
        _id: '',
    };

    if (fileIsPrefab) {
        prefabInfoId = compId + 1;
        component.__prefab = { __id__: prefabInfoId };
        const prefabInfo = {
            __type__: 'cc.CompPrefabInfo',
            fileId: randomFileId(),
        };
        objects.push(component, prefabInfo);
    } else {
        objects.push(component);
    }

    nodeObj._components = nodeObj._components ?? [];
    nodeObj._components.push({ __id__: compId });

    console.log(`+ added component at id ${compId}${prefabInfoId !== null ? ` (CompPrefabInfo at ${prefabInfoId})` : ''}`);
    if (Object.keys(extraFields).length > 0) {
        console.log(`  properties: ${JSON.stringify(extraFields)}`);
    }

    if (args.dryRun) {
        console.log('[dry-run] No changes written.');
        return;
    }

    fs.writeFileSync(fileAbs, JSON.stringify(objects, null, 2));
    console.log(`Saved: ${args.file}`);
}

main();
