import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyPrewarmPatch,createSceneReadyGate,prepareStableVisuals,planMuzzleBatches} from '../patches/prewarm.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const names=['CymPR-fm.js','aQOfOAp-.js','tmIeW3Ig.js','DVK7uRSu.js','DCKWp-_u.js'];
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
 let pointer=0,fullscreen=0,unlocks=0;const sandbox={__aimCanStart:()=>false,ie:{unlock(){unlocks++;return new Promise(()=>{})}},ee:false,fs(){},Ie:async fn=>fn(),document:{fullscreenElement:null,documentElement:{async requestFullscreen(){fullscreen++}}},te:{requestLock(){pointer++}}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'async function td(){','function Do(){')+';this.start=td;',sandbox);
 await sandbox.start();assert.equal(pointer,0);assert.equal(fullscreen,0);assert.equal(unlocks,0);
 sandbox.__aimCanStart=()=>true;await sandbox.start();assert.equal(pointer,1);assert.equal(fullscreen,1);assert.equal(unlocks,1,'resume is initiated in the user gesture and never awaited');
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
 const sandbox={Nt:{actorTemplates:new Map([['bot',{spawn:()=>({root,skin:{skeleton:{dispose(){disposed++}}}})}]])},Vs:2,Ro:false,Ke:null,u:{},l:{},r:{},M:{},i:{prewarm:async()=>{}}};
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

test('visual readiness waits for pending appearance and repeats GPU work after a selection change',async()=>{
 const pending=deferred();let revision=1,identity='vandal',ready=false,warmCount=0,loads=0;
 const model={async ready(){await pending.promise;ready=true},visualRevision:()=>revision};
 const result=prepareStableVisuals({load:async()=>{loads++;return[{model}]},identity:()=>identity,warm:async()=>{assert.equal(ready,true);warmCount++;if(warmCount===1){revision++;identity='phantom';throw Error('old material disposed during selection')}}});
 await turn();assert.equal(warmCount,0);pending.resolve();await result;
 assert.equal(loads,2);assert.equal(warmCount,2);
 await assert.rejects(prepareStableVisuals({load:async()=>[{model}],warm:async()=>{throw Error('real GPU failure')}}),/real GPU failure/);
});

test('visual readiness checks cancellation after GPU fence before publishing success',async()=>{
 let current=true;const fence=deferred(),model={ready:async()=>{},visualRevision:()=>1};
 const result=prepareStableVisuals({load:async()=>[{model}],check:()=>{if(!current)throw Error('cancelled')},warm:()=>fence.promise});
 await turn();current=false;fence.resolve();await assert.rejects(result,/cancelled/);
});

test('actual loadout preparation loads current plus primary and knife, waits for appearance and equip, and does not activate another gun',async()=>{
 const loaded=[],equipped=[],readied=[],selected=[];const appearances=new Map;
 const make=stem=>({setFovHorizontal(){},setHand(){},setGun(){},async ready(){readied.push(stem)},setEquip:clip=>equipped.push([stem,clip])});
 const knife=make('knife');appearances.set('knife',{model:knife,stem:'knife'});
 let audioReady=0;const sandbox={ie:{async prepare(check){check();audioReady++}},_n:async()=>{},t:{viewModel:{current:true},viewModelFov:{current:80},viewModelHand:{current:'right'},viewModelGun:{current:'vandal'}},qe:()=> 'melee',ao:()=> 'operator',Qn:true,wn:weapon=>({stem:weapon==='melee'?'knife':weapon}),Lo:v=>v,Ut:appearances,us:()=>({jett:false,lockdown:false}),D0:async(stem,flags)=>(loaded.push([stem,flags.knife]),{stem}),O0:assets=>make(assets.stem),ua:weapon=>weapon,is:new Map,N0:async stem=>'equip-'+stem,i:{setViewModel:m=>selected.push(m)}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'async function __aimPrepareLoadout(','async function __aimPrepareAuxiliary(')+';this.prepare=__aimPrepareLoadout;',sandbox);
 const entries=await sandbox.prepare({check(){}});assert.deepEqual(loaded,[['operator',false]]);assert.deepEqual(Array.from(entries,e=>e.weapon),['melee','operator']);
 assert.deepEqual(readied,['knife','operator']);assert.deepEqual(equipped,[['knife','equip-knife'],['operator','equip-operator']]);assert.deepEqual(selected,[],'preloading keeps the active viewmodel untouched');
 sandbox.Qn=false;sandbox.qe=()=> 'vandal';sandbox.ao=()=> 'vandal';loaded.length=0;
 await sandbox.prepare({check(){}});assert.deepEqual(loaded,[['vandal',false]]);assert.equal(appearances.has('phantom'),false);assert.equal(audioReady,2,'every stable-selection pass waits for native audio too');
});

