#!/usr/bin/env node
/**
 * replace-label-font.js
 *
 * Replaces the font used by cc.Label components in a Cocos Creator .scene
 * or .prefab file. Useful for switching system "Arial" labels to a TTF.
 *
 * By default (--mode system) only labels that currently render the system
 * font (`_isSystemFontUsed: true`) are touched, so labels that already
 * point at a different TTF (e.g. a Bold variant) are left alone.
 *
 * Usage:
 *   node replace-label-font.js \
 *     --file assets/scenes/Main.scene \
 *     --font-meta assets/resources/fonts/Factor-A-Regular-Web.ttf.meta \
 *     [--mode system|all] \
 *     [--nodes Title,PercentLabel] \
 *     [--exclude-nodes GearLabel] \
 *     [--dry-run]
 *
 * Modes:
 *   system  (default) — only Labels with `_isSystemFontUsed === true`.
 *   all               — every cc.Label, regardless of current font.
 *
 * Node filters (both optional, comma-separated, matched against the owning
 * node's `_name`, case-sensitive):
 *   --nodes          — restrict to labels on these nodes. Use it to give one
 *                      role its own font (titles, numeric readouts) after a
 *                      broad pass has set the body font on everything.
 *   --exclude-nodes  — skip these nodes. Needed for labels whose glyphs the
 *                      target font lacks (icon glyphs such as U+2699 ⚙), which
 *                      must keep rendering with the system font.
 * `--exclude-nodes` wins over `--nodes` when a name appears in both.
 *
 * Effect on each matching Label:
 *   _font                = { __uuid__, __expectedType__: 'cc.TTFFont' }
 *   _isSystemFontUsed    = false
 *   _fontFamily          ← unchanged (kept as a fallback name, mirrors how
 *                          existing labels in the project look)
 *
 * Idempotent: if every matching label already points at the requested
 * font and has `_isSystemFontUsed: false`, the script reports "no changes".
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
    const argv = process.argv.slice(2);
    const result = {
        file: null, fontMeta: null, mode: 'system', dryRun: false,
        nodes: null, excludeNodes: new Set(),
    };

    const nameList = (raw) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--file':      result.file     = argv[++i]; break;
            case '--font-meta': result.fontMeta = argv[++i]; break;
            case '--mode':      result.mode     = argv[++i]; break;
            case '--dry-run':   result.dryRun   = true;      break;
            case '--nodes':         result.nodes = new Set(nameList(argv[++i])); break;
            case '--exclude-nodes': result.excludeNodes = new Set(nameList(argv[++i])); break;
        }
    }

    if (!result.file || !result.fontMeta) {
        console.error('Usage: node replace-label-font.js \\\n' +
            '  --file <scene-or-prefab> \\\n' +
            '  --font-meta <path/to/Font.ttf.meta> \\\n' +
            '  [--mode system|all]   (default: system)\n' +
            '  [--nodes Title,PercentLabel]\n' +
            '  [--exclude-nodes GearLabel]\n' +
            '  [--dry-run]');
        process.exit(1);
    }
    if (result.nodes && result.nodes.size === 0) {
        console.error('--nodes was given but lists no names.');
        process.exit(1);
    }
    if (result.mode !== 'system' && result.mode !== 'all') {
        console.error(`--mode must be "system" or "all", got: ${result.mode}`);
        process.exit(1);
    }

    return result;
}

// ── Meta helpers ──────────────────────────────────────────────────────────────

function readFontMeta(metaPath) {
    const abs = path.resolve(ROOT_DIR, metaPath);
    if (!fs.existsSync(abs)) {
        console.error(`Font meta file not found: ${abs}`);
        process.exit(1);
    }
    const meta = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!meta.uuid) {
        console.error(`No "uuid" field in font meta: ${abs}`);
        process.exit(1);
    }
    if (meta.importer && meta.importer !== 'ttf-font') {
        console.error(`Expected a TTF font meta (importer "ttf-font"), got "${meta.importer}" for: ${abs}`);
        process.exit(1);
    }
    return meta.uuid;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
    const args = parseArgs();
    const fontUuid = readFontMeta(args.fontMeta);

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

    const targetRef = { __uuid__: fontUuid, __expectedType__: 'cc.TTFFont' };

    const candidates = [];
    const matchedNames = new Set();
    for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (!o || o.__type__ !== 'cc.Label') continue;

        const usesSystem = o._isSystemFontUsed === true;
        if (args.mode === 'system' && !usesSystem) continue;

        const nodeId = o.node && o.node.__id__;
        const nodeName = (nodeId != null && objects[nodeId] && objects[nodeId]._name) || '?';

        if (args.excludeNodes.has(nodeName)) continue;
        if (args.nodes && !args.nodes.has(nodeName)) continue;
        matchedNames.add(nodeName);

        candidates.push({ idx: i, label: o, nodeName });
    }

    // A --nodes name that matches nothing is almost always a typo, and it fails
    // silently otherwise: the label just keeps the font of the previous pass.
    if (args.nodes) {
        const missed = [...args.nodes].filter(n => !matchedNames.has(n));
        if (missed.length > 0) {
            console.warn(`  ! --nodes matched no label on: ${missed.join(', ')}`);
        }
    }

    if (candidates.length === 0) {
        console.log(`No matching cc.Label components in ${args.file} (mode: ${args.mode}).`);
        return;
    }

    let changed = 0;
    let skipped = 0;
    for (const { idx, label, nodeName } of candidates) {
        const currentUuid = label._font && label._font.__uuid__;
        const alreadyTarget = currentUuid === fontUuid && label._isSystemFontUsed === false;
        const text = (label._string || '').replace(/\s+/g, ' ').slice(0, 40);

        if (alreadyTarget) {
            console.log(`  [${idx}] ${nodeName}: already on target font — skip ("${text}")`);
            skipped++;
            continue;
        }

        const before = {
            sys: label._isSystemFontUsed,
            uuid: currentUuid || null,
        };
        label._font = { __uuid__: targetRef.__uuid__, __expectedType__: targetRef.__expectedType__ };
        label._isSystemFontUsed = false;
        changed++;

        console.log(`  [${idx}] ${nodeName}: sys=${before.sys} ${before.uuid || 'null'} → ${fontUuid} ("${text}")`);
    }

    console.log(`\n${changed} label(s) updated, ${skipped} already on target, in ${args.file}`);

    if (args.dryRun) {
        console.log('[dry-run] No changes written.');
        return;
    }
    if (changed === 0) {
        console.log('No write needed.');
        return;
    }
    fs.writeFileSync(fileAbs, JSON.stringify(objects, null, 2));
    console.log(`Saved: ${args.file}`);
}

run();
