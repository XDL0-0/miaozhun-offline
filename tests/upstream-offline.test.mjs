import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from '../scripts/vendor/acorn.cjs';
import {applyUpstreamOfflinePatch} from '../patches/upstream-offline.mjs';

const names = ['ATp_kJvD.js', 'index.FoQE3geO.js', 'BUMqqtoc.js', 'CKtkyKeR.js', 'CU9F0OR3.js', 'CHhqVNl3.js', 'WaGOTZ1D.js', '0zdT-Ype.js'];
const originals = Object.fromEntries(names.map(name => [name, fs.readFileSync(new URL(`../upstream/aimpro-2026-11-05/client/js/${name}`, import.meta.url), 'utf8')]));
const patched = applyUpstreamOfflinePatch(originals);
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
function nodeSource(source, predicate, label) {
  const node = walk(ast(source), predicate);
  assert.ok(node, `expected ${label} in the retained source`);
  return source.slice(node.start, node.end);
}
const declaration = (source, name) => nodeSource(source, node => node.type === 'FunctionDeclaration' && node.id?.name === name, name);
const variable = (source, name) => 'const ' + nodeSource(source, node => node.type === 'VariableDeclarator' && node.id?.name === name, name) + ';';
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
};
const settled = () => new Promise(resolve => setImmediate(resolve));

function replayFixture({type = 'aim', listed = true, directId = true, loadable = true} = {}) {
  const source = patched['CKtkyKeR.js'];
  const run = {id: 'old-local-run', shareCode: 'full9VMP1map', ...(type === null ? {} : {type}), ...(directId ? {replayId: 'old-local-replay'} : {})};
  const calls = [], notices = [];
  const replays = {
    replayListings: {value: listed ? [{meta: {id: 'old-local-replay'}}] : []},
    activeReplay: {value: null}, replayNotice: {value: ''},
    async playReplay(id) {
      calls.push(id);
      this.activeReplay.value = loadable ? {meta: {id}} : null;
      this.replayNotice.value = loadable ? '' : 'Local replay bytes are unavailable';
    },
  };
  const context = vm.createContext({
    b: compute => ({get value() { return compute(); }}),
    Le: {replays, workshopRuns: {runs: {value: [{id: run.id, replayId: 'old-local-replay'}]}}},
    _n: {value: [{code: run.shareCode, type: 'aim'}]},
    Kt: {records: {value: [run]}}, ll: {records: {value: []}}, Ll: {value: null},
    kt: message => notices.push(message),
    j1: () => { throw Error('a local replay must not request the cloud'); },
  });
  vm.runInContext(['xf', 'Sf', 'Mf'].map(name => variable(source, name)).join('\n') + '\n' +
    ['qa', 'If'].map(name => declaration(source, name)).join('\n') + '\nglobalThis.available = Mf;', context);
  return {context, run, calls, notices, replays};
}

test('native records expose and open retained local aim/map replays, including old run-to-replay mappings', async () => {
  for (const options of [{}, {directId: false}, {type: null, directId: false}]) {
    const fixture = replayFixture(options);
    assert.deepEqual(plain(fixture.context.qa(fixture.run)), {local: 'old-local-replay', cloud: null});
    assert.equal(fixture.context.available.value[fixture.run.id], true);
    await fixture.context.If(fixture.run);
    assert.deepEqual(fixture.calls, ['old-local-replay']);
    assert.equal(fixture.context.Ll.value, fixture.run);
    assert.deepEqual(fixture.notices, []);
  }
});

test('native replay availability still requires a local listing and preserves ball recordings', async () => {
  for (const type of ['aim', 'ball']) {
    const missing = replayFixture({type, listed: false});
    assert.equal(missing.context.qa(missing.run), null);
    assert.equal(Object.hasOwn(missing.context.available.value, missing.run.id), false);
    await missing.context.If(missing.run);
    assert.deepEqual(missing.calls, []);
    assert.equal(missing.context.Ll.value, null);
  }
  const ball = replayFixture({type: 'ball'});
  assert.deepEqual(plain(ball.context.qa(ball.run)), {local: 'old-local-replay', cloud: null});
  await ball.context.If(ball.run);
  assert.equal(ball.context.Ll.value, ball.run);
});