test('the known optional Outlaw equip omission keeps its native pose without blocking scene entry',async()=>{
 const clips=[];const model={setFovHorizontal(){},setHand(){},setGun(){},ready:async()=>{},setEquip:clip=>clips.push(clip)};
 const sandbox={ie:{prepare:async()=>{}},_n:async()=>{},t:{viewModel:{current:true},viewModelFov:{current:80},viewModelHand:{current:'right'},viewModelGun:{current:'vandal'}},qe:()=> 'outlaw',ao:()=> 'outlaw',Qn:true,wn:weapon=>({stem:weapon==='melee'?'knife':weapon}),Lo:v=>v,Ut:new Map([['outlaw',{model}],['knife',{model}],['operator',{model}]]),ua:v=>v,is:new Map,N0:async stem=>stem==='knife'?'knife-equip':null};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'async function __aimPrepareLoadout(','async function __aimPrepareAuxiliary(')+';this.prepare=__aimPrepareLoadout;',sandbox);
 const entries=await sandbox.prepare({check(){}});assert.deepEqual(Array.from(entries,e=>e.weapon),['outlaw','melee']);assert.deepEqual(clips,['knife-equip']);
 sandbox.qe=()=> 'operator';sandbox.ao=()=> 'operator';await assert.rejects(sandbox.prepare({check(){}}),/切枪动画未能加载：operator/);
});

