import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {applyWorldPerformancePatch} from '../patches/world-performance.mjs';

const original = fs.readFileSync(new URL('../site/js/aQOfOAp-.js', import.meta.url), 'utf8');
const originalTraining = fs.readFileSync(new URL('../site/js/CymPR-fm.js', import.meta.url), 'utf8');
const originalModules = {'aQOfOAp-.js':original,'CymPR-fm.js':originalTraining};
const patchedModules = applyWorldPerformancePatch(originalModules);
const patched = patchedModules['aQOfOAp-.js'];
function section(source, begin, end) {
  const a = source.indexOf(begin), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing native source section: ${begin}`);
  return source.slice(a, b);
}
class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, {x, y, z}); }
  copy(p) { Object.assign(this, {x: p.x, y: p.y, z: p.z}); return this; }
  addScaledVector(p, k) { this.x += p.x*k; this.y += p.y*k; this.z += p.z*k; return this; }
  distanceToSquared(p) { return (this.x-p.x)**2 + (this.y-p.y)**2 + (this.z-p.z)**2; }
}
class Color {
  copy(value) { this.id = value.id; return this; }
}
class Light {
  constructor() {
    this.position = new Vector(); this.color = new Color(); this.intensity = 0;
    this.target = {position: new Vector(), updateMatrixWorld() {}};
  }
  dispose() { this.disposed = true; }
}
class Point extends Light { constructor() { super(); this.kind = 'point'; } }
class Spot extends Light { constructor() { super(); this.kind = 'spot'; } }
class Group { children = []; add(...children) { this.children.push(...children); } }
function factory(source) {
  return vm.runInNewContext(`(()=>{${section(source, 'function ZI(n,e){', 'const tw=.45,')}return ew})()`, {
    jn: Group, Cp: Point, yp: Spot, P: Vector, Iu: {point: 10, spot: 4},
    vo: 20, aA: 1.5, $I: 12, jI: .03,
  });
}
const nativeFactory = factory(original), optimizedFactory = factory(patched);
const view = handle => JSON.parse(JSON.stringify(handle.group.children.filter(child => child instanceof Light)));
const sourceLight = (id, kind = 'point', options = {}) => ({
  kind, position: new Vector(id % 23, id % 5, id % 17), color: {id},
  intensity: 50 + id % 13, radius: 80, outerCone: .8, innerCone: .4,
  toLight: new Vector(1, -.3, .1), ...options,
});

test('bounded selection preserves native light values across movement and slot budgets', () => {
  const lights = Array.from({length: 420}, (_, id) => sourceLight(id, ['point', 'spot', 'rect', 'ignored'][id % 4]));
  lights.push(sourceLight(421, 'point', {intensity: 0}), sourceLight(422, 'spot', {intensity: -3}));
  for (const slots of [{point: 10, spot: 4}, {point: 4, spot: 1}, {point: 0, spot: 0}, {point: 1, spot: 2}]) {
    const native = nativeFactory(lights, slots), optimized = optimizedFactory(lights, slots);
    for (let index = 0; index < 100; index++) {
      const position = new Vector(Math.sin(index*.7)*32, index%7, Math.cos(index*.13)*32);
      native.update(position); optimized.update(position);
      assert.deepEqual(view(optimized), view(native), `slot budget ${JSON.stringify(slots)}, movement ${index}`);
    }
    native.dispose(); optimized.dispose();
    assert.ok(optimized.group.children.filter(child => child instanceof Light).every(light => light.disposed));
  }
});

test('equal scores retain original input order over repeated updates, including cutoff ties', () => {
  const lights = Array.from({length: 50}, (_, id) => sourceLight(id, id < 30 ? 'point' : 'spot', {
    position: new Vector(), intensity: 50, radius: 100,
  }));
  const native = nativeFactory(lights), optimized = optimizedFactory(lights);
  for (const x of [0, 3, 6, 0]) {
    native.update(new Vector(x)); optimized.update(new Vector(x));
    assert.deepEqual(view(optimized), view(native));
    assert.deepEqual(view(optimized).filter(light => light.kind === 'point').map(light => light.color.id), [0,1,2,3,4,5,6,7,8,9]);
  }
});

test('movement threshold and out-of-range slot clearing stay native', () => {
  const lights = [sourceLight(1, 'point', {position: new Vector(), radius: 4})];
  const native = nativeFactory(lights, {point: 2, spot: 1}), optimized = optimizedFactory(lights, {point: 2, spot: 1});
  for (const x of [0, 1, 1.49, 1.5, 3, 10, 0]) {
    native.update(new Vector(x)); optimized.update(new Vector(x));
    assert.deepEqual(view(optimized), view(native), `camera x=${x}`);
  }
});

test('emitted graphics parses and version mismatches fail closed', () => {
  for (const input of Object.values(patchedModules)) {
    const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], {input, encoding: 'utf8', windowsHide: true});
    assert.equal(parsed.status, 0, parsed.stderr);
  }
  assert.throws(() => applyWorldPerformancePatch(patchedModules), /already applied/);
  assert.throws(() => applyWorldPerformancePatch({}), /missing graphics/);
  assert.throws(() => applyWorldPerformancePatch({'aQOfOAp-.js':original}), /missing training/);
  assert.throws(() => applyWorldPerformancePatch({...originalModules,'aQOfOAp-.js': original.replace('function l(h,u,f,d){const p=u.map', 'function l(h,u,f,d){const p=unknown.map')}), /version mismatch/);
  assert.throws(() => applyWorldPerformancePatch({...originalModules,'CymPR-fm.js': originalTraining.replace('function ym(e){', 'function unknownScreenEffect(e){')}), /version mismatch/);
});

function screenEffectFixture() {
  const calls={clear:0,stroke:0,fill:0}, canvases=[];
  const context={
    save(){},restore(){},beginPath(){},ellipse(){},moveTo(){},lineTo(){},
    stroke(){calls.stroke++;},fillRect(){calls.fill++;},clearRect(){calls.clear++;},
    createRadialGradient(){return{addColorStop(){}};},
  };
  const document={createElement(kind){
    assert.equal(kind,'canvas');
    const canvas={style:{},width:300,height:150,setAttribute(){},getContext:()=>context,remove(){this.removed=true;}};
    canvases.push(canvas);return canvas;
  }};
  const create=vm.runInNewContext(`(${section(patchedModules['CymPR-fm.js'],'function ym(e){','const gm=')})`, {
    document,ja:.6,vm:.35,kl:900,yi:'priming',Zc:'armed',Go:{primingTicks:128},
  });
  const stage={clientWidth:1920,clientHeight:963,appendChild(canvas){this.canvas=canvas;}};
  const effect=create(stage);
  return {effect,stage,canvas:canvases[0],calls};
}
const jett=(phase='none')=>({rules:{tailwind:true},tailwind:{phase,elapsedTicks:0}});

test('idle Jett overlay is absent from compositing and resize cannot reveal it',()=>{
  const f=screenEffectFixture();
  assert.equal(f.canvas.style.display,'none');
  f.effect.apply(null,0,null,null);f.effect.apply(jett(),0,null,null);
  f.stage.clientWidth=1300;f.stage.clientHeight=800;
  f.effect.apply(jett(),1,null,null);
  assert.equal(f.canvas.style.display,'none');
  assert.equal(f.calls.clear,0);assert.equal(f.calls.stroke,0);
  assert.equal(f.canvas.width,300);assert.equal(f.canvas.height,150);
  f.effect.dispose();assert.equal(f.canvas.removed,true);
});

test('priming and dash preserve their native drawing and hide after the final clear',()=>{
  const f=screenEffectFixture(),hands=[-.3,-.5,.3,-.5];
  f.effect.apply(jett('priming'),0,null,hands);
  assert.equal(f.canvas.style.display,'block');
  assert.equal(f.canvas.width,1920);assert.equal(f.canvas.height,963);
  assert.equal(f.calls.stroke,8);assert.equal(f.calls.clear,1);
  f.effect.apply(jett(),1,null,null);
  assert.equal(f.canvas.style.display,'none');assert.equal(f.calls.clear,2);
  f.effect.apply(jett(),2,null,null);assert.equal(f.calls.clear,2);
  f.stage.clientWidth=1440;f.stage.clientHeight=900;
  f.effect.apply(jett(),10.05,{at:10,dir:'N'},null);
  assert.equal(f.canvas.style.display,'block');
  assert.equal(f.canvas.width,1440);assert.equal(f.canvas.height,900);
  assert.equal(f.calls.stroke,78);assert.equal(f.calls.fill,1);
  f.effect.apply(jett(),10.7,{at:10,dir:'N'},null);
  assert.equal(f.canvas.style.display,'none');assert.equal(f.calls.clear,4);
  f.effect.clear();assert.equal(f.calls.clear,4);
});