test('native replay action reports a stale local listing whose bytes cannot be loaded', async () => {
  const fixture = replayFixture({loadable: false});
  await fixture.context.If(fixture.run);
  assert.deepEqual(fixture.calls, ['old-local-replay']);
  assert.deepEqual(fixture.notices, ['Local replay bytes are unavailable']);
  assert.equal(fixture.context.Ll.value, null);
});

function languageFixture() {
  const gate = deferred(), calls = [], alerts = [];
  const context = vm.createContext({
    __aimI18n: {
      setLanguage(language) { calls.push(['language', language]); return gate.promise; },
      t(message) { calls.push(['translate', message]); return 'The scene could not be saved. Export it and retry.'; },
    },
    location: {reload() { calls.push(['reload']); }},
    localStorage: {setItem(...args) { calls.push(['storage', ...args]); }},
    alert: message => alerts.push(message),
  });
  vm.runInContext(declaration(patched['index.FoQE3geO.js'], 'Z8e'), context);
  return {gate, calls, alerts, change: language => context.Z8e(language)};
}

test('native language action returns the shared pending save/switch promise without reloading itself', async () => {
  const fixture = languageFixture();
  let finished = false;
  const change = fixture.change('en');
  assert.equal(typeof change?.then, 'function');
  change.then(() => { finished = true; });
  await settled();
  assert.equal(finished, false);
  assert.deepEqual(fixture.calls, [['language', 'en']]);
  fixture.gate.resolve();
  await change;
  assert.equal(finished, true);
  assert.deepEqual(fixture.calls, [['language', 'en']]);
  assert.deepEqual(fixture.alerts, []);
});

test('native language action consumes a rejected save and presents a translated recovery message', async () => {
  const fixture = languageFixture();
  const change = fixture.change('zh-CN');
  fixture.gate.reject(Error('draft verification failed'));
  await assert.doesNotReject(change);
  assert.deepEqual(fixture.calls, [
    ['language', 'zh-CN'],
    ['translate', '切换语言前无法保存当前场景，请先导出场景后重试。'],
  ]);
  assert.deepEqual(fixture.alerts, ['The scene could not be saved. Export it and retry.']);
});

function mapFixture() {
  const source = patched['0zdT-Ype.js'], calls = [], errors = [];
  const gates = {visual: deferred(), lighting: deferred(), pvs: deferred()};
  const view = {
    camera: {position: {x: 1, y: 2, z: 3}, updateProjectionMatrix() {}}, scene: {},
    bindRenderer(renderer) { calls.push(['bind', renderer]); },
    mount(actorRoot) { calls.push(['mount', actorRoot]); },
    applyEnvironment(environment) { calls.push(['environment', environment]); },
    setMapVisual(visual) { calls.push(['map', visual]); },
    updateLocalLights(position) { calls.push(['lights', position]); },
    updateMapVisibility(camera, force) { calls.push(['visibility', camera, force]); },
    dispose() { calls.push(['dispose-view']); },
  };
  const renderer = {
    domElement: {},
    render(scene, camera) { calls.push(['render', scene, camera]); },
    dispose() { calls.push(['dispose-renderer']); },
    forceContextLoss() { calls.push(['context-loss']); },
  };
  const actorRoot = {dispose() { calls.push(['dispose-actors']); }};
  const environment = {map: 'full9VMP1map'};
  let cleanup;
  const context = vm.createContext({
    ...Object.fromEntries(['c', 'b', 'u', '$', 'G', 'B', 'ee', 'se', 'N', 'v', 'W', 'j', 'Te', 'Y', 'D', 'de', 'fe', 'P', 'm'].map(name => [name, null])),
    k: renderer, I: new Map(), i: new Map(), pe: [], he: false, ae: [],
    t: {scene: {environment}, playback: {snapshot: {}}}, R: 16 / 9, O: 90,
    ks: () => view, Hn: () => actorRoot, xs: () => 75,
    __aimMaps: Object.fromEntries(Object.entries(gates).map(([kind, gate]) => [
      {visual: 'loadMapVisual', lighting: 'loadMapLighting', pvs: 'loadMapPvs'}[kind],
      map => { calls.push(['load', kind, map]); return gate.promise; },
    ])),
    wt: 'idle', _n: () => false, xn: () => false, An() {},
    a: event => calls.push(['event', event]),
    lt: callback => { cleanup = callback; },
    console: {error: (...args) => errors.push(args)},
  });
  const mount = walk(ast(source), node => node.type === 'CallExpression' && node.callee?.name === 'it' &&
    walk(node.arguments[0], child => child.type === 'Identifier' && child.name === '__aimMaps'));
  assert.ok(mount, 'real replay mount callback must contain map loading');
  const statements = mount.arguments[0].body.body;
  const start = statements.findIndex(node => node.type === 'ExpressionStatement' &&
    walk(node, child => child.type === 'CallExpression' && child.callee?.name === 'ks'));
  assert.ok(start >= 0);
  assert.equal(statements[start + 1].type, 'VariableDeclaration');
  assert.equal(statements[start + 2].type, 'IfStatement');
  const mountSource = statements.slice(start, start + 3).map(node => source.slice(node.start, node.end)).join('\n');
  const disposed = nodeSource(source, node => node.type === 'VariableDeclarator' && node.id?.name === '__aimReplayDisposed', 'replay lifecycle flag');
  const unmount = nodeSource(source, node => node.type === 'CallExpression' && node.callee?.name === 'lt' &&
    walk(node.arguments[0], child => child.type === 'AssignmentExpression' && child.left?.name === '__aimReplayDisposed'), 'replay teardown');
  vm.runInContext(`let ${disposed};\n${declaration(source, 'ye')}\n${unmount};\n${mountSource}`, context);
  return {calls, errors, gates, view, renderer, environment, actorRoot, cleanup: () => cleanup()};
}

