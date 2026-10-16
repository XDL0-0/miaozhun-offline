import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyPrewarmPatch,createSceneReadyGate} from '../patches/prewarm.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const names=['CymPR-fm.js','aQOfOAp-.js','tmIeW3Ig.js'];
const originals=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(root,'site/js',name),'utf8')]));
const patched=applyPrewarmPatch(originals);
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('gate waits for assets AND GPU work; does not advance simulation',async()=>{
 const asset=deferred(),gpu=deferred(),states=[];let physicsSteps=0;
 const gate=createSceneReadyGate({onState:s=>states.push(s.status)});
 const result=gate.run(async ctx=>{await asset.promise;ctx.check();ctx.phase('GPU');await gpu.promise;ctx.check()});
 await turn();assert.equal(gate.ready,false);
 asset.resolve();await turn();assert.equal(gate.ready,false);assert.equal(physicsSteps,0);
 gpu.resolve();assert.equal((await result).status,'ready');assert.equal(gate.ready,true);
 assert.deepEqual(states,['loading','loading','ready']);assert.equal(physicsSteps,0);
 gate.cancel();assert.equal(gate.ready,false);assert.equal(gate.state.status,'cancelled');
});

test('cancelled generation cannot publish ready or overwrite the replacement',async()=>{
 const old=deferred(),fresh=deferred(),gate=createSceneReadyGate();
 const first=gate.run(async ctx=>{await old.promise;ctx.check()});
 await turn();const second=gate.run(async ctx=>{await fresh.promise;ctx.check()});
 assert.equal((await first).status,'cancelled');
 old.resolve();await turn();assert.equal(gate.ready,false);assert.equal(gate.state.generation,2);
 fresh.resolve();assert.equal((await second).status,'ready');assert.equal(gate.state.generation,2);
});

test('deadline is explicit failure, pending work cannot later fake success, retry works',async()=>{
 let deadline;const timers={setTimeout:fn=>(deadline=fn,1),clearTimeout(){}};
 const gate=createSceneReadyGate({timers});const blocked=deferred();
 const first=gate.run(()=>blocked.promise);await turn();deadline();
 assert.equal((await first).status,'failed');assert.equal(gate.ready,false);
 blocked.resolve();await turn();assert.equal(gate.state.status,'failed');
 assert.equal((await gate.run(async()=>{})).status,'ready');
 const failed=await gate.run(async()=>{throw Error('asset missing')});
 assert.equal(failed.status,'failed');assert.match(failed.error.message,/asset missing/);
 assert.equal((await gate.run(async()=>{})).status,'ready');
});

test('every emitted module parses and transforms fail closed on unknown/already-patched versions',()=>{
 for(const name of names){
  const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:patched[name],encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,name+' '+result.stderr);
  assert.equal(originals[name].includes('__aimCreateReadyGate'),false);
 }
 assert.throws(()=>applyPrewarmPatch(patched),/already applied/);
 assert.throws(()=>applyPrewarmPatch({...originals,'CymPR-fm.js':originals['CymPR-fm.js'].replace('function Ta(E,Q=null,le=E){if(','function TaChanged(){if(')}),/version mismatch/);
 assert.throws(()=>applyPrewarmPatch({}),/missing source/);
});

test('prewarm is compatible with the interpolation initial snapshot capture',async()=>{
 const {applyInterpolationPatch}=await import('../patches/interpolation.mjs');
 const combined=applyPrewarmPatch(applyInterpolationPatch(originals));
 assert.match(combined['CymPR-fm.js'],/\$t=null,cn\.capture\(ke\.snapshot\(\)\),Zu\(E\)/);
 assert.match(combined['CymPR-fm.js'],/const Ae=It\(ke\);cn\.capture\(Ae\)/);
 const before=section(originals['CymPR-fm.js'],'function Zu(E){','function Qu(E){');
 assert.equal(section(combined['CymPR-fm.js'],'function Zu(E){','function Qu(E){'),before,'opening loadout/physics/recording path unchanged');
});