test('actual muzzle preparation allocates and uploads reusable real batches without firing the simulation',async()=>{
 class Value{clone(){return this}}
 const material={},batches=[],uploads=[],scene={children:[],clear(){this.children=[]},add(mesh){this.children.push(mesh)}};
 const renderer={getRenderTarget:()=>null,getViewport:()=>({}),getScissor:()=>({}),getScissorTest:()=>false,getClearColor:()=>({}),getClearAlpha:()=>1,initTexture:t=>uploads.push(t),setRenderTarget(){},setViewport(){},setScissor(){},setScissorTest(){},setClearColor(){},autoClear:true};
 const makeBatch=()=>{const geometry={range:null,setDrawRange(...range){this.range=range}},attrs=[{},{},{}],batch={mesh:{geometry},scene:null,sink:{pos:new Float32Array(3072*3),uv:new Float32Array(3072*2),col:new Float32Array(3072*4),dyn:new Float32Array(3072*4)},attrs,dynAttr:{}};batches.push(batch);return batch};
 const outputPasses=[];
 const sandbox={__aimWarmOutputPass:async(r,s,c,target)=>{assert.equal(target,null);outputPasses.push(s)},__aimPlanMuzzleBatches:planMuzzleBatches,Xv:.1,__aimPreparing:0,__aimParticleWarm:Promise.resolve(),t:{guns:{vandal:{hip:[{sys:'hip'}],ads:[{sys:'ads'}]}},systems:{hip:{emitters:[{enabled:true,mat:'a'},{enabled:true,mat:'a'}]},ads:{emitters:[{enabled:true,mat:'a'}]}}},te:async()=>{},Il:()=>[],g:async()=>{},_:()=>material,w:[{id:'texture'}],On:Value,ht:Value,C:null,jv:()=>({warmScene:scene,fxCam:{},lightPass:{scene:{name:'light'}},tonePass:{scene:{name:'tone'}},quadCam:{}}),z:{},H(){},P:()=>({}),v:true,k:[],L:makeBatch,
  __aimWarmVisual:async(r,s,c,check)=>{check();assert.equal(sandbox.__aimPreparing,1);assert.equal(s.children.length,2);for(const mesh of s.children){assert.deepEqual(mesh.geometry.range,[0,3]);assert.equal(mesh.material,material)}for(const b of batches){assert.equal(b.attrs.every(a=>a.needsUpdate),true);assert.equal(b.dynAttr.needsUpdate,true)}},n:{fire(){throw Error('must not fire real simulation')}}};
 const method=section(patched['CymPR-fm.js'],'async prepare(weapon,renderer,model,check=()=>{}){',',frame(S){');
 vm.runInNewContext('this.obj={'+method+'};',sandbox);
 const model={fxLayer:()=>({scene:{},camera:{}})};await sandbox.obj.prepare('vandal',renderer,model);
 assert.equal(batches.length,2);assert.equal(uploads.length,1);assert.equal(scene.children.length,0);for(const b of batches){assert.equal(b.mesh.visible,false);assert.deepEqual(b.mesh.geometry.range,[0,0])}
 await sandbox.obj.prepare('vandal',renderer,model);assert.equal(batches.length,2,'second preparation reuses the GPU buffer owners');
 assert.equal(sandbox.__aimPreparing,0);assert.deepEqual(outputPasses.map(s=>s.name),['light','tone','light','tone']);assert.match(patched['CymPR-fm.js'],/render\(S,K\)\{if\(a\|\|!s\|\|__aimPreparing\)return/);
});

test('actual auxiliary preparation completes planning and attaches head lines before GPU prewarm',async()=>{
 let advances=0,created=0;const roots=[],lines={id:'head-lines'};
 const planner={prepared:()=>advances===2,advance(){advances++},headLines:()=>lines};
 const sandbox={t:{botOrderWanted:{current:true},botOrderParts:{current:{headLines:true}}},vt:{environment:{map:'ascent'}},qn:()=>({}),la:()=>({}),Se:null,Ke:null,ig:()=>planner,Kh:source=>(created++,{source,object:{id:'line-root'}}),i:{scene:{add:root=>roots.push(root)}},setTimeout:fn=>queueMicrotask(fn)};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'async function __aimPrepareAuxiliary(','let Sa=null,Vs=0;')+';this.prepare=__aimPrepareAuxiliary;',sandbox);
 await sandbox.prepare({check(){},phase(){}});assert.equal(advances,2);assert.equal(created,1);assert.equal(roots[0].id,'line-root');
 await sandbox.prepare({check(){},phase(){}});assert.equal(created,1,'settled planner and line roots are reused');
});

test('entry preparation state blocks click and Enter paths and changes the visible start label',()=>{
 const preparation={value:{status:'loading',label:'正在编译与预绘画面…'}},state={session:{value:'standalone'},preparation,mapLoading:{value:false},onResumePrep:{value:()=>false}};let starts=0;
 const sandbox={cC:state,cH:{blocking:{value:false}},e:fn=>({get value(){return fn()}}),Ol:()=>starts++};
 const computed=section(patched['DVK7uRSu.js'],'__aimEntryWaiting=e(',",cK=e(");
 const action=section(patched['DVK7uRSu.js'],'dL=()=>{',';function dM()');
 vm.runInNewContext('const '+computed+';const '+action+';this.start=dL;this.label=cJ;',sandbox);
 sandbox.start();assert.equal(starts,0);assert.equal(sandbox.label.value,'正在编译与预绘画面…');preparation.value={status:'failed'};sandbox.start();assert.equal(starts,0);assert.match(sandbox.label.value,/失败/);
 preparation.value={status:'ready'};sandbox.start();assert.equal(starts,1);assert.equal(sandbox.label.value,'点击任意位置开始');
 assert.match(patched['DVK7uRSu.js'],/'disabled':__aimEntryWaiting\['value'\]\|\|h\(cC\)\['mapLoading'\]/);
 assert.match(patched['DVK7uRSu.js'],/k\('div',\{'class':'al-scene-start-hint','style':O\(\{'display':__aimEntryWaiting\['value'\]\?'none':''\}\)\},'Enter\\x20也行',0x4\)/);
});

