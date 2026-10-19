import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {applyInterpolationPatch} from '../patches/interpolation.mjs';

const assetRoot = new URL('../site/js/', import.meta.url);
const original = Object.fromEntries(['tmIeW3Ig.js', 'CymPR-fm.js'].map(name => [name, fs.readFileSync(new URL(name, assetRoot), 'utf8')]));
const patched = applyInterpolationPatch(original);
const common = fs.readFileSync(new URL('B51EgnC9.js', assetRoot), 'utf8');
const graphics = fs.readFileSync(new URL('aQOfOAp-.js', assetRoot), 'utf8');

function between(source, begin, end) {
  const start = source.indexOf(begin), stop = source.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, `Missing real-source boundaries: ${begin}`);
  return source.slice(start, stop);
}

const vector = (x=0, y=0, z=0) => ({x, y, z});
const lerp = (a, b, alpha) => ({x:a.x+(b.x-a.x)*alpha, y:a.y+(b.y-a.y)*alpha, z:a.z+(b.z-a.z)*alpha});
// Use the real actor-offset, eye-height, and predicted-look expressions, with
// their small vector/math dependencies supplied in place of the WebGL bundle.
const actorPosition = vm.runInNewContext(`(${between(common, 'Je=e=>', ',cr=').slice(3)})`, {J:(a,b)=>vector(a.x+b.x,a.y+b.y,a.z+b.z)});
const eyePosition = vm.runInNewContext(`(${between(graphics, 'eD=(n,e)=>', ';function tD(').slice(3)})`, {Yh:vector,l0:(a,b,h)=>a+(b-a)*h});
const predictedLook = vm.runInNewContext(`(${between(original['tmIeW3Ig.js'], 'function _t(A,g){', 'const eD=')})`, {qt:4*Math.PI/180});

function makeRenderer(text = patched['tmIeW3Ig.js']) {
  class Empty {}
  let poseCalls=0;
  const factory = vm.runInNewContext(`(${between(text, 'function ks(A,g,D,w){', 'const DB=16')})`, {
    Xo:Empty,mA:Empty,KB:Empty,xQ:lerp,uI:value=>{poseCalls++;return actorPosition(value);},yA:eyePosition,_t:predictedLook,
    Cg:.5,tn:2.5,Z:1/128,In:3,En:13,on:1,en:2,fn:1,
    yo:()=>1,oB:actor=>actor.yaw,Qn:(_scene,templateId)=>createMesh(templateId),
  });
  const children = new Set();
  let created = 0, disposed = 0;
  function point() {return {...vector(),set(x,y,z){this.x=x;this.y=y;this.z=z;}};}
  function material() {return {clone:material,dispose(){disposed++;},color:{setHex(){}}};}
  function createMesh(templateId) {
    created++;
    return {
      root:{position:point(),rotation:{y:0},visible:true,templateId},
      parts:[{material:material(),scale:{...point(),x:1,y:1,z:1}}],
      pivot:{scale:{setScalar(){}}},baseColor:0,hitColor:1,
    };
  }
  const camera = {position:point(),rotation:{set(pitch,yaw,roll,order){Object.assign(this,{pitch,yaw,roll,order});}}};
  const scene = {root:{add:root=>children.add(root),remove:root=>children.delete(root)}};
  const handle = factory(scene,camera,{eyeHeightStand:1.6,eyeHeightCrouch:1},{});
  return {handle,camera,children,get created(){return created;},get disposed(){return disposed;},get poseCalls(){return poseCalls;}};
}

function actor(tick, options={}) {
  return {id:'bot',templateId:'target',bornTick:0,visible:true,alive:true,yaw:0,scale:1,
    position:vector(tick*.1,0,0),offset:vector(),...options};
}

function snapshot(tick, options={}) {
  return {tick,actors:[actor(tick)],...options,player:{position:vector(tick*.1,0,0),grounded:true,crouchAmount:0,
    yaw:.2,pitch:.1,recoilYaw:0,recoilPitch:0,...options.player}};
}

const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-10, `${actual} != ${expected}`);
const mesh = renderer => [...renderer.children][0];
function capture(renderer, ...snapshots) {for(const frame of snapshots)renderer.handle.capture(frame);}
function apply(renderer, frame, alpha=.5, predicted) {renderer.handle.apply(frame,[],alpha,predicted);}
function deepFreeze(value) {
  if(value&&typeof value==='object'){for(const member of Object.values(value))deepFreeze(member);Object.freeze(value);}
  return value;
}

