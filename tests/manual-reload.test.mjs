import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyManualReloadPatch} from '../patches/manual-reload.mjs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const training = read('../site/js/CymPR-fm.js');
const settings = read('../site/js/DCKWp-_u.js');
const sources = {'CymPR-fm.js':training, 'unrelated.js':'unchanged'};
const patched = applyManualReloadPatch(sources);
const importSource = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const [kernel, weapons] = await Promise.all([
  importSource(read('../site/aim-kernels/kernel-aimlab-33-fb63b0247dad.js')),
  importSource(read('../site/js/B51EgnC9.js')),
]);

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `original code fragment: ${startMarker}`);
  return source.slice(start, end);
}

const dispatchText = between(patched['CymPR-fm.js'], 'te.takeReloadPresses()>0', ',te.takeUsePresses()');
const gateText = between(patched['CymPR-fm.js'], 'Us=()=>', ',ls=()=>');

function nativeInput() {
  const eventTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, handler) {listeners.set(type, [...listeners.get(type) ?? [], handler]);},
      removeEventListener(type, handler) {listeners.set(type, (listeners.get(type) ?? []).filter(fn => fn !== handler));},
      dispatch(type, event) {for (const handler of listeners.get(type) ?? []) handler(event);},
    };
  };
  const canvas = eventTarget(), document = eventTarget(), window = eventTarget();
  document.pointerLockElement = canvas;
  // Run the original bindings, cloning, lookup, and input collector together.
  const bindings = between(settings, 'const he={moveForward:', 'const ns=new RegExp');
  const helpers = vm.runInNewContext(`${bindings};({ga:he,fi:wn,Ur:ts,Mt:tm,Ha:Yl,wa:Zn})`);
  const collector = between(training, 'function Cm(){', 'const Al=');
  const input = vm.runInNewContext(`${collector};Cm()`, {
    ...helpers, document, window, Im:()=>false, bl:()=>null,
  });
  input.attach(canvas);
  input.setEnabled(true);
  return {
    input,
    key(code, repeat=false) {document.dispatch('keydown', {code, repeat, target:canvas, preventDefault(){}});},
    release(code) {document.dispatch('keyup', {code});},
  };
}

function dispatcher({input, phase='running', weapon='vandal', limitedAmmo=false, legacy=false, sim}={}) {
  let requests = 0, records = 0;
  const context = vm.createContext({
    te:input ?? {takeReloadPresses:()=>1},
    ke:{requestReload() {requests++; sim?.requestReload();}},
    nt:{recordReload() {records++;}},
    t:{phase:{current:phase}, reloadAnyAmmo:{current:legacy}},
    Tt:{limitedAmmo}, qe:()=>weapon, Xc:weapons.U,
  });
  vm.runInContext(`var ${gateText};`, context);
  return {run:()=>vm.runInContext(dispatchText, context), counts:()=>({requests,records})};
}

const input = fire => ({forward:0,strafe:0,mouseDx:0,mouseDy:0,jump:false,crouch:false,walk:false,fire});
function world(limitedAmmo=false) {
  const scene = kernel.builtinScene('six', 123);
  scene.rules = {...scene.rules, limitedAmmo, weapon:'vandal', fireMode:'hold'};
  return kernel.createSimWorld(scene, {sensitivity:1});
}
const shots = events => events.filter(event => event.kind === 'shot');
const reloadTicks = Math.ceil(weapons.o('vandal').reloadSeconds / kernel.TICK_SECONDS);

test('patch changes only the ammunition gate, without mutating its sources', () => {
  const before = 'Us=()=>Tt?.limitedAmmo===!0||t.reloadAnyAmmo?.current===!0';
  const after = 'Us=()=>Xc(qe()).canFire';
  assert.equal(training.split(before).length - 1, 1);
  assert.equal(patched['CymPR-fm.js'], training.replace(before, after));
  assert.equal(sources['CymPR-fm.js'], training);
  assert.equal(patched['unrelated.js'], sources['unrelated.js']);
  assert.equal(patched['CymPR-fm.js'].includes(dispatchText), true);
});

test('patch rejects missing, changed, duplicated, and already patched module versions', () => {
  assert.throws(()=>applyManualReloadPatch({}), /module missing/i);
  assert.throws(()=>applyManualReloadPatch({...sources,'CymPR-fm.js':'changed upstream'}), /version mismatch/i);
  assert.throws(()=>applyManualReloadPatch({...sources,'CymPR-fm.js':training+training}), /version mismatch/i);
  assert.throws(()=>applyManualReloadPatch(patched), /already applied/i);
});