test('both entry gesture hints preserve dynamic VNode type, flag and block-child count through loading and ready',()=>{
 const source=patched['DVK7uRSu.js'];
 const hints=[section(source,"k('div',{'class':'al-scene-start-hint'",",cU['value']?"),section(source,"k('p',{'class':'hall-train-prep-hint'",",cP['value']?")];
 for(const [index,code]of hints.entries())for(const status of ['loading','ready','loading','failed','ready']){
  const dynamic=[],state={value:status!=='ready'};
  const sandbox={__aimEntryWaiting:state,cF:{preparation:{value:{status}}},h:v=>v,O:v=>v,p:text=>({type:'text',text}),k(type,props,children,flag=0){const vnode={type,props,children,flag};if(flag>0)dynamic.push(vnode);return vnode},g(){throw Error('static/comment branches change compiled parent dynamicChildren')}};
  vm.runInNewContext('this.vnode='+code+';',sandbox);assert.equal(sandbox.vnode.type,index?'p':'div');assert.equal(sandbox.vnode.flag,4);assert.equal(dynamic.length,1);assert.equal(dynamic[0],sandbox.vnode);assert.equal(sandbox.vnode.props.style.display,status==='ready'?'':'none');
 }
});

test('actual assessment/drill/blind countdown requires ready plus a manual gesture, rechecks completion and guards resume',()=>{
 const source=patched['DVK7uRSu.js'].slice(patched['DVK7uRSu.js'].indexOf('function __aimHallCanStart(){'));
 let starts=0,begins=0,restarts=0,rewinds=0,rounds=0,allow=true;const watchers=[];
 class Element{closest(){return null}}
 const countdown={state:{value:'waiting'},begin(){begins++;this.state.value='counting'},restart(){restarts++;this.state.value='counting'},rewind(){rewinds++;this.state.value='waiting'}};
 const state={session:{value:'assessment'},phase:{value:'idle'},preparation:{value:{status:'loading'}},engine:{value:{canStart:()=>allow,start:()=>starts++}},onPrepareRound:{value:null},onResumePrep:{value:null}};
 const sandbox={cF:state,Element,bU:false,x:value=>({value}),e:fn=>({get value(){return fn()}}),Mu:options=>(countdown.options=options,countdown),Xe:()=>rounds++,A:(read,write)=>watchers.push({read,write})};
 const helper=section(source,'function __aimHallCanStart(){','const cH=x('),initial=section(source,'const cH=x(',';function cN()'),click=section(source,'function cR(cY){','const cS=e('),watch=section(source,"A(()=>cF['preparation']",';const cO=e('),prepare=section(source,"cF['onPrepareRound']['value']=",",cF['onResumePrep']"),resume=section(source,"cF['onResumePrep']['value']=",';const cY=cy(');
 vm.runInNewContext(helper+initial+';'+click+watch+';'+prepare+';'+resume+";cH['value']=true;this.click=cR;",sandbox);
 const event={button:0,target:new Element()};sandbox.click(event);assert.equal(begins,0);assert.equal(starts,0);
 state.preparation.value={status:'ready'};watchers[0].write('ready');assert.equal(begins,0,'finishing preparation does not start the countdown automatically');
 allow=false;sandbox.click(event);assert.equal(begins,0,'native signature invalidation can restart preparation before a stale ready click');allow=true;sandbox.click(event);assert.equal(begins,1);assert.equal(starts,1);
 state.preparation.value={status:'loading'};watchers[0].write('loading');assert.equal(countdown.state.value,'waiting');assert.equal(rewinds,1);
 countdown.options.onStart();assert.equal(rounds,0);assert.equal(countdown.state.value,'waiting');state.preparation.value={status:'ready'};countdown.options.onStart();assert.equal(rounds,1);
 state.phase.value='paused';state.preparation.value={status:'failed'};assert.equal(state.onResumePrep.value(),true);assert.equal(state.phase.value,'paused');assert.equal(restarts,0);
 state.preparation.value={status:'ready'};assert.equal(state.onResumePrep.value(),true);assert.equal(state.phase.value,'idle');assert.equal(restarts,1);assert.equal(starts,2);
 state.preparation.value={status:'loading'};state.onPrepareRound.value({});assert.equal(restarts,1);assert.equal(countdown.state.value,'waiting');state.preparation.value={status:'ready'};state.onPrepareRound.value({awaitClick:true});assert.equal(countdown.state.value,'waiting');
 assert.match(source,/'data-action':'prep-retry'/);assert.match(patched['CymPR-fm.js'],/canStart:__aimCanStart,retryPreparation\(\)/);
});

