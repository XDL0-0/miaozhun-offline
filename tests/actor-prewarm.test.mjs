import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {actorWarmCounts,createActorWarmPool,applyActorPrewarmPatch} from '../patches/actor-prewarm.mjs';
import {applyPrewarmPatch} from '../patches/prewarm.mjs';
import {applyInterpolationPatch} from '../patches/interpolation.mjs';
import {applyBotOrderPatch} from '../patches/bot-order.mjs';

const names=['CymPR-fm.js','tmIeW3Ig.js','DVK7uRSu.js','CFqO0zvx.js','aQOfOAp-.js','DCKWp-_u.js'];
const sources=Object.fromEntries(names.map(name=>[name,fs.readFileSync(new URL('../site/js/'+name,import.meta.url),'utf8')]));
const warmed=applyPrewarmPatch(applyInterpolationPatch(sources)),patched=applyActorPrewarmPatch(warmed);
function fixture(){
  const meshes=[];let sharedDisposals=0;
  function spawn(){
    const sk={disposals:0,boneTexture:null,dispose(){this.disposals++;this.boneTexture=null;}},root={parent:null,isMesh:false,child:{isMesh:true,frustumCulled:true},traverse(fn){fn(this);fn(this.child);}};
    const mesh={root,skin:{skeleton:sk},parts:[{material:{dispose(){sharedDisposals++;}}}]};meshes.push(mesh);return mesh;
  }
  const scene={actorTemplates:new Map([['bot',{spawn}],['unused',{spawn}]])},doc={actors:[{id:'bot'},{id:'unused'}],spawners:[{actorTemplateId:'bot',maxAlive:3}]};
  return {scene,doc,meshes,get sharedDisposals(){return sharedDisposals;}};
}
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};

test('capacity sums delayed spawners and conservatively covers dispatcher choices without simulation or RNG',()=>{
  const doc={actors:[{id:'bot'},{id:'extra'}],spawners:[{actorTemplateId:'bot',maxAlive:3,spawnDelay:[.2,.5]},{actorTemplateId:'bot',maxAlive:2}],dispatchers:[{maxAlive:99,routes:[{templateId:'bot'},{templateId:'other'},{templateId:'bot'}]}]};
  const before=JSON.stringify(doc);assert.deepEqual([...actorWarmCounts(doc)],[['bot',13],['other',8],['extra',1]]);assert.equal(JSON.stringify(doc),before);
});

test('warm instances are withheld until commit, reused by actual spawn and never duplicate on ready retry',()=>{
  const f=fixture(),pool=createActorWarmPool(),batch=pool.reserve(f.scene,f.doc);assert.equal(batch.roots.length,4);assert.equal(pool.take(f.scene,'bot'),null);
  for(const root of batch.roots)root.child.frustumCulled=false;
  const parent={remove(root){root.parent=null;}};batch.roots.forEach(root=>{root.parent=parent;});batch.commit();batch.dispose();
  assert(f.meshes.every(mesh=>mesh.skin.skeleton.disposals===0&&mesh.root.child.frustumCulled===true&&mesh.root.parent===null));
  const repeated=pool.reserve(f.scene,f.doc);assert.equal(repeated.roots.length,0);repeated.commit();repeated.dispose();assert.equal(f.meshes.length,4);
  const actual=pool.take(f.scene,'bot');assert(f.meshes.includes(actual));assert.equal(actual.skin.skeleton.disposals,0);
  pool.release(f.scene);pool.release(f.scene);assert.equal(actual.skin.skeleton.disposals,0,'consumed instances belong to the native renderer');
  assert.equal(f.meshes.filter(mesh=>mesh.skin.skeleton.disposals===1).length,3);assert.equal(f.sharedDisposals,0);assert.equal(pool.take(f.scene,'bot'),null);
});