test('real renderer reproduces the old skipped-tick error and uses adjacent simulation frames after patch', () => {
  const baseline=makeRenderer(original['tmIeW3Ig.js']), fixed=makeRenderer();
  const frames=Array.from({length:9},(_,tick)=>deepFreeze(snapshot(tick)));
  capture(fixed,frames[0]);
  for(const tick of [0,1,2]) {
    if(tick)capture(fixed,frames[tick]);
    apply(fixed,frames[tick]);apply(baseline,frames[tick]);
  }
  capture(fixed,frames[3],frames[4]);
  apply(fixed,frames[4]);apply(baseline,frames[4]);
  close(baseline.camera.position.x,.30);close(mesh(baseline).position.x,.30);
  close(fixed.camera.position.x,.35);close(mesh(fixed).position.x,.35);
  capture(fixed,frames[5]);apply(fixed,frames[5]);
  capture(fixed,frames[6],frames[7]);apply(fixed,frames[7]);
  close(fixed.camera.position.x,.65);close(mesh(fixed).position.x,.65);
  close(frames[7].player.position.x,.7);
});

test('multiple unrendered ticks retain only the true adjacent pair, including actor offsets and eye height', () => {
  const renderer=makeRenderer();
  const frames=Array.from({length:13},(_,tick)=>snapshot(tick,{
    player:{crouchAmount:tick/20},actors:[actor(tick,{offset:vector(tick*.03,0,0)})],
  }));
  capture(renderer,frames[0]);apply(renderer,frames[0]);
  capture(renderer,...frames.slice(1));
  assert.equal(renderer.created,1,'capture must not instantiate or animate meshes');
  for(const alpha of [0,.25,.5,.99,1]) {
    apply(renderer,frames[12],alpha);
    close(renderer.camera.position.x,(11+alpha)*.1);
    close(renderer.camera.position.y,1.6-.6*(11+alpha)/20);
    close(mesh(renderer).position.x,(11+alpha)*.13);
  }
});

test('zero-tick rendered frames progress alpha without replacing previous position', () => {
  const renderer=makeRenderer(), first=snapshot(20), second=snapshot(21);
  capture(renderer,first,second);
  for(const alpha of [0,.2,.8,.95]) {
    apply(renderer,second,alpha);
    close(renderer.camera.position.x,2+alpha*.1);
    close(mesh(renderer).position.x,2+alpha*.1);
  }
  const refreshed=snapshot(21,{player:{yaw:.5}});
  capture(renderer,refreshed);apply(renderer,refreshed,.4);
  close(renderer.camera.position.x,2.04);
  close(renderer.camera.rotation.yaw,.5);
});

test('previous actor pose is cached across zero-tick renders instead of allocated every frame', () => {
  const renderer=makeRenderer(), frames=[snapshot(0),snapshot(1),snapshot(2)];
  capture(renderer,frames[0],frames[1]);apply(renderer,frames[1],0);
  assert.equal(renderer.poseCalls,2,'one current pose and one previous pose');
  for(const alpha of [.1,.2,.3,.4,.5])apply(renderer,frames[1],alpha);
  assert.equal(renderer.poseCalls,7,'only the unchanged original current-pose path runs on zero-tick frames');
  capture(renderer,frames[2]);apply(renderer,frames[2],.6);
  assert.equal(renderer.poseCalls,9,'a new adjacent tick refreshes the previous pose once');
});

test('birth, respawn, template changes, and visibility recovery snap instead of sliding', () => {
  const cases=[
    {name:'birth',previous:[],current:actor(1,{bornTick:1,position:vector(2,0,0)})},
    {name:'respawn',previous:[actor(0)],current:actor(1,{bornTick:1,position:vector(2,0,0)})},
    {name:'new template',previous:[actor(0)],current:actor(1,{templateId:'other',position:vector(2,0,0)})},
    {name:'revive',previous:[actor(0,{alive:false})],current:actor(1,{position:vector(2,0,0)})},
    {name:'visible again',previous:[actor(0,{visible:false})],current:actor(1,{position:vector(2,0,0)})},
  ];
  for(const entry of cases) {
    const renderer=makeRenderer(), previous=snapshot(0,{actors:entry.previous}), current=snapshot(1,{actors:[entry.current]});
    capture(renderer,previous);apply(renderer,previous);
    capture(renderer,current);apply(renderer,current,.1);
    close(mesh(renderer).position.x,2);
    assert.equal(mesh(renderer).visible,true,entry.name);
    assert.equal(renderer.children.size,1,entry.name);
    if(entry.name==='new template')assert.equal(renderer.disposed,1);
  }
});

