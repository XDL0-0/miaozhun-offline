import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {parse} from '../scripts/vendor/acorn.cjs';
import {c as oldBlankScene, p as parseOldScene} from '../site/js/De-4Vn7b.js';
import {p as parseScene} from '../upstream/aimpro-2026-11-05/client/js/B3BEvzMF.js';
import {applyUpstreamStoragePatch, upstreamStorageCompatibility} from '../patches/upstream-storage.mjs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const editorName = 'BUMqqtoc.js';
const originals = {[editorName]: read(`../upstream/aimpro-2026-11-05/client/js/${editorName}`)};
const patched = applyUpstreamStoragePatch(originals);
const replaySource = read('../upstream/aimpro-2026-11-05/client/js/CU9F0OR3.js');
const playbackSource = read('../upstream/aimpro-2026-11-05/client/js/0zdT-Ype.js');
const backupSource = read('../offline-runtime.js');
const clone = value => JSON.parse(JSON.stringify(value));
const asts = new Map();
function ast(source) {
  if (!asts.has(source)) asts.set(source, parse(source, {ecmaVersion: 'latest', sourceType: 'module'}));
  return asts.get(source);
}
function walk(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
    if (child?.type) { const found = walk(child, predicate); if (found) return found; }
  }
  return null;
}
function sourceNode(source, predicate) {
  const node = walk(ast(source), predicate);
  assert.ok(node, 'expected node in retained upstream source');
  return source.slice(node.start, node.end);
}
const declaration = (source, name) => sourceNode(source, node => node.type === 'FunctionDeclaration' && node.id?.name === name);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

function editorFixture({mismatch = false, invalid = null, writeFailure, sceneGate} = {}) {
  const source = patched[editorName], calls = [];
  const flush = sourceNode(source, node => node.type === 'VariableDeclarator' && node.id?.name === '__aimFlushBeforeLanguage');
  const install = sourceNode(source, node => node.type === 'AssignmentExpression' && node.left?.property?.name === '__aimBeforeLanguageChange' && node.right?.name === '__aimFlushBeforeLanguage');
  const unmount = sourceNode(source, node => node.type === 'CallExpression' && node.callee?.name === 'ko' && walk(node.arguments[0], child => child.type === 'MemberExpression' && child.property?.name === '__aimBeforeLanguageChange'));
  const sceneStarted = deferred();
  const doc = oldBlankScene(42);
  let saved, cleanup;
  const context = vm.createContext({
    a: {doc, markClean() { calls.push('clean'); }},
    Hn: async () => { calls.push('nextTick'); doc.meta.name = '刚刚编辑的场景'; },
    cl: 42, pl: 43,
    document: {activeElement: {blur() { calls.push('blur'); }}, removeEventListener() {}},
    window: {clearTimeout(id) { calls.push(`clear:${id}`); }, removeEventListener() {}},
    Xn: () => { calls.push('validate'); return invalid; },
    H: {
      async save(value) { calls.push('save'); if (writeFailure) throw writeFailure; saved = clone(value); },
      async load() { calls.push('load'); return mismatch ? null : clone(saved); },
    },
    Nd: async () => { calls.push('scene'); sceneStarted.resolve(); await sceneGate?.promise; },
    ko(callback) { cleanup = callback; }, ec() {}, $l() {}, bl() {}, cr() {}, xe() {}, U: {exit() {}},
  });
  vm.runInContext(`const ${flush};${install};${unmount};`, context);
  return {context, calls, sceneStarted, doc, get saved() { return saved; }, cleanup: () => cleanup()};
}

