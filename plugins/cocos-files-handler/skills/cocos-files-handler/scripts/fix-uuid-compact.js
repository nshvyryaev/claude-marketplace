#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const OLD_LOCALIZED_TEXT = 'e19100ae-3625-4b77-b188-eddd782afe79';
const NEW_LOCALIZED_TEXT = 'e1910CuNiVLd7GI7d14Kv55';
const OLD_LOCALIZATION_MGR = 'dfe4b036-9bc8-4081-8ad9-832b5dbb15e6';
const NEW_LOCALIZATION_MGR = 'dfe4bA2m8hAgYrZgytduxXm';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const dirs = [path.join(ROOT, 'assets/scenes'), path.join(ROOT, 'assets/prefabs')];

function getFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...getFiles(fp));
        else if (e.name.endsWith('.scene') || e.name.endsWith('.prefab')) out.push(fp);
    }
    return out;
}

let totalFixed = 0;
for (const dir of dirs) {
    for (const fp of getFiles(dir)) {
        let content = fs.readFileSync(fp, 'utf8');
        const original = content;
        content = content.split(OLD_LOCALIZED_TEXT).join(NEW_LOCALIZED_TEXT);
        content = content.split(OLD_LOCALIZATION_MGR).join(NEW_LOCALIZATION_MGR);
        if (content !== original) {
            fs.writeFileSync(fp, content, 'utf8');
            console.log('Fixed:', path.relative(ROOT, fp));
            totalFixed++;
        }
    }
}
console.log('Done. Fixed', totalFixed, 'files.');