test('actual map adapter ignores a late map after switching to a mapless scene, then permits retry',async()=>{
 const first=deferred(),mounted=[];let calls=0;
 const sandbox={Vs:0,Ro:false,Sa:null,__aimMapReady:null,er(){},sf(){calls++;return calls===1?first.promise:Promise.resolve({id:'new'})},af:()=>Promise.resolve({batches:[]}),__aimMapAssets:{loadMapLighting:()=>Promise.resolve({})},i:{applyEnvironment(){},setMapVisual:m=>mounted.push(m.id)}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'function Xu(E){','async function ju(')+';this.load=Xu;',sandbox);
 const old=sandbox.load({environment:{map:'old'}});await sandbox.load({environment:{}});
 first.resolve({id:'old'});await old;assert.deepEqual(mounted,[]);
 await sandbox.load({environment:{map:'new'}});assert.deepEqual(mounted,['new']);
 sandbox.sf=()=>Promise.reject(Error('missing map'));await assert.rejects(sandbox.load({environment:{map:'retry'}}),/missing map/);
 sandbox.sf=()=>Promise.resolve({id:'retry'});await sandbox.load({environment:{map:'retry'}});assert.deepEqual(mounted,['new','retry']);
});

class Texture {constructor(){this.userData={};this.source=null}dispose(){this.disposed=true}}
class Source {constructor(image){this.image=image}}

test('actual actor texture loader rejects failed decode and evicts the failed cache on retry',async()=>{
 let loads=0;
 const sandbox={YQ:new Map(),VB:Texture,P8:Source,cf:()=>null,nf:()=>false,e8:0,MD:1,
  createImageBitmap:async blob=>blob,Ff:()=>({mean:[0,0,0],load:()=>++loads===1?Promise.reject(Error('decode failed')):Promise.resolve('image')})};
 vm.runInNewContext(section(patched['tmIeW3Ig.js'],'function rg(A){','const EC={')+';this.load=rg;',sandbox);
 const first=sandbox.load('agent:astra:albedo');await assert.rejects(first.userData.__aimReady,/decode failed/);
 const second=sandbox.load('agent:astra:albedo');assert.notEqual(first,second);assert.equal(first.disposed,true);
 await second.userData.__aimReady;assert.equal(second.source.image,'image');assert.equal(loads,2);
});

test('actual muzzle texture loader has a waitable promise, reports errors and retries once',async()=>{
 const q=section(patched['CymPR-fm.js'],'function qv(e){','function Zv(e,t,n,o,a){');let calls=0;
 const sandbox={m:new Map(),x:new Set(),b:new Set(),__aimTextureTasks:new Map(),t:{textures:{selected:{file:'selected.png',srgb:true}}},Tu:'/aim-viewmodel/',a:false,w:[],ai:1,ya:2,Mr:3,ri:4,ii:5,
  P0:async()=>{if(++calls===1)throw Error('missing selected texture');return{url:'local',revoke(){}}},f:{load(url,done){queueMicrotask(()=>done(new Texture()))}}};
 vm.runInNewContext(section(q,'function g(S){','function _(S){')+';this.load=g;',sandbox);
 await assert.rejects(sandbox.load('selected'),/missing selected/);assert.equal(sandbox.__aimTextureTasks.size,0);
 await Promise.all([sandbox.load('selected'),sandbox.load('selected')]);assert.equal(calls,2);assert.equal(sandbox.m.has('selected'),true);
});

test('actual flash null-texture cache is evicted, and a failed pack is not considered ready',async()=>{
 let calls=0;const sandbox={Tl:new Map(),Vm:async()=>++calls===1?null:{id:'texture'}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'function $m(e){','async function Wm(')+';this.load=$m;',sandbox);
 assert.equal(await sandbox.load('selected'),null);assert.equal(sandbox.Tl.size,0);
 assert.equal((await sandbox.load('selected')).id,'texture');assert.equal(calls,2);
 const body=section(patched['CymPR-fm.js'],'async function Wm(e){','function Gm(e){');
 const pack={eu:async()=>new TextEncoder().encode(JSON.stringify({systems:{p:{emitters:[{mat:'needed'}]}}})),Um:()=>'',Ai:{needed:{tex:['missing']}},$m:async()=>null,TextDecoder};
 vm.runInNewContext(body+';this.load=Wm;',pack);await assert.rejects(pack.load('selected'),/闪光贴图/);
});