test('native retained particles are pooled for long automatic fire and hip/ADS transitions, using the actual encrypted catalogue and Rv',async()=>{
 const decoder={crypto:globalThis.crypto,atob,TextEncoder,TextDecoder,Response,DecompressionStream,Blob,ArrayBuffer,Uint8Array};
 const source=fs.readFileSync(path.join(root,'site/js/DHDvBWqu.js'),'utf8').replace(/export\{[^}]+\};?\s*$/,'this.decrypt=H;');vm.runInNewContext(source,decoder);
 const encrypted=fs.readFileSync(path.join(root,'site/aim-viewmodel/muzzle.5073054cbb.json.enc'));
 const manifest=JSON.parse(new TextDecoder().decode(await decoder.decrypt(encrypted,'ishoutu.cn')));
 const runtimeSource=originals['CymPR-fm.js'],simulation={};vm.runInNewContext(runtimeSource.slice(runtimeSource.indexOf('function Mv(e,t,n){'),runtimeSource.indexOf('const Iv='))+';this.create=Rv;',simulation);
 const matrix=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,-1,1]),copy=(a,b)=>(b[0]=a[0],b[1]=a[1],b[2]=a[2],b),space={shifted:(a,b)=>(b.set(a),b),toView:copy,toWorld:copy,toWorldDir:copy};
 for(const [gun,rate]of [['phantom',11],['vandal',9.75],['classic',6.75],['odin',15.6],['bulldog',13.333],['stinger',18],['sheriff',4]]){
  const plan=planMuzzleBatches(manifest,gun,{intervalSeconds:1/rate});let peak=0;
  for(const random of [0,.5,.999999]){
   const runtime=simulation.create(manifest,space,{detail:4,rand:()=>random});
   for(let frame=0,shot=0;frame<360;frame++){
    const time=frame/120;runtime.update(1/120);
    while(shot/rate<=time){runtime.fire(gun,shot%2===1,{firing:2,total:2,movement:0},()=>({matrix:()=>matrix}));shot++;}
    const batches=runtime.systems.reduce((sum,system)=>sum+system.emitters.filter(e=>e.parts.length>0).length,0);peak=Math.max(peak,batches);
   }
  }
  assert.ok(plan.emitters.length>=peak,`${gun}: planned ${plan.emitters.length}, actual sustained peak ${peak}`);
  if(gun==='phantom'){assert.ok(peak>4,'old single-shot allocation misses real retained systems');assert.ok(plan.emitters.length>4)}
 }
});

