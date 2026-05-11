import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'replace-label-font.js');

const FONT_UUID = 'a61f84d1-0c82-453e-a8ad-4e0725785f69';
const OTHER_UUID = '22ca0e8b-5706-4779-bd7a-b11714cdf316';

function setupSandbox(t) {
    const dir = mkdtempSync(join(tmpdir(), 'rlf-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function writeFontMeta(dir, uuid = FONT_UUID, name = 'Factor-A-Regular-Web.ttf') {
    const metaPath = join(dir, name + '.meta');
    writeFileSync(metaPath, JSON.stringify({
        ver: '1.0.1',
        importer: 'ttf-font',
        uuid,
        files: ['.json', name],
        subMetas: {},
        userData: {},
    }));
    return metaPath;
}

/**
 * Build a tiny scene: one cc.Node with a cc.Label child component.
 * `labelOverrides` lets each test customise the label's font fields.
 */
function makeScene(labelsConfig) {
    const objects = [];
    objects.push({ __type__: 'cc.SceneAsset' }); // index 0 placeholder
    let nextId = 1;
    for (const cfg of labelsConfig) {
        const nodeId = nextId++;
        const labelId = nextId++;
        objects[nodeId] = {
            __type__: 'cc.Node',
            _name: cfg.nodeName,
            _components: [{ __id__: labelId }],
        };
        objects[labelId] = {
            __type__: 'cc.Label',
            node: { __id__: nodeId },
            _string: cfg.text || '',
            _fontFamily: 'Arial',
            _isSystemFontUsed: cfg.sys === true,
            _font: cfg.fontUuid
                ? { __uuid__: cfg.fontUuid, __expectedType__: 'cc.TTFFont' }
                : null,
        };
    }
    return objects;
}

function run(args, env = {}) {
    return spawnSync('node', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
}

test('replaces system Arial labels with the TTF font (default mode)', (t) => {
    const dir = setupSandbox(t);
    const fontMeta = writeFontMeta(dir);
    const scene = join(dir, 'a.scene');
    writeFileSync(scene, JSON.stringify(makeScene([
        { nodeName: 'A', text: 'sys-1', sys: true },
        { nodeName: 'B', text: 'sys-2', sys: true },
        { nodeName: 'C', text: 'ttf',  sys: false, fontUuid: OTHER_UUID },
    ])));

    const r = run(['--file', scene, '--font-meta', fontMeta], { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0, r.stderr);

    const objs = JSON.parse(readFileSync(scene, 'utf8'));
    const labels = objs.filter(o => o && o.__type__ === 'cc.Label');
    assert.equal(labels.length, 3);

    // A & B (were system) → target font, sys=false
    assert.equal(labels[0]._isSystemFontUsed, false);
    assert.equal(labels[0]._font.__uuid__, FONT_UUID);
    assert.equal(labels[0]._font.__expectedType__, 'cc.TTFFont');
    assert.equal(labels[1]._isSystemFontUsed, false);
    assert.equal(labels[1]._font.__uuid__, FONT_UUID);
    // C (was custom TTF) → untouched in default mode
    assert.equal(labels[2]._font.__uuid__, OTHER_UUID);
});

test('keeps _fontFamily as-is (matches Hello example)', (t) => {
    const dir = setupSandbox(t);
    const fontMeta = writeFontMeta(dir);
    const scene = join(dir, 'a.scene');
    writeFileSync(scene, JSON.stringify(makeScene([
        { nodeName: 'A', text: 'sys-1', sys: true },
    ])));

    const r = run(['--file', scene, '--font-meta', fontMeta], { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0, r.stderr);

    const objs = JSON.parse(readFileSync(scene, 'utf8'));
    const label = objs.find(o => o && o.__type__ === 'cc.Label');
    assert.equal(label._fontFamily, 'Arial');
});

test('--mode all also rewrites labels that already have a TTF', (t) => {
    const dir = setupSandbox(t);
    const fontMeta = writeFontMeta(dir);
    const scene = join(dir, 'a.scene');
    writeFileSync(scene, JSON.stringify(makeScene([
        { nodeName: 'A', text: 'ttf', sys: false, fontUuid: OTHER_UUID },
    ])));

    const r = run(['--file', scene, '--font-meta', fontMeta, '--mode', 'all'],
        { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0, r.stderr);

    const objs = JSON.parse(readFileSync(scene, 'utf8'));
    const label = objs.find(o => o && o.__type__ === 'cc.Label');
    assert.equal(label._font.__uuid__, FONT_UUID);
});

test('--dry-run does not write the file', (t) => {
    const dir = setupSandbox(t);
    const fontMeta = writeFontMeta(dir);
    const scene = join(dir, 'a.scene');
    const before = JSON.stringify(makeScene([
        { nodeName: 'A', text: 'sys-1', sys: true },
    ]));
    writeFileSync(scene, before);

    const r = run(['--file', scene, '--font-meta', fontMeta, '--dry-run'],
        { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(scene, 'utf8'), before);
});

test('idempotent — file content is stable across re-runs', (t) => {
    const dir = setupSandbox(t);
    const fontMeta = writeFontMeta(dir);
    const scene = join(dir, 'a.scene');
    writeFileSync(scene, JSON.stringify(makeScene([
        { nodeName: 'A', text: 'sys-1', sys: true },
    ])));

    const r1 = run(['--file', scene, '--font-meta', fontMeta], { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r1.status, 0, r1.stderr);
    const after1 = readFileSync(scene, 'utf8');

    // Default mode after the first pass: label is no longer system → "no matching".
    const r2 = run(['--file', scene, '--font-meta', fontMeta], { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(readFileSync(scene, 'utf8'), after1);

    // --mode all should hit the "already on target" branch and still not change the file.
    const r3 = run(['--file', scene, '--font-meta', fontMeta, '--mode', 'all'],
        { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r3.status, 0, r3.stderr);
    assert.match(r3.stdout, /already on target/);
    assert.equal(readFileSync(scene, 'utf8'), after1);
});

test('fails if font meta is not a TTF importer', (t) => {
    const dir = setupSandbox(t);
    const badMeta = join(dir, 'thing.png.meta');
    writeFileSync(badMeta, JSON.stringify({ importer: 'image', uuid: FONT_UUID }));
    const scene = join(dir, 'a.scene');
    writeFileSync(scene, JSON.stringify(makeScene([
        { nodeName: 'A', text: 'sys', sys: true },
    ])));

    const r = run(['--file', scene, '--font-meta', badMeta], { CLAUDE_PROJECT_DIR: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /TTF font meta/);
});

test('reports zero matches without crashing', (t) => {
    const dir = setupSandbox(t);
    const fontMeta = writeFontMeta(dir);
    const scene = join(dir, 'a.scene');
    writeFileSync(scene, JSON.stringify(makeScene([
        { nodeName: 'A', text: 'ttf', sys: false, fontUuid: OTHER_UUID },
    ])));

    const r = run(['--file', scene, '--font-meta', fontMeta], { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No matching cc\.Label/);
});