test('actual flash renderer prewarms its four compositor scenes rather than treating pass wrappers as meshes',async()=>{
 class Value{set(){return this}dispose(){this.disposed=true}}
 class Scene{constructor(){this.children=[]}add(...objects){this.children.push(...objects);return this}clear(){this.children=[]}}
 class Camera extends Value{}
 let materialCount=0;
 class Material{constructor(options){materialCount++;Object.assign(this,options)}dispose(){this.disposed=true}}
 class Mesh{constructor(geometry,material){this.geometry=geometry;this.material=material}}
 const warmed=[],uploads=[],camera={kind:'main-camera'};
 const sandbox={zd:Value,po:Value,Pe:Value,ts:Value,ho:Scene,Di:Camera,ci:Material,yt:Mesh,Un:Value,On:Value,ht:Value,
  wr:0,li:0,ui:0,Qm:'vertex',tv:'downsample',nv:'blur',Jm:'coverage',ev:'composite',Is:0,xr:0,ra:0,rn:0,qo:0,Cd:0,lv:1,
  Zm:()=> 'particle',Xm:'sprite',Km:'mesh',kr:0,$n:0,Ai:{selected:{fs:'shader',tex:[],k:[0,0,0,0]}},
  __aimWarmVisual:async(renderer,scene,selectedCamera,check)=>{check();assert.equal(scene instanceof Scene,true);warmed.push({scene,selectedCamera,materials:scene.children.map(child=>child.material)})}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'function uv(){','const dv=')+';this.create=uv;',sandbox);
 const flash=sandbox.create();flash.addPack({key:'current',systems:{current:{emitters:[{mat:'selected'}]}},meshes:{},textures:{selected:{id:'selected'}}});
 await flash.prewarm({initTexture:texture=>uploads.push(texture.id)},camera,()=>{});
 assert.deepEqual(uploads,['selected']);assert.equal(warmed.length,5);
 const particleMaterial=warmed[0].materials[0];
 assert.equal(warmed[0].selectedCamera,camera);assert.equal(particleMaterial.disposed,undefined,'prewarmed material retains its shader program reference');
 assert.equal(warmed[0].scene.children.length,0,'temporary meshes detach from scene');
 for(const pass of warmed.slice(1)){assert.equal(pass.selectedCamera instanceof Camera,true);assert.equal(pass.materials.length,1);assert.equal(pass.materials[0].disposed,undefined,'persistent compositor material remains owned by renderer')}
 assert.deepEqual(warmed.slice(1).map(pass=>pass.materials[0].fragmentShader),['downsample','blur','coverage','composite']);
 const firstMaterialCount=materialCount;
 await flash.prewarm({initTexture(){}},camera,()=>{});
 assert.equal(materialCount,firstMaterialCount,'repeated prewarm reuses each material variant');
 assert.equal(warmed[5].materials[0],particleMaterial);assert.equal(particleMaterial.disposed,undefined);
 flash.dispose();assert.equal(particleMaterial.disposed,true);for(const pass of warmed.slice(1,5))assert.equal(pass.materials[0].disposed,true);
});

test('renderer scopes do not reuse a pending old-scene warmup or clear the new promise',async()=>{
 const first=deferred(),second=deferred();let calls=0;
 class Group{add(){}remove(){}}
 const sandbox={b:null,__aimPrewarmScope:null,x:false,jn:Group,r:{scene:new Group(),camera:{}},c:{info:{programs:[]},compileAsync:()=>++calls===1?first.promise:second.promise,getContext:()=>({isContextLost:()=>false})},performance:{now:()=>0},_(){}};
 const body=section(patched['aQOfOAp-.js'],'function T(I,R,scope){','return{...r,renderer:c');
 vm.runInNewContext(body+';this.warm=T;',sandbox);
 const old=sandbox.warm(()=>false,[],1),fresh=sandbox.warm(()=>false,[],2);assert.notEqual(old,fresh);
 first.resolve();await old;assert.equal(sandbox.b,fresh);
 assert.equal(sandbox.warm(()=>false,[],2),fresh);second.resolve();await fresh;assert.equal(sandbox.b,null);
});

