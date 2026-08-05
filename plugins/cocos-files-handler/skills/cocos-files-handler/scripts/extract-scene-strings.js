#!/usr/bin/env node
/**
 * extract-scene-strings.js
 *
 * Scans all Cocos Creator .scene and .prefab files, finds Label nodes
 * with Cyrillic text that need translation, and outputs a patches JSON
 * that can be filled in and fed to add-localized-text.js.
 *
 * Usage:
 *   node tools/extract-scene-strings.js [--output tools/patches.json]
 *
 * NOTE: Do NOT use shell redirection (> file) on Windows — PowerShell outputs
 * UTF-16 LE which garbles Unicode text. Always use --output instead.
 *
 * Output format (JSON array):
 *   [
 *     {
 *       "file": "assets/scenes/MainMenu.scene",
 *       "labelObjectIndex": 42,
 *       "nodeName": "StartButton",
 *       "nodePath": "Canvas/Header/StartButton",
 *       "text": "Начать игру",
 *       "translationKey": ""   <- fill this in before running add-localized-text.js
 *     }
 *   ]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const SCENES_DIR = path.join(ASSETS_DIR, 'scenes');
const PREFABS_DIR = path.join(ASSETS_DIR, 'prefabs');

const HAS_CYRILLIC = /[а-яёА-ЯЁ]/;
const IS_NUMERIC = /^[\d\s$+\-/.%,:]+$/;

function getAllFiles(dir, ext) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getAllFiles(fullPath, ext));
        } else if (entry.name.endsWith(ext)) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * Build a path string for a node by following _parent references.
 */
function buildNodePath(objects, nodeIdx) {
    const parts = [];
    let idx = nodeIdx;
    const visited = new Set();

    while (idx !== undefined && idx !== null) {
        if (visited.has(idx)) break;
        visited.add(idx);

        const obj = objects[idx];
        if (!obj || obj.__type__ !== 'cc.Node') break;

        if (obj._name) parts.unshift(obj._name);

        const parentRef = obj._parent;
        if (!parentRef || parentRef.__id__ === undefined) break;
        idx = parentRef.__id__;

        // Stop at cc.Scene level
        const parentObj = objects[idx];
        if (parentObj && parentObj.__type__ === 'cc.Scene') break;
    }

    return parts.join('/');
}

/**
 * Find the node that owns a component at the given index.
 */
function findOwnerNode(objects, componentIdx) {
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.__type__ !== 'cc.Node') continue;
        if (!Array.isArray(obj._components)) continue;
        if (obj._components.some(c => c.__id__ === componentIdx)) {
            return i;
        }
    }
    return -1;
}

function processFile(filePath) {
    let content;
    try {
        content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`Failed to parse ${filePath}: ${e.message}`);
        return [];
    }

    if (!Array.isArray(content)) return [];

    const results = [];
    const objects = content;

    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.__type__ !== 'cc.Label') continue;

        const text = obj._string;
        if (!text || typeof text !== 'string') continue;
        if (!text.trim()) continue;
        if (IS_NUMERIC.test(text.trim())) continue;
        if (!HAS_CYRILLIC.test(text)) continue;

        const nodeIdx = findOwnerNode(objects, i);
        const nodeName = nodeIdx >= 0 ? (objects[nodeIdx]._name ?? '(unknown)') : '(unknown)';
        const nodePath = nodeIdx >= 0 ? buildNodePath(objects, nodeIdx) : '(unknown)';

        results.push({
            file: path.relative(ROOT_DIR, filePath).replace(/\\/g, '/'),
            labelObjectIndex: i,
            nodeName,
            nodePath,
            text: text.replace(/\n/g, '\\n'),
            translationKey: '',
        });
    }

    return results;
}

// Collect all scene and prefab files
const sceneFiles = getAllFiles(SCENES_DIR, '.scene');
const prefabFiles = getAllFiles(PREFABS_DIR, '.prefab');
const allFiles = [...sceneFiles, ...prefabFiles];

const allResults = [];
for (const f of allFiles) {
    allResults.push(...processFile(f));
}

// Determine output path. Default writes into the project's tmp/ directory
// (avoids writes under .claude/, which Claude Code prompts on, and is easy to gitignore).
// The plugin folder is read-only at runtime when installed via marketplace, so we never
// write there. --stdout supports Windows PowerShell shell redirection (> file).
const outputArgIdx = process.argv.indexOf('--output');
const useStdout = process.argv.includes('--stdout');

let outputPath = null;
if (outputArgIdx >= 0) {
    outputPath = path.resolve(process.argv[outputArgIdx + 1]);
} else if (!useStdout) {
    outputPath = path.join(ROOT_DIR, 'tmp', 'patches.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

const json = JSON.stringify(allResults, null, 2);

if (outputPath) {
    fs.writeFileSync(outputPath, json, 'utf8');
    console.log(`Written ${allResults.length} entries to ${path.relative(ROOT_DIR, outputPath)}`);
} else {
    process.stdout.write(json + '\n');
}

console.log(`Total Label strings with Cyrillic: ${allResults.length}`);
console.log(`Files processed: ${allFiles.length}`);