test('new Studio hook commits the focused field, verifies the draft and awaits the scene save', async () => {
  const gate = deferred(), fixture = editorFixture({sceneGate: gate});
  let finished = false;
  const pending = fixture.context.__aimBeforeLanguageChange().then(() => { finished = true; });
  await fixture.sceneStarted.promise;
  assert.deepEqual(fixture.calls, ['blur', 'nextTick', 'clear:42', 'validate', 'save', 'load', 'clean', 'scene']);
  assert.deepEqual(fixture.saved, fixture.doc);
  assert.equal(fixture.saved.meta.name, '刚刚编辑的场景');
  assert.equal(finished, false);
  gate.resolve(); await pending;
  assert.equal(finished, true);
  fixture.cleanup();
  assert.equal(Object.hasOwn(fixture.context, '__aimBeforeLanguageChange'), false);
  const newerHook = async () => {};
  fixture.context.__aimBeforeLanguageChange = newerHook;
  fixture.cleanup();
  assert.equal(fixture.context.__aimBeforeLanguageChange, newerHook);
});

test('new Studio hook rejects invalid, failed or silently lost writes before permitting reload', async () => {
  for (const [options, expected] of [
    [{invalid: 'invalid scene'}, /invalid scene/],
    [{writeFailure: Error('quota exceeded')}, /quota exceeded/],
    [{mismatch: true}, /Draft was not saved/],
  ]) {
    const fixture = editorFixture(options);
    await assert.rejects(fixture.context.__aimBeforeLanguageChange(), expected);
    assert.equal(fixture.calls.includes('clean'), false);
    assert.equal(fixture.calls.includes('scene'), false);
  }
});

test('storage transform is immutable, syntax-valid, and fails closed for changed upstream anchors', () => {
  ast(patched[editorName]);
  assert.equal(originals[editorName], read(`../upstream/aimpro-2026-11-05/client/js/${editorName}`));
  assert.throws(() => applyUpstreamStoragePatch({}), /missing/);
  assert.throws(() => applyUpstreamStoragePatch(patched), /already applied/);
  assert.throws(() => applyUpstreamStoragePatch({[editorName]: originals[editorName].replace('Rd()},VL)', 'Rd()},CHANGED)')}), /version mismatch/);
  assert.equal(patched[editorName].includes('localStorage.clear('), false);
  assert.equal(patched[editorName].includes('deleteDatabase('), false);
});

// A small asynchronous IDB fixture exercises the retained adapters against an
// existing database. It tracks every mutation rather than emulating the whole
// browser API; requests and transaction completion remain asynchronous.
function existingDatabase(name, initialStores) {
  const events = [], stores = new Map(Object.entries(initialStores).map(([key, entries]) => [key, new Map(entries)]));
  const db = {
    version: 7, objectStoreNames: {contains: key => stores.has(key)},
    close() { events.push(['close']); },
    createObjectStore() { throw Error('an existing compatible store must not be recreated'); },
    transaction(names, mode) {
      events.push(['transaction', names, mode]);
      const tx = {objectStore(key) {
        const data = stores.get(key); assert.ok(data, key);
        function request(value) { const req = {}; queueMicrotask(() => { req.result = structuredClone(value); req.onsuccess?.(); }); return req; }
        return {
          keyPath: key === 'draft' ? null : 'id', autoIncrement: false,
          get: id => request(data.get(id)), getAll: () => request([...data.values()]), getAllKeys: () => request([...data.keys()]),
          put(value, id = value.id) { events.push(['put', key, id]); data.set(id, structuredClone(value)); },
          delete(id) { events.push(['delete', key, id]); data.delete(id); },
        };
      }};
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
      return tx;
    },
  };
  const indexedDB = {open(requested, version) {
    assert.equal(requested, name); events.push(['open', requested, version]);
    const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req;
  }};
  return {indexedDB, db, stores, events};
}

function studioAdapter(database) {
  const source = originals[editorName], start = source.indexOf('const Xp="aimlab-studio"');
  const factory = walk(ast(source), node => node.type === 'FunctionDeclaration' && node.id?.name === 'PP');
  assert.ok(start > 0 && factory.end > start);
  return vm.runInNewContext(source.slice(start, factory.end) + ';PP(indexedDB)', {indexedDB: database.indexedDB, fo: parseScene});
}

