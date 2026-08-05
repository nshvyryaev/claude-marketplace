import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'verify-cocos-code.js');
const require = createRequire(import.meta.url);
const { scanSource } = require(SCRIPT);

function sandbox(t) {
    const dir = mkdtempSync(join(tmpdir(), 'vcc-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function runCli(dir, args) {
    return spawnSync('node', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        cwd: dir,
    });
}

// ── no-set-active ────────────────────────────────────────────────────────────

test('flags node.setActive(...)', () => {
    const f = scanSource('this.bgNode.setActive(false);', 'a.ts');
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'no-set-active');
    assert.equal(f[0].line, 1);
});

test('flags optional-chained setActive — the case tsc and null-checks both miss', () => {
    const f = scanSource('festiveBackgroundNode?.setActive(false);', 'a.ts');
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'no-set-active');
});

test('accepts the correct property form', () => {
    assert.deepEqual(scanSource('node.active = false;\nif (n) n.active = true;', 'a.ts'), []);
});

test('does not flag a name that merely contains setActive', () => {
    assert.deepEqual(scanSource('const wasSetActiveOnce = true;', 'a.ts'), []);
});

// ── no-json-import ───────────────────────────────────────────────────────────

test('flags a static .json import', () => {
    const f = scanSource("import forest from './forest.world.json';", 'a.ts');
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'no-json-import');
});

test('flags a dynamic .json import', () => {
    const f = scanSource("const d = await import('./quests.json');", 'a.ts');
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'no-json-import');
});

test('accepts a normal TS import and a resources load', () => {
    const src = [
        "import { Node } from 'cc';",
        "resources.load('configs/forest', JsonAsset, cb);",
    ].join('\n');
    assert.deepEqual(scanSource(src, 'a.ts'), []);
});

// ── comments and suppression ─────────────────────────────────────────────────

test('ignores a line-commented violation', () => {
    assert.deepEqual(scanSource('// node.setActive(false);', 'a.ts'), []);
});

test('ignores a violation inside a block comment', () => {
    const src = ['/*', ' node.setActive(false);', '*/', 'node.active = false;'].join('\n');
    assert.deepEqual(scanSource(src, 'a.ts'), []);
});

test('still flags code that follows a block comment on the same line', () => {
    const f = scanSource('/* setup */ node.setActive(false);', 'a.ts');
    assert.equal(f.length, 1);
});

test('does not treat // inside a string as a comment', () => {
    const f = scanSource('const url = "http://x"; node.setActive(false);', 'a.ts');
    assert.equal(f.length, 1);
});

test('respects the cocos-verify-ignore marker', () => {
    assert.deepEqual(scanSource('thing.setActive(false); // cocos-verify-ignore', 'a.ts'), []);
});

// ── file rules ───────────────────────────────────────────────────────────────

test('flags an edit to the generated tsconfig', () => {
    const f = scanSource('{"compilerOptions":{}}', 'temp/tsconfig.cocos.json');
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'no-generated-tsconfig-edit');
});

test('leaves the project tsconfig alone', () => {
    assert.deepEqual(scanSource('{"extends":"./temp/tsconfig.cocos.json"}', 'tsconfig.json'), []);
});

test('skips content rules for non-source files', () => {
    assert.deepEqual(scanSource('node.setActive(false)', 'notes.md'), []);
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test('CLI exits 1 and names the file on a violation', (t) => {
    const dir = sandbox(t);
    mkdirSync(join(dir, 'assets', 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'assets/scripts/Bad.ts'), 'export const f = () => n.setActive(true);');

    const r = runCli(dir, ['--file', 'assets/scripts/Bad.ts']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no-set-active/);
    assert.match(r.stdout, /Bad\.ts:1/);
});

test('CLI exits 0 on clean input', (t) => {
    const dir = sandbox(t);
    mkdirSync(join(dir, 'assets', 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'assets/scripts/Good.ts'), 'export const f = () => { n.active = true; };');

    const r = runCli(dir, ['--file', 'assets/scripts/Good.ts']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /clean/);
});

test('--all walks assets/scripts recursively', (t) => {
    const dir = sandbox(t);
    mkdirSync(join(dir, 'assets', 'scripts', 'systems'), { recursive: true });
    writeFileSync(join(dir, 'assets/scripts/systems/Deep.ts'), 'x.setActive(false);');

    const r = runCli(dir, ['--all', '--json']);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.findings.length, 1);
    assert.equal(out.findings[0].file, 'assets/scripts/systems/Deep.ts');
});

test('CLI exits 2 when given nothing to scan', (t) => {
    const dir = sandbox(t);
    const r = runCli(dir, []);
    assert.equal(r.status, 2);
});

test('a missing file is not an error', (t) => {
    const dir = sandbox(t);
    const r = runCli(dir, ['--file', 'assets/scripts/Gone.ts']);
    assert.equal(r.status, 0);
});