test('native replay binds its renderer and waits for map visual, lighting and PVS before rendering', async () => {
  const fixture = mapFixture(), visual = {id: 'map-visual'};
  assert.deepEqual(fixture.calls.map(call => call[0]), ['bind', 'mount', 'load', 'load', 'load']);
  assert.equal(fixture.calls[0][1], fixture.renderer);
  assert.deepEqual(fixture.calls.filter(call => call[0] === 'load').map(call => call.slice(1)), [
    ['visual', 'full9VMP1map'], ['lighting', 'full9VMP1map'], ['pvs', 'full9VMP1map'],
  ]);
  fixture.gates.visual.resolve(visual);
  fixture.gates.lighting.resolve({});
  await settled();
  assert.equal(fixture.calls.some(call => call[0] === 'map'), false);
  fixture.gates.pvs.resolve({});
  await settled();
  assert.deepEqual(fixture.calls.slice(5).map(call => call[0]), ['environment', 'map', 'lights', 'visibility', 'render', 'event']);
  assert.equal(fixture.calls[5][1], fixture.environment);
  assert.equal(fixture.calls[6][1], visual);
  assert.equal(fixture.calls[8][2], false);
  assert.deepEqual(fixture.errors, []);
});

test('native replay teardown detaches the map before disposal and ignores late map loads', async () => {
  const fixture = mapFixture();
  fixture.cleanup();
  assert.deepEqual(fixture.calls.slice(5), [
    ['map', null], ['dispose-actors'], ['dispose-view'], ['dispose-renderer'], ['context-loss'],
  ]);
  const afterCleanup = fixture.calls.length;
  fixture.gates.visual.resolve({id: 'late-map'});
  fixture.gates.lighting.resolve({});
  fixture.gates.pvs.resolve({});
  await settled();
  assert.equal(fixture.calls.length, afterCleanup);
  assert.deepEqual(fixture.errors, []);
});

test('native replay reports a failed map dependency without attaching a partial map', async () => {
  const fixture = mapFixture(), failure = Error('missing local map lighting');
  fixture.gates.visual.resolve({id: 'map-visual'});
  fixture.gates.lighting.reject(failure);
  fixture.gates.pvs.resolve({});
  await settled();
  assert.deepEqual(fixture.errors, [['Replay map failed', failure]]);
  assert.equal(fixture.calls.some(call => call[0] === 'map' || call[0] === 'render'), false);
});