test('temporary actor variants are visible for shader collection and cannot be frustum-culled during pre-draw',async()=>{
 class Group{constructor(){this.children=[]}add(child){this.children.push(child)}remove(child){this.children=this.children.filter(v=>v!==child)}}
 const compile=deferred(),mesh={isMesh:true,frustumCulled:true},originalMesh={isMesh:true,frustumCulled:true};
 const copy={traverse:fn=>fn(mesh)},scene=new Group();let collected=false,group;
 const sandbox={b:null,__aimPrewarmScope:null,x:false,jn:Group,r:{scene,camera:{}},c:{info:{programs:[]},compileAsync:()=>{group=scene.children[0];collected=group.visible&&group.children[0]===copy&&mesh.frustumCulled===false;return compile.promise},getContext:()=>({isContextLost:()=>false})},performance:{now:()=>0},_(){}};
 const body=section(patched['aQOfOAp-.js'],'function T(I,R,scope){','return{...r,renderer:c');
 vm.runInNewContext(body+';this.warm=T;',sandbox);
 const pending=sandbox.warm(()=>false,[copy],1);assert.equal(collected,true);assert.equal(originalMesh.frustumCulled,true);
 compile.resolve();await pending;assert.equal(group.visible,false);assert.equal(scene.children.length,0);
});

test('a loading gate preserves the start gesture: no pointer/fullscreen request until ready',async()=>{
 let pointer=0,fullscreen=0;const sandbox={__aimCanStart:()=>false,ee:false,fs(){},Ie:async fn=>fn(),document:{fullscreenElement:null,documentElement:{async requestFullscreen(){fullscreen++}}},te:{requestLock(){pointer++}}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'async function td(){','function Do(){')+';this.start=td;',sandbox);
 await sandbox.start();assert.equal(pointer,0);assert.equal(fullscreen,0);
 sandbox.__aimCanStart=()=>true;await sandbox.start();assert.equal(pointer,1);assert.equal(fullscreen,1);
});

test('actual scene-asset planner requests only this scene models/textures',async()=>{
 const meshes=[],guns=[],textures=[],uploads=[];
 const sandbox={ED:v=>['ghost','vandal'].includes(v)?v:null,IC:v=>v??'default',vw:v=>v==='astra',Hf:async v=>(meshes.push(v),{}),pB:v=>({albedo:v+':color',ao:v+':ao'}),rg:key=>(textures.push(key),{userData:{__aimReady:Promise.resolve()},key}),HE:async v=>(guns.push(v),{parts:[{texture:{file:v+'.png'}}]}),vf:key=>({userData:{__aimReady:Promise.resolve()},key})};
 const fn=patched['tmIeW3Ig.js'].slice(patched['tmIeW3Ig.js'].indexOf('export async function __aimPrewarmSceneAssets')).replace('export async function','async function');
 vm.runInNewContext(fn+';this.prepare=__aimPrewarmSceneAssets;',sandbox);
 await sandbox.prepare({actors:[{body:{shape:'sphere',look:'unrequested'}},{body:{shape:'humanoid',look:'astra',weapon:'ghost'}},{body:{shape:'humanoid',look:'bot',weapon:'vandal'}}]}, {initTexture:t=>uploads.push(t.key)});
 assert.deepEqual(meshes,['astra']);assert.deepEqual(guns,['ghost']);assert.equal(textures.some(t=>t.includes('unrequested')),false);
 assert.equal(uploads.includes('ghost.png'),true);assert.equal(uploads.length,5);
 await sandbox.prepare({actors:[{body:{shape:'humanoid',look:'bot',weapon:'melee'}}]}, {initTexture(){}});
 assert.deepEqual(guns,['ghost'],'non-firing weapons use the original renderer filter');
});