test('batch windows retain delayed bursts, continuous emission and cubic lifetime bounds without inflating DestroyPrevious skins',()=>{
 const emitter={name:'delayed',enabled:true,mat:'a',delay:.2,duration:.5,loops:2,rate:{c:1},burst:[[1,-1,.5]],mods:[{t:'life',d:{curve:[[0,.1,'CIM_CurveAuto',0,6],[1,.1,'CIM_CurveAuto',-6,0]]}}]};
 const manifest={guns:{gun:{prev:'LeavePrevious',hip:[{sys:'one'}],ads:[]}},systems:{one:{emitters:[emitter]}}};
 const plan=planMuzzleBatches(manifest,'gun',{intervalSeconds:.1});assert.ok(plan.maxWindowSeconds>=.2+1+2.1+.1,'Hermite/Bezier control hull retains possible lifetime overshoot');assert.ok(plan.emitters.length>20);
 assert.throws(()=>planMuzzleBatches(manifest,'gun'),/interval/);emitter.mods=[{t:'life',d:{c:0}}];assert.throws(()=>planMuzzleBatches(manifest,'gun',{intervalSeconds:.1}),/Unbounded/);
 const skins=JSON.parse(fs.readFileSync(path.join(root,'skin-packs/models/fire-effects.json'),'utf8'));
 for(const [key,gun]of Object.entries(skins.guns)){assert.equal(gun.prev,'DestroyPrevious');const count=rules=>rules.reduce((sum,rule)=>sum+skins.systems[rule.sys].emitters.filter(e=>e.enabled&&e.mat).length,0);assert.equal(planMuzzleBatches(skins,key).emitters.length,Math.max(count(gun.hip),count(gun.ads)),key)}
});

test('output compositor warm compiles and draws on the real output target, reasserts after an async frame and restores every state on failure',async()=>{
 const source=section(patched['CymPR-fm.js'],'async function __aimWarmOutputPass(','async function __aimGpuFence(');
 class Vector{}class Color{}
 for(const failure of [null,'compile','render','cancel']){
  const before={target:{name:'linear-fx-target'},viewport:{x:3,y:4,z:320,w:180},scissor:{x:7,y:8,z:200,w:100},test:false,color:0x123456,alpha:.7},state={...before,viewport:{...before.viewport},scissor:{...before.scissor}};
  const output={name:'actual-output-target'},outputViewport={x:9,y:10,z:1280,w:720},scene={name:'composite'},camera={},calls=[];
  const rect=args=>typeof args[0]==='object'?{...args[0]}:{x:args[0],y:args[1],z:args[2],w:args[3]};
  const renderer={autoClear:true,getRenderTarget:()=>state.target,getViewport:v=>Object.assign(v,state.viewport),getScissor:v=>Object.assign(v,state.scissor),getScissorTest:()=>state.test,getClearColor:v=>Object.assign(v,{value:state.color}),getClearAlpha:()=>state.alpha,setRenderTarget:v=>{state.target=v},setViewport:(...v)=>{state.viewport=rect(v)},setScissor:(...v)=>{state.scissor=rect(v)},setScissorTest:v=>{state.test=v},setClearColor:(v,a)=>{state.color=v.value;state.alpha=a},
   async compileAsync(s,c){assert.equal(s,scene);assert.equal(c,camera);assert.equal(state.target,output);calls.push('compile');if(failure==='compile')throw Error('compile failed');await Promise.resolve();state.target={name:'interleaved-frame'};state.viewport={x:0,y:0,z:1,w:1};state.scissor={x:0,y:0,z:4,w:4};state.test=false;renderer.autoClear=true;state.color=0;state.alpha=0;},
   render(s,c){assert.equal(s,scene);assert.equal(c,camera);assert.equal(state.target,output);assert.deepEqual(state.viewport,outputViewport);assert.deepEqual(state.scissor,{x:9,y:10,z:1,w:1});assert.equal(state.test,true);assert.equal(renderer.autoClear,false);calls.push('draw');if(failure==='render')throw Error('render failed');}};
  const sandbox={On:Vector,ht:Color};vm.runInNewContext(source+';this.warm=__aimWarmOutputPass;',sandbox);let checks=0;
  const pending=sandbox.warm(renderer,scene,camera,output,outputViewport,()=>{if(++checks===2&&failure==='cancel')throw Error('cancelled')});
  if(failure)await assert.rejects(pending,new RegExp(failure==='cancel'?'cancelled':failure+' failed'));else await pending;
  assert.deepEqual(state,before);assert.equal(renderer.autoClear,true);assert.deepEqual(calls,failure==='compile'||failure==='cancel'?['compile']:['compile','draw']);
 }
 assert.match(patched['CymPR-fm.js'],/renderer\.setScissor\(scissorRect\);renderer\.setScissorTest\(scissor\)/,'outer muzzle preparation restores the original caller scissor too');
});

