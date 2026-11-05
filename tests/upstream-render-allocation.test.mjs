import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyUpstreamPerformancePatch} from '../patches/upstream-performance.mjs';
import {applyUpstreamRenderAllocationPatch} from '../patches/upstream-render-allocation.mjs';

const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const root=new URL('../upstream/aimpro-2026-11-05/source/js/',import.meta.url);
const original=Object.fromEntries(['CqM6URxy.js','CBthEhpW.js','Do4sYkfr.js'].map(name=>[name,fs.readFileSync(new URL(name,root),'utf8')]));
const prepared=applyUpstreamPerformancePatch(original,{renderAllocations:false});
const patched=applyUpstreamRenderAllocationPatch(prepared);
const code=source=>{
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='v0');
  assert.ok(node);return source.slice(node.start,node.end);
};
const xyz=value=>[value.x,value.y,value.z];

function fixture(source){
  const counts={sets:0,temporaryPoses:0,actorPoses:0,disposed:0,warmReleases:0};
  const point=(x=0,y=0,z=0)=>({x,y,z,set(x,y,z){Object.assign(this,{x,y,z});return this}});
  const children=new Set;
  const material=()=>({clone:material,dispose(){counts.disposed++},color:{value:null,setHex(value){this.value=value}},emissive:{setHex(){return this},multiplyScalar(){}}});
  const mesh=()=>({root:{position:point(),rotation:{y:0},visible:true},parts:[{material:material(),scale:point(1,1,1)}],pivot:{scale:{value:null,setScalar(value){this.value=value}}},baseColor:0,hitColor:1});
  const lerp=(a,b,t)=>a+(b-a)*t;
  const context={
    Set:class extends Set{constructor(...args){super(...args);counts.sets++}},
    lw:class{},Wf:class{},dg:class{},OQ:class{},
    D8(actor){counts.actorPoses++;return{x:actor.position.x+actor.offset.x,y:actor.position.y+actor.offset.y,z:actor.position.z+actor.offset.z}},
    Qi:actor=>actor.heldWeapon??'',ya:()=>mesh(),Va(){},Oa(){},gi(){},ei:()=>null,Pw:actor=>actor.facingYaw??0,lP:()=>1,Di:3,ti:2,QE:.5,Ei:2.5,oi:2.5,IA:1/128,wi:2,
    ZA:player=>({x:player.position.x,y:player.position.y+1.6,z:player.position.z}),dF:player=>player,ce:lerp,
    et(a,b,t){counts.temporaryPoses++;return{x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t)}},
    __aimActorWarmPool:{release(){counts.warmReleases++}},
  };
  const factory=vm.runInNewContext(code(source)+';v0',context);
  const scene={root:{add:value=>children.add(value),remove:value=>children.delete(value)},actorTemplates:new Map([['bot',{spawn:mesh}],['other',{spawn:mesh}]])};
  const camera={position:point(),rotation:{value:null,set(...value){this.value=value}}};
  const renderer=factory(scene,camera,{},{});
  return{renderer,counts,state:()=>({camera:xyz(camera.position),rotation:camera.rotation.value,actors:[...children].map(value=>({position:xyz(value.position),yaw:value.rotation.y,visible:value.visible}))})};
}

function snapshot(tick,{x=tick*.1,y=0,z=0,actors=2}={}){
  return{tick,actors:Array.from({length:actors},(_,index)=>({id:'bot'+index,templateId:'bot',bornTick:0,visible:true,alive:true,position:{x:x+index,y,z},offset:{x:0,y:0,z:0},facingYaw:tick*.03,scale:1})),player:{position:{x,y,z},grounded:true,pitch:.1,yaw:.2}};
}