test('cancelled asset generation cannot upload textures after asynchronous decode',async()=>{
 const decode=deferred(),uploads=[];let current=true;
 const sandbox={ED:()=>null,IC:()=> 'bot',vw:()=>false,pB:()=>({albedo:'bot'}),rg:()=>({userData:{__aimReady:decode.promise}})};
 const fn=patched['tmIeW3Ig.js'].slice(patched['tmIeW3Ig.js'].indexOf('export async function __aimPrewarmSceneAssets')).replace('export async function','async function');
 vm.runInNewContext(fn+';this.prepare=__aimPrewarmSceneAssets;',sandbox);
 const result=sandbox.prepare({actors:[{body:{}}]}, {initTexture:t=>uploads.push(t)},()=>{if(!current)throw Error('cancelled')});
 current=false;decode.resolve();await assert.rejects(result,/cancelled/);assert.equal(uploads.length,0);
});

test('map readiness also waits for lighting and PVS; failed PVS cannot mount',async()=>{
 const light=deferred(),mounted=[];
 const sandbox={Vs:0,Ro:false,Sa:null,__aimMapReady:null,er(){},sf:async()=>({id:'map'}),af:async()=>({batches:[]}),__aimMapAssets:{loadMapLighting:()=>light.promise},i:{applyEnvironment(){},setMapVisual:m=>mounted.push(m)}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'function Xu(E){','async function ju(')+';this.load=Xu;',sandbox);
 const pending=sandbox.load({environment:{map:'current'}});await turn();assert.equal(mounted.length,0);
 light.resolve({});await pending;assert.equal(mounted.length,1);
 sandbox.af=async()=>null;await assert.rejects(sandbox.load({environment:{map:'current'}}),/可见性/);assert.equal(mounted.length,1);
});

test('temporary prewarm skeletons are disposed on success and cancellation without disposing shared meshes',async()=>{
 let disposed=0,sharedDisposed=0,check=()=>{};
 const root={geometry:{dispose(){sharedDisposed++}},material:{dispose(){sharedDisposed++}}};
 const sandbox={Nt:{actorTemplates:new Map([['bot',{spawn:()=>({root,skin:{skeleton:{dispose(){disposed++}}}})}]])},Vs:2,Ro:false,u:{},l:{},r:{},M:{},i:{prewarm:async()=>{}}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'async function ju(','function Yu(E){')+';this.warm=ju;',sandbox);
 await sandbox.warm({},2,{check:()=>check(),generation:1});assert.equal(disposed,1);assert.equal(sharedDisposed,0);
 sandbox.i.prewarm=async()=>{check=()=>{throw Error('cancelled')}};
 await assert.rejects(sandbox.warm({},2,{check:()=>check(),generation:2}),/cancelled/);
 assert.equal(disposed,2);assert.equal(sharedDisposed,0);
});

test('smoke preparation retries a cancelled generation and rejects real compile failures',async()=>{
 const source=section(patched['tmIeW3Ig.js'],'function xs(A,g){','const Es=.04;');
 const method=section(source,'prepare(a,k,check=()=>{}){',',setTime(a){');
 const first=deferred();let calls=0,current=true;
 const sandbox={G:null,d:async(a,k,check)=>{calls++;if(calls===1)await first.promise;check()},oldCheck:()=>{if(!current)throw Error('cancelled')}};
 vm.runInNewContext('this.obj={'+method+'};',sandbox);
 const old=sandbox.obj.prepare({}, {},sandbox.oldCheck);current=false;
 const fresh=sandbox.obj.prepare({}, {},()=>{});first.resolve();await assert.rejects(old,/cancelled/);await fresh;assert.equal(calls,2);
 sandbox.G=null;sandbox.d=async()=>{throw Error('shader failed')};await assert.rejects(sandbox.obj.prepare({},{}),/shader failed/);
 assert.equal(sandbox.G,null);assert.match(source,/await Promise\.all\(\[a\.compileAsync\(w,k\),a\.compileAsync\(B,k\)\]\);check\(\)/);
});