test('original default and custom reload bindings dispatch and record infinite-ammo reloads', () => {
  const {input:collector,key,release} = nativeInput();
  const sim = world();
  const dispatch = dispatcher({input:collector,sim});
  key('KeyR'); dispatch.run();
  assert.deepEqual(dispatch.counts(), {requests:1,records:1});
  assert.equal(sim.snapshot().ammo, null);
  assert.equal(sim.snapshot().reloadSince, 0);
  dispatch.run();
  key('KeyR', true); dispatch.run();
  assert.deepEqual(dispatch.counts(), {requests:1,records:1}, 'draining and key repeat do not create more presses');
  release('KeyR');
  collector.setKeybinds({reload:['KeyL','KeyP']});
  key('KeyR'); dispatch.run(); release('KeyR');
  assert.deepEqual(dispatch.counts(), {requests:1,records:1}, 'old key stops reloading after remapping');
  for (const code of ['KeyL','KeyP']) {key(code); dispatch.run(); release(code);}
  assert.deepEqual(dispatch.counts(), {requests:3,records:3});
  collector.detach();
});

test('original dispatch keeps phase, weapon, and missing-press gates', () => {
  for (const phase of ['paused','ready','ended']) {
    const dispatch = dispatcher({phase}); dispatch.run();
    assert.deepEqual(dispatch.counts(), {requests:0,records:0});
  }
  for (const limitedAmmo of [false,true]) for (const legacy of [false,true]) {
    const knife = dispatcher({weapon:'melee',limitedAmmo,legacy}); knife.run();
    assert.deepEqual(knife.counts(), {requests:0,records:0});
    const gun = dispatcher({limitedAmmo,legacy}); gun.run();
    assert.deepEqual(gun.counts(), {requests:1,records:1});
  }
  const idle = dispatcher({input:{takeReloadPresses:()=>0}}); idle.run();
  assert.deepEqual(idle.counts(), {requests:0,records:0});
});

test('real kernel keeps unlimited ammunition and blocks firing for the complete manual reload', () => {
  const sim = world();
  let fired = 0;
  for (let tick=0; tick<1000; tick++) {
    fired += shots(sim.step(input(true))).length;
    assert.equal(sim.snapshot().ammo, null);
    assert.equal(sim.snapshot().reloadSince, null, 'unlimited ammunition never starts an automatic reload');
  }
  assert.ok(fired > weapons.o('vandal').magazineSize * 2, `${fired} shots exceed two magazines`);
  dispatcher({sim}).run();
  assert.equal(sim.snapshot().reloadSince, 0);
  for (let tick=1; tick<reloadTicks; tick++) {
    if (tick % 37 === 0) sim.requestReload();
    assert.equal(shots(sim.step(input(true))).length, 0, `no shot on reload tick ${tick}`);
    assert.equal(sim.snapshot().reloadSince, tick * kernel.TICK_SECONDS, 'repeated presses preserve the original reload start');
    assert.equal(sim.snapshot().ammo, null);
  }
  assert.ok(sim.snapshot().reloadSince < weapons.o('vandal').reloadSeconds);
  let resumed = shots(sim.step(input(true))).length;
  assert.equal(sim.snapshot().reloadSince, null, 'reload completes at the weapon duration rounded to simulation ticks');
  const fireIntervalTicks = Math.ceil(1 / weapons.o('vandal').firingRatePerSecond / kernel.TICK_SECONDS);
  for (let tick=0; tick<fireIntervalTicks && resumed===0; tick++) resumed += shots(sim.step(input(true))).length;
  assert.ok(resumed > 0, 'held fire resumes after the reload within the native firing cadence');
  assert.equal(sim.snapshot().ammo, null);
});

test('real finite-ammo kernel still consumes rounds and refuses a full-magazine reload', () => {
  const sim = world(true), size = weapons.o('vandal').magazineSize;
  assert.equal(sim.snapshot().ammo, size);
  sim.requestReload();
  assert.equal(sim.snapshot().reloadSince, null);
  assert.equal(shots(sim.step(input(true))).length, 1);
  assert.equal(sim.snapshot().ammo, size-1);
  dispatcher({sim,limitedAmmo:true}).run();
  assert.equal(sim.snapshot().reloadSince, 0);
  for (let tick=1; tick<reloadTicks; tick++) {
    assert.equal(shots(sim.step(input(true))).length, 0);
    assert.equal(sim.snapshot().ammo, size-1);
  }
  sim.step(input(false));
  assert.equal(sim.snapshot().reloadSince, null);
  assert.equal(sim.snapshot().ammo, size);
});