for(const [label,modules]of [['native',original],['adjacent snapshot',prepared]]){
  test(`${label} renderer is identical across ticks, repeated renders and lifecycle changes`,()=>{
    const before=fixture(modules['Do4sYkfr.js']);
    const after=fixture(applyUpstreamRenderAllocationPatch(modules)['Do4sYkfr.js']);
    const render=(state,events=[],capture=true)=>{
      const saved=structuredClone(state);
      if(capture){before.renderer.capture?.(state);after.renderer.capture?.(state)}
      for(const alpha of [0,.125,.5,.999,1]){
        before.renderer.apply(state,events,alpha);after.renderer.apply(state,events,alpha);
        assert.deepEqual(after.state(),before.state());
        assert.deepEqual(state,saved,'rendering does not mutate snapshots');
      }
    };
    render(snapshot(0));
    render(snapshot(1),[{kind:'shot',hitActorId:'bot0',tick:1}]);
    render(snapshot(2,{y:.2}));
    // More than one simulation tick between frames preserves adjacent capture.
    for(let tick=3;tick<=5;tick++){
      const state=snapshot(tick,{y:.2});
      before.renderer.capture?.(state);after.renderer.capture?.(state);
      if(tick===5)render(state,[],false);
    }
    render(snapshot(6,{x:10,y:1}));
    const changed=snapshot(7,{x:10.1,actors:3});
    changed.actors[0].bornTick=7;changed.actors[0].offset.y=.2;
    changed.actors[1].templateId='other';changed.actors[1].heldWeapon='rifle';
    changed.actors[2].alive=false;changed.actors[2].visible=false;
    render(changed);
    // A new same-tick snapshot, and direct mutation between calls, must be read.
    const sameTick=snapshot(7,{x:10.15,actors:1});render(sameTick);
    sameTick.actors[0].offset.x=.03;render(sameTick,[],false);
    render(snapshot(12,{actors:0}));
    before.renderer.clear();after.renderer.clear();
    assert.deepEqual(after.state(),before.state());
    render(snapshot(0));
    render(snapshot(1,{y:-.2}));
    before.renderer.clear();after.renderer.clear();
    render(snapshot(3),[],false);
    assert.equal(after.counts.disposed,before.counts.disposed);
    assert.equal(after.counts.actorPoses,before.counts.actorPoses,'retained current/previous pose generation is unchanged');
    assert.equal(after.counts.warmReleases,before.counts.warmReleases);
  });
}

test('repeated rendering removes only temporary interpolation vectors and per-frame Set construction',()=>{
  const before=fixture(prepared['Do4sYkfr.js']),after=fixture(patched['Do4sYkfr.js']);
  const state=snapshot(0,{actors:8});
  for(const instance of [before,after]){
    instance.renderer.capture(state);
    for(let frame=0;frame<40;frame++)instance.renderer.apply(state,[],frame/40);
  }
  assert.equal(before.counts.temporaryPoses,40*9);
  assert.equal(after.counts.temporaryPoses,0);
  assert.equal(before.counts.sets,40);
  assert.equal(after.counts.sets,1);
  assert.equal(after.counts.actorPoses,before.counts.actorPoses);
  assert.deepEqual(after.state(),before.state());
});

test('snapshot cache and startup/tick invalidation remain byte-for-byte unchanged',()=>{
  const training=prepared['CBthEhpW.js'];
  assert.equal(patched['CBthEhpW.js'],training);
  assert.equal(patched['CqM6URxy.js'],prepared['CqM6URxy.js']);
  assert.ok(training.includes('va=null,xn?.capture(Me.snapshot()),Pm(M)'));
  assert.ok(training.includes('Me.step($r),rs=j}'));
  assert.ok(training.includes('va=null;const ze=is(Me);xn?.capture(ze);'));
  const start=training.indexOf('function is(M){'),stop=training.indexOf('let Ya=',start);
  assert.ok(start>=0&&stop>start);
  const cache=vm.runInNewContext('let va=null;'+training.slice(start,stop)+';({read:is,reset(){va=null}})');
  let tick=0,calls=0;
  const engine={snapshot(){calls++;return{tick,player:{position:{x:tick,y:0,z:0}},actors:[]}}};
  const first=cache.read(engine);
  assert.equal(cache.read(engine),first);assert.equal(calls,1);
  tick++;cache.reset();assert.equal(cache.read(engine).tick,1);assert.equal(calls,2);
  const rebuilt={snapshot:()=>({tick:0,player:{position:{x:99,y:0,z:0}},actors:[]})};
  cache.reset();assert.equal(cache.read(rebuilt).player.position.x,99);
});

test('transform is immutable, syntax-valid, fail-closed and rejects repeated application',()=>{
  for(const modules of [original,prepared]){
    const copy={...modules},output=applyUpstreamRenderAllocationPatch(modules);
    assert.deepEqual(modules,copy);assert.notEqual(output,modules);
    parse(output['Do4sYkfr.js'],{ecmaVersion:'latest',sourceType:'module'});
  }
  assert.throws(()=>applyUpstreamRenderAllocationPatch({}),/missing actor renderer/);
  assert.throws(()=>applyUpstreamRenderAllocationPatch(patched),/already applied/);
  for(const anchor of ['const et=(A,g,w)=>','C=M.tick;const p=new Set;','const $=et(x.previous,x.current,d);','const T=et(e,Q,d);']){
    assert.throws(()=>applyUpstreamRenderAllocationPatch({...prepared,'Do4sYkfr.js':prepared['Do4sYkfr.js'].replace(anchor,'/* changed */')}),/version mismatch/);
  }
});