test('actual audio class silently prepares one live context, waits for decoding and footsteps, and removes context creation from first fire',async()=>{
 const decoded=deferred(),steps=deferred(),resumed=deferred();let contexts=0,gains=0,connections=0,voices=0,resumes=0,played=0,checks=0;
 class AudioContext{
  constructor(){contexts++;this.state='suspended';this.currentTime=0;this.destination={};}
  createGain(){gains++;return{connect(){connections++},gain:{setValueAtTime(){}}};}
  createBufferSource(){voices++;throw Error('loading must be silent');}
  resume(){resumes++;return resumed.promise;}
 }
 const selected={enabled:true,volume:.6,fireKit:'heavy',killKit:'native',killSound:true};
 const sandbox={AudioContext,Audio:class{addEventListener(){}},on:selected,ch:'jam',C0:()=>null,lh:()=>({clear(){}}),ul:null,
  fl(){sandbox.ul=steps.promise},__aimPrepareNativeAudio:async(context,weapons,settings,check)=>{assert.equal(context instanceof AudioContext,true);assert.equal(settings,selected);check();await decoded.promise;check()},
  Or:()=>false,Oa(){},Na:()=>false};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'class $i{','const ph=')+';this.Engine=$i;',sandbox);
 const audio=new sandbox.Engine({current:selected});let done=false;
 const preparing=audio.prepare(()=>checks++).then(()=>{done=true});
 assert.equal(contexts,1);assert.equal(gains,1);assert.equal(connections,1);assert.equal(voices,0);assert.equal(resumes,0);
 decoded.resolve();await turn();assert.equal(done,false,'footstep decoding also blocks ready');
 steps.resolve();await preparing;assert.equal(checks>=3,true);assert.equal(voices,0);assert.equal(resumes,0);
 await audio.prepare();assert.equal(contexts,1);assert.equal(gains,1,'a scene retry keeps its live graph');
 audio.unlock();assert.equal(resumes,1,'the user gesture initiates resume synchronously');
 audio.fire=()=>played++;audio.playFire();assert.equal(played,1);assert.equal(contexts,1,'first fire reuses the prepared live context');
 resumed.reject(Error('device unavailable'));await turn();assert.equal(voices,0,'preparation never starts an audio voice');
});

test('muted audio preparation and unlocking a missing context allocate nothing, while cancelled preparation cannot report ready',async()=>{
 let contexts=0,resources=0;const selected={enabled:false,volume:.7},pending=deferred();
 const sandbox={AudioContext:class{constructor(){contexts++;this.state='suspended';this.destination={}}createGain(){return{connect(){}}}},Audio:class{addEventListener(){}},on:selected,ch:'jam',C0:()=>null,lh:()=>({clear(){}}),ul:null,fl(){},__aimPrepareNativeAudio:async()=>{resources++;await pending.promise}};
 vm.runInNewContext(section(patched['CymPR-fm.js'],'class $i{','const ph=')+';this.Engine=$i;',sandbox);
 const audio=new sandbox.Engine({current:selected});audio.unlock();await audio.prepare();
 selected.enabled=true;selected.volume=0;await audio.prepare();audio.unlock();assert.equal(contexts,0);assert.equal(resources,0);
 selected.volume=.7;let current=true;const preparing=audio.prepare(()=>{if(!current)throw Error('cancelled')});current=false;pending.resolve();
 await assert.rejects(preparing,/cancelled/);assert.equal(contexts,1);
 const warm=section(patched['CymPR-fm.js'],'const __aimWarmIdentity=','const __aimWarmSelection=');
 assert.match(warm,/JSON\.stringify\(t\.audio\?\.current\)/,'changing mute/volume/kits invalidates preparation before start');
});