test('new native Studio adapter reads old draft, owner and saved scenes without a migration or write', async () => {
  const doc = oldBlankScene(77); doc.meta.name = '我的旧中文场景';
  const raw = JSON.stringify(doc), record = {id: 'old-scene-7', name: doc.meta.name, doc: raw, updatedAt: 17, shareCode: null};
  const database = existingDatabase('aimlab-studio', {
    draft: [['current', raw], ['current-owner', record.id], ['future-key', 'retained']],
    scenes: [[record.id, record]],
  });
  const store = studioAdapter(database);
  assert.deepEqual(clone(await store.load()), doc);
  assert.equal(await store.loadDraftOwner(), record.id);
  assert.deepEqual(clone(await store.loadById(record.id)), doc);
  assert.deepEqual(clone(await store.listSaved()), [{id: record.id, name: doc.meta.name, updatedAt: 17, shareCode: null}]);
  assert.equal(database.events.filter(event => event[0] === 'open').length, 1);
  assert.equal(database.events.some(event => ['put', 'delete'].includes(event[0])), false);
  assert.equal(database.stores.get('draft').get('future-key'), 'retained');
  assert.equal(database.stores.get('scenes').get(record.id).doc, raw);
  // A normal later edit writes the existing slot without deleting other data.
  doc.meta.name = 'Updated name'; await store.save(doc);
  assert.deepEqual(clone(await store.load()), doc);
  assert.equal(await store.loadDraftOwner(), record.id);
  assert.equal(database.stores.get('scenes').get(record.id).doc, raw);
});

test('new scene parser accepts an old schema-2 scene without rewriting its JSON', () => {
  const scene = oldBlankScene(13); scene.meta.name = 'Original 用户场景';
  const raw = JSON.stringify(scene);
  assert.equal(JSON.stringify(parseScene(raw)), raw);
});

function replayAdapter(database, decode) {
  const start = replaySource.indexOf("const Sa='aimlab-replay'");
  const factory = walk(ast(replaySource), node => node.type === 'FunctionDeclaration' && node.id?.name === 'Hl');
  assert.ok(start > 0 && factory.end > start);
  return vm.runInNewContext(replaySource.slice(start, factory.end) + ';Hl()', {indexedDB: database.indexedDB, b7: decode});
}

test('new native replay adapter retains old index summaries and passes stored bytes unchanged to the decoder', async () => {
  const meta = {id: 'old-replay', recordedAt: 42, duration: 1, sceneId: 'scene-77', engineVersion: 'old-engine'};
  const summary = {drillId: 'tracking', variant: 'old', score: 17, accuracy: .5, hits: 1, shots: 2};
  const bytes = Uint8Array.from([0x41, 0x49, 0x4d, 0x52, 1, 2, 3]);
  const database = existingDatabase('aimlab-replay', {index: [[meta.id, {id: meta.id, meta, summary}]], blob: [[meta.id, {id: meta.id, bytes}]]});
  let decoded;
  const store = replayAdapter(database, async value => { decoded = new Uint8Array(value); return {meta}; });
  assert.deepEqual(clone(await store.list()), [{meta, summary}]);
  assert.deepEqual(Array.from(await store.loadBytes(meta.id)), Array.from(bytes));
  assert.deepEqual(await store.load(meta.id), {meta});
  assert.deepEqual(decoded, bytes);
  assert.equal(database.events.some(event => ['put', 'delete'].includes(event[0])), false);
  assert.equal(database.events.filter(event => event[0] === 'open').length, 1);
  assert.equal(database.stores.get('index').get(meta.id).summary.drillId, 'tracking');
});

function nativeReplayCodec(old) {
  const source = read(old ? '../site/js/aQOfOAp-.js' : '../upstream/aimpro-2026-11-05/client/js/CqM6URxy.js');
  const start = source.indexOf(old ? 'const tA=1' : 'const cp=1');
  const decoder = walk(ast(source), node => node.type === 'FunctionDeclaration' && node.id?.name === (old ? 'kD' : 'KQ'));
  assert.ok(start > 0 && decoder.end > start);
  // The complete native codec region includes validation, gzip, SHA-256,
  // container framing and metadata parsing. Only the scene parser and tick
  // constant are dependencies outside this region.
  return vm.runInNewContext(source.slice(start, decoder.end) + (old
    ? ';({encode:QD,decode:kD,engineVersion:ND,rulesVersion:FD})'
    : ';({encode:XQ,decode:KQ,engineVersion:WQ,rulesVersion:GQ})'), {
    Jo: 128, Fc: 128, g0: parseOldScene, S1: parseScene,
    crypto: webcrypto, CompressionStream, DecompressionStream, TextEncoder, TextDecoder,
  });
}

