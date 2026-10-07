import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'clone-scene.js');

const SRC_UUID = '66bbed50-b375-4916-a5c2-4b01dad0ffd4';
const DEV_UUID = '6bb503a1-d5b8-47ba-85f1-b1cfd5e5c5d3';
const PREFAB_UUID = '11111111-2222-3333-4444-555555555555';

// Scene shaped like a real Cocos 3.8 one: scene-local PrefabInfo refs carry the
// scene uuid, a nested prefab instance keeps its own asset uuid and fileIds.
function makeScene(name) {
    const sceneRef = { __uuid__: SRC_UUID, __expectedType__: 'cc.SceneAsset' };
    return [
        { __type__: 'cc.SceneAsset', _name: name, scene: { __id__: 1 } },
        { __type__: 'cc.Scene', _name: name, _children: [{ __id__: 2 }], _prefab: null, _id: SRC_UUID },
        { __type__: 'cc.Node', _name: 'Canvas', _parent: { __id__: 1 }, _children: [{ __id__: 5 }],
          _components: [{ __id__: 3 }], _prefab: { __id__: 4 }, _id: 'beI88Z2HpFELqR4T5EMHpg' },
        { __type__: 'cc.UITransform', node: { __id__: 2 }, __prefab: { __id__: 7 }, _id: 'e3S4HE3qVBRL/o2fL+U6iw' },
        { __type__: 'cc.PrefabInfo', root: sceneRef, asset: sceneRef, fileId: 'YRg02e9Byg9XU7PuFIO1w1' },
        { __type__: 'cc.Node', _name: 'Nested', _parent: { __id__: 2 }, _prefab: { __id__: 6 }, _id: '' },
        { __type__: 'cc.PrefabInfo', root: { __id__: 5 },
          asset: { __uuid__: PREFAB_UUID, __expectedType__: 'cc.Prefab' }, fileId: 'nestedFileId0000000000' },
        { __type__: 'cc.CompPrefabInfo', fileId: 'compFileId000000000000' },
    ];
}