test('cancelled batches release only their pending skeletons; scene disposal blocks stale commit and permits clean retry',()=>{
  const f=fixture(),pool=createActorWarmPool(),cancelled=pool.reserve(f.scene,f.doc);cancelled.dispose();cancelled.dispose();assert(f.meshes.every(mesh=>mesh.skin.skeleton.disposals===1));
  const retry=pool.reserve(f.scene,f.doc);retry.commit();retry.dispose();assert.equal(f.meshes.length,8);assert.equal(pool.reserve(f.scene,f.doc).roots.length,0);
  const g=fixture(),old=pool.reserve(g.scene,g.doc);pool.release(g.scene);assert.throws(()=>old.commit(),/disposed/);old.dispose();assert(g.meshes.every(mesh=>mesh.skin.skeleton.disposals===1));
  const fresh=pool.reserve(g.scene,g.doc);fresh.commit();old.dispose();assert.equal(pool.take(g.scene,'bot').skin.skeleton.disposals,0);pool.release(g.scene);
  pool.release(f.scene);
});

test('a partial reserve failure releases created skeletons without disposing shared geometry or materials',()=>{
  const f=fixture(),pool=createActorWarmPool(),spawn=f.scene.actorTemplates.get('bot').spawn;let calls=0;
  f.scene.actorTemplates.get('bot').spawn=()=>{if(++calls===2)throw Error('allocation failed');return spawn();};
  assert.throws(()=>pool.reserve(f.scene,f.doc),/allocation failed/);assert.equal(f.meshes.length,1);assert.equal(f.meshes[0].skin.skeleton.disposals,1);assert.equal(f.sharedDisposals,0);
});