test('real old replay encoder bytes load through the new database adapter and complete native decoder', async () => {
  const old = nativeReplayCodec(true), current = nativeReplayCodec(false), scene = oldBlankScene(77);
  const state = (tick, x) => ({
    tick, nextActorId: 0, lastFireTick: null, firedThisPress: false, sensitivity: 1,
    rng: {seed: 77, state: 0}, shotRng: {seed: 77, state: 0}, spawnerRng: [], spawnerRuntimes: [], actors: [],
    player: {position: {x, y: 0, z: 0}, velocity: {x: 0, y: 0}, verticalVelocity: 0, grounded: true, crouchAmount: 0, stationaryTicks: 0, yaw: 0, pitch: 0},
  });
  const meta = {id: 'real-old-replay', sceneId: scene.meta.id, sceneHash: 'legacy-scene-hash', engineVersion: old.engineVersion, rulesVersion: old.rulesVersion, seed: 77, tickRate: 128, duration: 4 / 128, sensitivity: 1, recordedAt: 42, aspect: 16 / 9, fov: 90};
  const doc = {schemaVersion: 1, meta, scene, inputs: new Uint8Array(20), sensitivityChanges: [], keyframes: [{tick: 0, state: state(0, 0)}, {tick: 4, state: state(4, 8)}], events: [], result: {mode: 'tracking', variant: 'normal', duration: 4 / 128, hits: 0, shots: 0, score: 0, accuracy: 0}, transcriptHash: '', verified: 'unranked'};
  const bytes = await old.encode(doc), originalBytes = Array.from(bytes);
  const database = existingDatabase('aimlab-replay', {index: [[meta.id, {id: meta.id, meta}]], blob: [[meta.id, {id: meta.id, bytes}]]});
  const store = replayAdapter(database, current.decode), loaded = await store.load(meta.id);
  assert.ok(loaded, 'old gzip container and its validated metadata must decode');
  assert.deepEqual(clone(loaded.meta), meta);
  assert.deepEqual(clone(loaded.scene), scene);
  assert.deepEqual(clone(loaded.keyframes), doc.keyframes);
  assert.deepEqual(clone(loaded.result), doc.result);
  assert.deepEqual(Array.from(loaded.inputs), Array.from(doc.inputs));
  assert.match(loaded.transcriptHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(Array.from(await store.loadBytes(meta.id)), originalBytes);
  assert.equal(database.events.some(event => ['put', 'delete'].includes(event[0])), false);
  // Both releases still identify the engine as p7. A historical recording is
  // not guaranteed to switch modes immediately: kernel/drift checks also matter.
  assert.equal(old.engineVersion, 'p7'); assert.equal(current.engineVersion, 'p7');
  assert.equal(old.rulesVersion, 'aimlab-34'); assert.equal(current.rulesVersion, 'aimlab-42');
});

test('native playback uses keyframes on an old engine and does not step the current simulation', () => {
  let steps = 0;
  const player = x => ({position: {x, y: 0, z: 0}, yaw: 0, pitch: 0});
  const scene = {meta: {id: 'scene-77', seed: 77}};
  const frame = (tick, x) => ({tick, state: {tick, player: player(x), actors: [], ammo: 25, reloadStartTick: -1}});
  const doc = {meta: {sceneId: scene.meta.id, seed: 77, tickRate: 128, engineVersion: 'old-engine', sensitivity: 1}, inputs: [{}, {}, {}, {}], keyframes: [frame(0, 0), frame(4, 8)], sensitivityChanges: []};
  const createPlayback = vm.runInNewContext(declaration(playbackSource, 'rn') + ';rn', {
    Ve: 128, Tt: 'new-engine', ct: value => value,
    Gt: () => ({saveState: () => doc.keyframes[0].state, step() { steps++; throw Error('current engine must not re-simulate old-engine data'); }}),
    Wt: () => new Map(), qt: () => new Map(), Zt: () => new Map(), Jt: () => new Map(), tn: () => new Map(), sn: () => new Map(), on: () => new Map(),
    Ze: [], na: value => clone(value), Ke: value => clone(value),
    sa: (from, to, ratio) => ({position: {x: from.position.x + (to.position.x - from.position.x) * ratio, y: 0, z: 0}, yaw: 0, pitch: 0}),
    xe: message => { throw Error(message); },
  });
  const before = JSON.stringify(doc), playback = createPlayback(doc, scene);
  assert.equal(playback.mode, 'interpolated');
  assert.deepEqual(clone(playback.engineMismatch), {field: 'engineVersion', recorded: 'old-engine', current: 'new-engine'});
  playback.seek(2); assert.equal(playback.snapshot.player.position.x, 4);
  playback.stepTo(4); assert.equal(playback.snapshot.player.position.x, 8);
  playback.seek(0); assert.equal(playback.snapshot.player.position.x, 0);
  assert.equal(steps, 0);
  assert.equal(JSON.stringify(doc), before);
});

test('shared settings/results keep their storage keys and retired keys remain in full backups', () => {
  const before = read('../site/js/index.C6F_bJRd.js'), after = read('../upstream/aimpro-2026-11-05/client/js/index.FoQE3geO.js');
  const registry = source => {
    const object = sourceNode(source, node => node.type === 'ObjectExpression' && node.properties?.some(property => property.value?.value === 'al-crosshair-v1') && node.properties?.some(property => property.value?.value === 'al-workshop-runs-v1'));
    return vm.runInNewContext(`(${object})`);
  };
  const oldKeys = Object.values(registry(before)), newKeys = new Set(Object.values(registry(after)));
  assert.deepEqual(oldKeys.filter(key => !newKeys.has(key)).sort(), [...upstreamStorageCompatibility.preservedLegacyKeys].sort());
  const data = new Map(oldKeys.map(key => [key, JSON.stringify({legacy: key})]));
  data.set('unrelated-account-key', 'excluded');
  const localStorage = {get length() { return data.size; }, key: index => [...data.keys()][index], getItem: key => data.get(key)};
  const readStorage = vm.runInNewContext(declaration(backupSource, 'readStorage') + ';readStorage', {localStorage});
  const exported = readStorage();
  for (const key of oldKeys) assert.equal(exported[key], data.get(key));
  assert.equal(Object.hasOwn(exported, 'unrelated-account-key'), false);
  for (const key of upstreamStorageCompatibility.preservedLegacyKeys) assert.equal(after.includes(key), false);
});

test('existing complete backup format accepts old draft and replay index records without field loss', () => {
  const scene = oldBlankScene(42), raw = JSON.stringify(scene);
  const studio = {schema: 1, draft: [{key: 'current', value: raw}, {key: 'current-owner', value: 'saved-old'}], scenes: [{id: 'saved-old', name: '旧场景', doc: raw, updatedAt: 42, shareCode: 'old-share'}]};
  const meta = {id: 'old-replay', recordedAt: 42, duration: 1, sceneId: scene.meta.id};
  const replays = {schema: 1, index: [{id: meta.id, meta, summary: {drillId: 'legacy', variant: 'old', score: 3}}], blob: [{id: meta.id, base64: 'AQID'}]};
  const codec = vm.runInNewContext(['checkSceneJSON', 'decodeStudio', 'decodeReplays'].map(name => declaration(backupSource, name)).join('\n') + ';({decodeStudio,decodeReplays})', {atob});
  assert.equal(JSON.stringify(codec.decodeStudio(studio)), JSON.stringify(studio));
  const restored = codec.decodeReplays(replays);
  assert.deepEqual(clone(restored.index), replays.index);
  assert.deepEqual(Array.from(restored.blob[0].bytes), [1, 2, 3]);
});