test('single-tick teleports snap, but long travel over skipped rendered frames stays smooth', () => {
  const renderer=makeRenderer(), start=snapshot(0), teleported=snapshot(1,{
    player:{position:vector(20,0,0)},actors:[actor(1,{position:vector(20,0,0)})],
  });
  capture(renderer,start,teleported);apply(renderer,teleported,.01);
  close(renderer.camera.position.x,20);close(mesh(renderer).position.x,20);
  const travel=Array.from({length:5},(_,i)=>snapshot(i+2,{
    player:{position:vector(22+i*2,0,0)},actors:[actor(i+2,{position:vector(22+i*2,0,0)})],
  }));
  capture(renderer,...travel);apply(renderer,travel.at(-1),.5);
  close(renderer.camera.position.x,29);close(mesh(renderer).position.x,29);
});

test('clear, tick rewind, and missing simulation ticks cannot interpolate unrelated worlds', () => {
  const renderer=makeRenderer(), previous=snapshot(50), current=snapshot(51);
  capture(renderer,previous,current);apply(renderer,current);
  renderer.handle.clear();
  assert.equal(renderer.children.size,0);
  assert.equal(renderer.disposed,1);
  const reset=snapshot(0,{player:{position:vector(-10,0,0)},actors:[actor(0,{position:vector(-10,0,0)})]});
  capture(renderer,reset);apply(renderer,reset,.5);
  close(renderer.camera.position.x,-10);close(mesh(renderer).position.x,-10);
  const next=snapshot(1,{player:{position:vector(-9,0,0)},actors:[actor(1,{position:vector(-9,0,0)})]});
  capture(renderer,next);apply(renderer,next,.5);
  close(renderer.camera.position.x,-9.5);close(mesh(renderer).position.x,-9.5);
  const gap=snapshot(20);
  capture(renderer,gap);apply(renderer,gap,.2);
  close(renderer.camera.position.x,2);close(mesh(renderer).position.x,2);
  const rewind=snapshot(0,{player:{position:vector(-8,0,0)},actors:[actor(0,{bornTick:2,position:vector(-8,0,0)})]});
  capture(renderer,rewind);apply(renderer,rewind,.5);
  // Rewind starts a fresh capture pair; do not mix it with either old world.
  close(renderer.camera.position.x,-8);close(mesh(renderer).position.x,-8);
  const adjacent=snapshot(1,{player:{position:vector(-7,0,0)},actors:[actor(1,{bornTick:2,position:vector(-7,0,0)})]});
  capture(renderer,adjacent);apply(renderer,adjacent,.5);
  close(renderer.camera.position.x,-7.5);close(mesh(renderer).position.x,-7.5);
});

test('mouse prediction still affects rotation immediately and never substitutes predicted position', () => {
  const renderer=makeRenderer(), first=snapshot(0), second=snapshot(1,{
    player:{camRecoilYaw:.03,camRecoilPitch:.04},
  });
  capture(renderer,first,second);
  apply(renderer,second,.25,{...second.player,yaw:1.25,pitch:-.5,position:vector(999,999,999)});
  close(renderer.camera.position.x,.025);close(renderer.camera.position.y,1.6);
  close(renderer.camera.rotation.yaw,1.28);close(renderer.camera.rotation.pitch,-.46);
  assert.equal(renderer.camera.rotation.order,'YXZ');
});

test('preview tick one followed by restoring tick zero starts the first live pair correctly', () => {
  const renderer=makeRenderer(), baseline=makeRenderer(original['tmIeW3Ig.js']);
  const initial=snapshot(0,{actors:[]}), preview=snapshot(1,{actors:[actor(1,{bornTick:1})]});
  capture(renderer,initial);
  apply(renderer,preview,.3);apply(baseline,preview,.3);
  close(renderer.camera.position.x,baseline.camera.position.x);
  close(mesh(renderer).position.x,mesh(baseline).position.x);
  // The simulation restores 0 then steps to 1, while last rendered tick is 1.
  const firstLive=snapshot(1,{actors:[actor(1,{bornTick:1})]});
  capture(renderer,firstLive);apply(renderer,firstLive,.3);
  close(renderer.camera.position.x,.03);
  close(mesh(renderer).position.x,.1);
});

test('apply-only callers retain the original replay/seek behavior exactly', () => {
  const baseline=makeRenderer(original['tmIeW3Ig.js']), fixed=makeRenderer();
  for(const [index,tick] of [0,1,4,4,7,3,0,1,40,41].entries()) {
    const frame=snapshot(tick,{
      player:{position:vector(tick*.1,index%3*.1,0),crouchAmount:index%2*.3},
      actors:index===6?[]:[actor(tick,{bornTick:index>6?1:0,visible:index!==3})],
    });
    const look={...frame.player,yaw:index*.2};
    for(const alpha of [.1,.6,.9]) {
      apply(baseline,frame,alpha,look);apply(fixed,frame,alpha,look);
      const coordinates=position=>[position.x,position.y,position.z];
      const angles=rotation=>[rotation.yaw,rotation.pitch,rotation.roll,rotation.order];
      assert.deepEqual(coordinates(fixed.camera.position),coordinates(baseline.camera.position));
      assert.deepEqual(angles(fixed.camera.rotation),angles(baseline.camera.rotation));
      assert.deepEqual([...fixed.children].map(root=>({position:coordinates(root.position),visible:root.visible,templateId:root.templateId})),
        [...baseline.children].map(root=>({position:coordinates(root.position),visible:root.visible,templateId:root.templateId})));
    }
  }
  baseline.handle.clear();fixed.handle.clear();
  assert.equal(fixed.disposed,baseline.disposed);
});