test('version-pinned patch compiles with interpolation/prewarm/bot-order and retains native actor motion',()=>{
  const final=applyBotOrderPatch(patched);
  for(const name of ['tmIeW3Ig.js','CymPR-fm.js','DVK7uRSu.js']){
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:final[name],encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const native=sources['tmIeW3Ig.js'],start=native.indexOf('function kE(A,g,D){'),end=native.indexOf('const RE=1.15,',start);assert(final['tmIeW3Ig.js'].includes(native.slice(start,end)));
  assert.equal(warmed['tmIeW3Ig.js'].includes('__aimActorWarmPool'),false);assert.throws(()=>applyActorPrewarmPatch(patched),/already applied/);assert.throws(()=>applyActorPrewarmPatch(sources),/expected 1 anchor/);
  assert.throws(()=>applyActorPrewarmPatch({...warmed,'tmIeW3Ig.js':warmed['tmIeW3Ig.js'].replace('return D?D.spawn():null','return D?D.spawn():undefined')}),/expected 1 anchor/);
});

function juSandbox(f,pool,prewarm){
  const source=patched['CymPR-fm.js'],start=source.indexOf('async function ju('),end=source.indexOf('function Yu(E){',start),uploads=[];
  const sandbox={Nt:f.scene,Vs:2,Ro:false,Ke:null,u:{},l:{},r:{},M:{},cn:{warmActors(renderer){uploads.push(renderer);}},__aimReserveActorWarmPool:(scene,doc)=>pool.reserve(scene,doc),i:{renderer:{id:'gpu'},prewarm}};
  vm.runInNewContext(source.slice(start,end)+';this.warm=ju;',sandbox);return{sandbox,uploads};
}

test('actual ju retains the same drawn bone textures for delayed first-wave Qn spawns',async()=>{
  const f=fixture(),pool=createActorWarmPool();
  const h=juSandbox(f,pool,async(valid,roots)=>{assert(valid());assert.equal(roots.length,4);for(const mesh of f.meshes){mesh.skin.skeleton.boneTexture={id:f.meshes.indexOf(mesh)};mesh.root.child.frustumCulled=false;}});
  await h.sandbox.warm(f.doc,2,{check(){},generation:1});assert.equal(h.uploads.length,1);
  const source=patched['tmIeW3Ig.js'],start=source.indexOf('function Qn(A,g){'),end=source.indexOf('const En=13,',start),spawn=vm.runInNewContext('('+source.slice(start,end)+')',{__aimActorWarmPool:pool});
  const roots=new Set(f.meshes.filter(mesh=>mesh.skin.skeleton.boneTexture).map(mesh=>mesh.root));
  for(let i=0;i<3;i++){const mesh=spawn(f.scene,'bot');assert(roots.has(mesh.root));assert(mesh.skin.skeleton.boneTexture);assert.equal(mesh.skin.skeleton.disposals,0);assert.equal(mesh.root.child.frustumCulled,true);}
  assert.equal(f.meshes.length,4,'the delayed first wave never calls template.spawn again');pool.release(f.scene);
});

test('actual ju cancellation cleans pending work and never commits a stale scene',async()=>{
  const f=fixture(),pool=createActorWarmPool(),wait=deferred();let current=true;
  const h=juSandbox(f,pool,async()=>wait.promise),pending=h.sandbox.warm(f.doc,2,{check(){if(!current)throw Error('cancelled');},generation:1});
  assert.equal(pool.take(f.scene,'bot'),null);current=false;wait.resolve();await assert.rejects(pending,/cancelled/);assert(f.meshes.every(mesh=>mesh.skin.skeleton.disposals===1));
  current=true;h.sandbox.i.prewarm=async()=>{};await h.sandbox.warm(f.doc,2,{check(){},generation:2});assert.equal(f.meshes.length,8);assert.equal(pool.take(f.scene,'bot').skin.skeleton.disposals,0);pool.release(f.scene);
});

test('native removal/clear disposes active skeletons and releases all unconsumed retained copies',()=>{
  const f=fixture(),pool=createActorWarmPool(),batch=pool.reserve(f.scene,f.doc);batch.commit();
  const active=pool.take(f.scene,'bot');let activeMaterials=0,removed=0;active.parts=[{material:{dispose(){activeMaterials++;}}}];f.scene.root={remove(){removed++;}};
  const source=patched['tmIeW3Ig.js'],start=source.indexOf('s=n=>{n.mesh.skin?.skeleton?.dispose();'),end=source.indexOf(';return{',start),statement=source.slice(start,end+1);
  assert(start>=0&&end>start);const remove=vm.runInNewContext('(function(){let '+statement+';return s;})()',{A:f.scene});
  const entries=new Map([[1,{mesh:active}]]);const clearStart=source.indexOf('clear(){for(const n of B.values())s(n);__aimActorWarmPool.release(A);'),clearEnd=source.indexOf('}}}const DB=16,',clearStart);
  assert(clearStart>=0&&clearEnd>clearStart);const body=source.slice(clearStart+'clear(){'.length,clearEnd);
  vm.runInNewContext('(function(){'+body+'})()',{B:entries,s:remove,A:f.scene,__aimActorWarmPool:pool,C:0,Q:0,E:0,o:0,I:0,__aimOfflineCurrent:null,__aimOfflinePrevious:null,__aimOfflineActorSource:null,__aimOfflinePreviousActors:new Map()});
  assert.equal(active.skin.skeleton.disposals,1);assert.equal(activeMaterials,1);assert.equal(removed,1);assert.equal(entries.size,0);assert(f.meshes.every(mesh=>mesh.skin.skeleton.disposals===1));
});

test('existing actual actor skeletons upload before entry even if their roots were created while warming',()=>{
  const source=patched['tmIeW3Ig.js'],start=source.indexOf('warmActors(renderer){'),end=source.indexOf(',apply(n,G,h,U){',start);assert(start>=0&&end>start);
  const uploaded=[],skeleton={boneTexture:null,allocations:0,updates:0,computeBoneTexture(){this.allocations++;this.boneTexture={id:'actual'};},update(){this.updates++;}};
  const api=vm.runInNewContext('({'+source.slice(start,end)+'})',{B:new Map([[1,{mesh:{skin:{skeleton}}}],[2,{mesh:{skin:null}}]])});
  const renderer={initTexture:t=>uploaded.push(t)};api.warmActors(renderer);api.warmActors(renderer);assert.equal(skeleton.allocations,1);assert.equal(skeleton.updates,2);assert.deepEqual(uploaded,[skeleton.boneTexture,skeleton.boneTexture]);
});