test('actual native decode and deterministic noise caches prepare only selected recordings plus in-flight flash sounds, without playback or world RNG',async()=>{
 const requests=[],jobs=new Map,math=Object.create(Math);math.random=()=>{throw Error('preparation changed global RNG')};
 let buffers=0;const pcm=[],context={sampleRate:48000,createBuffer(channels,count,rate){buffers++;assert.equal(channels,1);assert.equal(count,12000);assert.equal(rate,48000);const data=new Float32Array(count);pcm.push(data);return{getChannelData:()=>data}},async decodeAudioData(url){return{url}},createBufferSource(){throw Error('unexpected playback')}};
 const sandbox={Math:math,Gn:new WeakMap,xt:new Map,ln:new Map,We:{vandal:'weapon-vandal',phantom:'weapon-phantom'},Mn:{gunPhantom:'weapon-phantom'},wo:weapon=>weapon==='vandal'||weapon==='phantom',on:kit=>kit==='gunPhantom',Ut:kit=>kit==='champions'?['kill1','kill2','kill3','kill4','kill5']:null,Bd:kit=>kit==='champions',
  xl(url){requests.push(url);const job=deferred();jobs.set(url,job);return job.promise},context};
 const source=originals['DCKWp-_u.js'];
 vm.runInNewContext(section(source,'function Wl(e){','function pe(')+section(source,'function Pt(e,t){','const Dd=')+section(source,'function Vm(e,t){','function Kd(')+patched['DCKWp-_u.js'].slice(patched['DCKWp-_u.js'].indexOf('export async function __aimPrepareNativeAudio')).replace('export async function','async function')+';this.prepare=__aimPrepareNativeAudio;this.flash=Pt(context,"flash");',sandbox);
 let done=false;const settings={enabled:true,volume:1,fireKit:'gunPhantom',killSound:true,killKit:'champions'};
 const preparing=sandbox.prepare(context,['vandal'],settings).then(()=>{done=true});
 assert.deepEqual(requests,['flash','weapon-vandal','kill1','kill2','kill3','kill4','kill5']);assert.equal(buffers,1);
 const complete=url=>jobs.get(url).resolve({ok:true,arrayBuffer:async()=>url});
 for(const url of requests)if(url!=='flash')complete(url);await turn();assert.equal(done,false,'native flash decoding is part of readiness');
 complete('flash');await preparing;assert.equal(sandbox.ln.size,0);assert.equal(sandbox.xt.get('weapon-vandal').url,'weapon-vandal');
 await sandbox.prepare(context,['vandal'],settings);assert.equal(buffers,1);assert.equal(requests.length,7,'retry reuses decoded audio and the same noise buffer');
 const otherContext={...context};await sandbox.prepare(otherContext,[],{...settings,killSound:false});assert.equal(buffers,2);assert.deepEqual(pcm[0],pcm[1],'noise is deterministic per context and uses no global RNG');
 const kit=sandbox.prepare(context,null,{...settings,killSound:false});assert.equal(requests.at(-1),'weapon-phantom');complete('weapon-phantom');await kit;
 assert.throws(()=>applyPrewarmPatch({...originals,'DCKWp-_u.js':source.replace('function Dm(e,t){','function DmChanged(e,t){')}),/native audio caches/);
});
