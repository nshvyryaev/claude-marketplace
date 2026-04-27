#!/usr/bin/env node
/**
 * find-sprite-frame.js
 *
 * Extracts a SpriteFrame asset UUID used by a cc.Sprite in an existing scene
 * or prefab. Handy when adding a new node that should reuse the same visual as
 * an existing element (e.g. menu button backgrounds, shared icons) without
 * having to hand-copy UUIDs from .scene files.
 *
 * Usage:
 *   node .claude/skills/scene-prefab-tools/scripts/find-sprite-frame.js \
 *     --file <scene-or-prefab> [--node <NodeName>] [--index <n>]
 *
 *   --node   Return the SpriteFrame of the cc.Sprite attached to the node with
 *            this exact _name. When absent, scans the whole file.
 *   --index  1-based index into matching sprites (default 1). Useful when a
 *            file has several Sprites with different frames.
 *
 * Prints the full asset UUID (36 chars, with hyphens) to stdout and exits 0;
 * prints an error and exits 1 if nothing matches.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
function arg(name) { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; }

const filePath = arg('file');
const nodeName = arg('node');
const index    = Math.max(1, parseInt(arg('index') ?? '1', 10));

if (!filePath) {
    console.error('Usage: find-sprite-frame.js --file <scene-or-prefab> [--node <NodeName>] [--index <n>]');
    process.exit(1);
}
const abs = path.join(process.cwd(), filePath);
if (!fs.existsSync(abs)) { console.error(`File not found: ${abs}`); process.exit(1); }

const objects = JSON.parse(fs.readFileSync(abs, 'utf8'));

function nodeOwningComponent(componentIdx) {
    for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (o && o.__type__ === 'cc.Node' && Array.isArray(o._components)) {
            if (o._components.some(c => c.__id__ === componentIdx)) return o;
        }
    }
    return null;
}

const matches = [];
for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (!o || o.__type__ !== 'cc.Sprite') continue;
    const uuid = o._spriteFrame && o._spriteFrame.__uuid__;
    if (!uuid) continue;
    if (nodeName) {
        const owner = nodeOwningComponent(i);
        if (!owner || owner._name !== nodeName) continue;
    }
    matches.push(uuid);
}

if (matches.length === 0) {
    console.error(nodeName
        ? `No cc.Sprite with a SpriteFrame found on node "${nodeName}" in ${filePath}`
        : `No cc.Sprite with a SpriteFrame found in ${filePath}`);
    process.exit(1);
}
if (index > matches.length) {
    console.error(`--index ${index} out of range (found ${matches.length} matches)`);
    process.exit(1);
}
process.stdout.write(matches[index - 1] + '\n');