function setupProject(t, { builder = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'clone-scene-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'assets', 'scenes'), { recursive: true });
    writeFileSync(join(dir, 'assets/scenes/Start.scene'), JSON.stringify(makeScene('Start'), null, 2));
    writeFileSync(join(dir, 'assets/scenes/Start.scene.meta'), JSON.stringify({
        ver: '1.1.50', importer: 'scene', imported: true, uuid: SRC_UUID,
        files: ['.json'], subMetas: {}, userData: {},
    }, null, 2));
    if (builder) {
        mkdirSync(join(dir, 'profiles/v2/packages'), { recursive: true });
        const start = { url: 'db://assets/scenes/Start.scene', uuid: SRC_UUID };
        const dev = { url: 'db://assets/scenes/CustomLevels.scene', uuid: DEV_UUID };
        writeFileSync(join(dir, 'profiles/v2/packages/builder.json'), JSON.stringify({
            __version__: '1.3.9',
            common: { scenes: [start, dev], startScene: SRC_UUID },
            BuildTaskManager: { taskMap: {
                1: { options: { taskName: 'web-mobile-vk', scenes: [start] } },
                2: { options: { taskName: 'dev-only', scenes: [dev] } },
            } },
        }, null, 2));
    }
    return dir;
}

function run(dir, ...args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
}

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

test('clone gets a new uuid everywhere the old one was', (t) => {
    const dir = setupProject(t);
    const r = run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    assert.equal(r.status, 0, r.stderr);

    const meta = readJson(join(dir, 'assets/scenes/Store.scene.meta'));
    assert.notEqual(meta.uuid, SRC_UUID);
    assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(meta.importer, 'scene');

    const text = readFileSync(join(dir, 'assets/scenes/Store.scene'), 'utf8');
    assert.ok(!text.includes(SRC_UUID), 'old scene uuid must not survive');
    const scene = JSON.parse(text);
    assert.equal(scene[1]._id, meta.uuid);
    assert.equal(scene[4].root.__uuid__, meta.uuid);
    assert.equal(scene[4].asset.__uuid__, meta.uuid);
});

test('node and component ids are regenerated, structure and fileIds kept', (t) => {
    const dir = setupProject(t);
    run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    const src = makeScene('Start');
    const out = readJson(join(dir, 'assets/scenes/Store.scene'));

    assert.equal(out.length, src.length);
    assert.notEqual(out[2]._id, src[2]._id);
    assert.notEqual(out[3]._id, src[3]._id);
    assert.match(out[2]._id, /^[A-Za-z0-9+/]{22}$/);
    assert.equal(out[5]._id, '', 'empty id of a nested prefab node stays empty');
    assert.deepEqual(out[2]._children, src[2]._children);
    assert.deepEqual(out[3].node, src[3].node);
    assert.equal(out[4].fileId, src[4].fileId);
    assert.equal(out[6].fileId, src[6].fileId);
    assert.equal(out[6].asset.__uuid__, PREFAB_UUID, 'other asset refs untouched');
    assert.equal(out[7].fileId, src[7].fileId);
});

test('scene name defaults to the file name, --name overrides', (t) => {
    const dir = setupProject(t);
    run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    let out = readJson(join(dir, 'assets/scenes/Store.scene'));
    assert.equal(out[0]._name, 'Store');
    assert.equal(out[1]._name, 'Store');
    assert.equal(out[2]._name, 'Canvas');

    run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Shop.scene', '--name', 'Магазин');
    out = readJson(join(dir, 'assets/scenes/Shop.scene'));
    assert.equal(out[1]._name, 'Магазин');
});

test('clone joins common scenes and the tasks that ship the source', (t) => {
    const dir = setupProject(t);
    run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    const uuid = readJson(join(dir, 'assets/scenes/Store.scene.meta')).uuid;
    const b = readJson(join(dir, 'profiles/v2/packages/builder.json'));
    const entry = { url: 'db://assets/scenes/Store.scene', uuid };

    assert.deepEqual(b.common.scenes.at(-1), entry);
    assert.deepEqual(b.BuildTaskManager.taskMap[1].options.scenes.at(-1), entry);
    assert.equal(b.BuildTaskManager.taskMap[2].options.scenes.length, 1, 'task without the source untouched');
    assert.equal(b.common.startScene, SRC_UUID, 'start scene untouched');
});

test('re-run is idempotent: no second copy, no duplicate build entries', (t) => {
    const dir = setupProject(t);
    run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    const before = readFileSync(join(dir, 'assets/scenes/Store.scene'), 'utf8');
    const r = run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(dir, 'assets/scenes/Store.scene'), 'utf8'), before);
    const b = readJson(join(dir, 'profiles/v2/packages/builder.json'));
    assert.equal(b.common.scenes.length, 3);
    assert.equal(b.BuildTaskManager.taskMap[1].options.scenes.length, 2);
});

test('re-run after the build list lost the scene restores it with the existing uuid', (t) => {
    const dir = setupProject(t);
    run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene', '--no-build');
    const uuid = readJson(join(dir, 'assets/scenes/Store.scene.meta')).uuid;
    assert.equal(readJson(join(dir, 'profiles/v2/packages/builder.json')).common.scenes.length, 2);

    run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    const b = readJson(join(dir, 'profiles/v2/packages/builder.json'));
    assert.equal(b.common.scenes.at(-1).uuid, uuid);
});

test('--dry-run writes nothing', (t) => {
    const dir = setupProject(t);
    const builderBefore = readFileSync(join(dir, 'profiles/v2/packages/builder.json'), 'utf8');
    const r = run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene', '--dry-run');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[dry-run\]/);
    assert.ok(!existsSync(join(dir, 'assets/scenes/Store.scene')));
    assert.ok(!existsSync(join(dir, 'assets/scenes/Store.scene.meta')));
    assert.equal(readFileSync(join(dir, 'profiles/v2/packages/builder.json'), 'utf8'), builderBefore);
});

test('missing build settings: clone still made, warning printed', (t) => {
    const dir = setupProject(t, { builder: false });
    const r = run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/scenes/Store.scene');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, 'assets/scenes/Store.scene')));
    assert.match(r.stderr, /Build settings not found/);
});

test('misuse exits non-zero', (t) => {
    const dir = setupProject(t);
    assert.notEqual(run(dir, '--file', 'assets/scenes/Start.scene').status, 0);
    assert.notEqual(run(dir, '--file', 'assets/scenes/Nope.scene', '--out', 'assets/scenes/X.scene').status, 0);
    assert.notEqual(run(dir, '--file', 'assets/scenes/Start.scene', '--out', 'assets/X.prefab').status, 0);
});