test('actual training step captures each latest cached snapshot after invalidation', () => {
  const source=patched['CymPR-fm.js'];
  const body=between(source,'const je=ke.step(Be);','if(N?.observe');
  let tick=0,snapshotCalls=0,cached=null;
  const observed=[],captured=[];
  const ke={step(){tick++;return [{kind:tick===2?'kill':'step'}];},snapshot(){snapshotCalls++;return snapshot(tick);}};
  const context=vm.createContext({ke,Be:{},io:0,dn:{observe:events=>observed.push(events)},$t:cached,
    It:world=>(context.$t??=world.snapshot()),cn:{capture:frame=>captured.push(frame)}});
  for(let i=0;i<8;i++)vm.runInContext(`{${body}}`,context);
  assert.deepEqual(captured.map(frame=>frame.tick),[1,2,3,4,5,6,7,8]);
  assert.equal(snapshotCalls,8);
  assert.equal(observed.length,8);
  assert.equal(context.io,1);
  assert.equal(context.$t,captured.at(-1));
});

test('preparation captures tick zero without poisoning the original snapshot cache', () => {
  const source=patched['CymPR-fm.js'];
  const expression=between(source,'$t=null,cn.capture(ke.snapshot()),Zu(E),','ke&&Rt.length>0');
  let tick=0;
  const captured=[];
  const context=vm.createContext({$t:{tick:999},E:{},cn:{capture:frame=>captured.push(frame)},
    ke:{snapshot:()=>snapshot(tick)},Zu:()=>{tick++;}});
  vm.runInContext(expression.slice(0,-1),context);
  assert.equal(captured[0].tick,0);
  assert.equal(tick,1);
  assert.equal(context.$t,null);
  assert.equal(context.ke.snapshot().tick,1);
});

test('patched real modules remain valid ES modules', () => {
  for(const [name,source] of Object.entries(patched)) {
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8'});
    assert.equal(result.status,0,`${name}: ${result.stderr}`);
  }
});

test('simulation, replay codec, and kernel identity bytes remain unchanged', () => {
  const before=original['tmIeW3Ig.js'],after=patched['tmIeW3Ig.js'];
  assert.equal(after.slice(0,after.indexOf('function ks(A,g,D,w){')),before.slice(0,before.indexOf('function ks(A,g,D,w){')));
  assert.equal(after.slice(after.indexOf('const DB=16')),before.slice(before.indexOf('const DB=16')));
});

test('strict version guards reject changed, missing, duplicate, or already-patched modules', () => {
  assert.throws(()=>applyInterpolationPatch({}),/缺少/);
  for(const [file,needle] of [
    ['tmIeW3Ig.js','function ks(A,g,D,w){const B=new Map;let C=-1,Q=null,I=null,E=0,o=null;'],
    ['tmIeW3Ig.js','};return{apply(n,G,h,U){e.length=0;const H=n.tick!==C;C=n.tick;const Y=new Set;'],
    ['tmIeW3Ig.js','B.set(v.id,c)}(v.bornTick!==c.bornTick||!c.wasAlive&&v.alive)'],
    ['tmIeW3Ig.js','I===null?(Q=O,I=O):(H&&(Q=I),I=O);'],
    ['tmIeW3Ig.js','B.clear(),C=-1,Q=null,E=0,o=null,I=null'],
    ['CymPR-fm.js','$t=null,Zu(E),ke&&Rt.length>0'],
    ['CymPR-fm.js','const Ae=It(ke);if(N?.observe'],
  ]) {
    assert.throws(()=>applyInterpolationPatch({...original,[file]:original[file].replace(needle,'changed')}),/版本不匹配/);
    assert.throws(()=>applyInterpolationPatch({...original,[file]:original[file]+needle}),/版本不匹配/);
  }
  assert.throws(()=>applyInterpolationPatch(patched),/版本不匹配/);
  const withOther={...original,'other.js':'untouched'},result=applyInterpolationPatch(withOther);
  assert.equal(result['other.js'],'untouched');
  assert.equal(withOther['tmIeW3Ig.js'],original['tmIeW3Ig.js']);
});
