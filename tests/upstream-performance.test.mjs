import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyUpstreamPerformancePatch,stableLightTopK,createBoundedPresentationPool,waitForStablePresentation,upstreamPerformanceCoverage} from '../patches/upstream-performance.mjs';
import {markMuzzleUploadRanges} from '../patches/muzzle-upload-performance.mjs';
import {publishBotOrder,subscribeBotOrder,offsetBotOrderHead} from '../patches/bot-order.mjs';
import {actorWarmCounts,createActorWarmPool} from '../patches/actor-prewarm.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const root=new URL('../upstream/aimpro-2026-11-05/source/js/',import.meta.url);
const original=Object.fromEntries(['CqM6URxy.js','CBthEhpW.js','Do4sYkfr.js'].map(name=>[name,fs.readFileSync(new URL(name,root),'utf8')]));
const patched=applyUpstreamPerformancePatch(original);
const originalTraining=original['CBthEhpW.js'],training=patched['CBthEhpW.js'];
const astCache=new Map();
function declaration(source,name){let ast=astCache.get(source);if(!ast){ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});astCache.set(source,ast)}const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end)}
function nestedDeclaration(source,name,signature){const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),found=[];function visit(value){if(!value||typeof value!=='object')return;if(value.type==='FunctionDeclaration'&&value.id.name===name&&source.slice(value.start,value.end).startsWith(signature))found.push(value);for(const item of Object.values(value)){if(Array.isArray(item))item.forEach(visit);else if(item&&typeof item==='object')visit(item)}}visit(ast);assert.equal(found.length,1);return source.slice(found[0].start,found[0].end)}
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return source.slice(a,b)}

function impactFixture(source,{load=true}={}){
 const counts={mesh:0,material:0,texture:0,clones:0,materialDisposals:0,textureDisposals:0,geometryDisposals:0};
 const materials=[],textures=[],geometries=[],loads=[];
 class Vector{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  clone(){return new Vector(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  addScaledVector(v,a){this.x+=v.x*a;this.y+=v.y*a;this.z+=v.z*a;return this;}
  multiplyScalar(v){this.x*=v;this.y*=v;this.z*=v;return this;}
  lengthSq(){return this.x**2+this.y**2+this.z**2;}
  length(){return Math.sqrt(this.lengthSq());}
  normalize(){const size=this.length();return size?this.multiplyScalar(1/size):this;}
  divideScalar(size){return this.multiplyScalar(1/size);}
  cross(v){const {x,y,z}=this;return this.set(y*v.z-z*v.y,z*v.x-x*v.z,x*v.y-y*v.x);}
 }
 class Quaternion{constructor(){this.values=[0,0,0,1];}copy(value){this.values=[...value.values];return this;}}
 class Matrix{
  makeBasis(x,y,z){this.basis=[x.clone(),y.clone(),z.clone()];return this;}
  scale(v){for(let at=0;at<3;at++)this.basis[at].multiplyScalar([v.x,v.y,v.z][at]);return this;}
  setPosition(v){this.position=v.clone();return this;}
  extractBasis(x,y,z){x.set(.8,0,-.6);y.set(0,1,0);z.set(.6,0,.8);return this;}
 }
 class Color{constructor(){this.setRGB(1,1,1);}setRGB(r,g,b){Object.assign(this,{r,g,b});return this;}}
 class Material{
  constructor(options){counts.material++;this.color=new Color();Object.assign(this,options);this.disposed=false;materials.push(this);}
  dispose(){assert.equal(this.disposed,false,'material is disposed exactly once');this.disposed=true;counts.materialDisposals++;}
 }
 class Texture{
  constructor(image=null,shared=null){counts.texture++;this.image=image;this.source=shared??{version:0};this.repeat={x:1,y:1,set(x,y){Object.assign(this,{x,y});}};this.offset={x:0,y:0,set(x,y){Object.assign(this,{x,y});}};this.disposed=false;this.version=0;textures.push(this);}
  clone(){counts.clones++;return new Texture(this.image,this.source);}
  set needsUpdate(value){if(value){this.version++;this.source.version++;}}
  dispose(){assert.equal(this.disposed,false,'texture is disposed exactly once');this.disposed=true;counts.textureDisposals++;}
 }
 class Geometry{
  constructor(...shape){this.shape=shape;this.attributes={};this.disposed=false;geometries.push(this);}
  setAttribute(name,value){this.attributes[name]=value;return this;}
  dispose(){assert.equal(this.disposed,false);this.disposed=true;counts.geometryDisposals++;}
 }
 class Attribute{constructor(array,size){this.array=Array.from(array);this.itemSize=size;}}
 class Mesh{
  constructor(geometry,material){counts.mesh++;Object.assign(this,{geometry,material,parent:null,position:new Vector(),scale:new Vector(1,1,1),quaternion:new Quaternion(),matrix:new Matrix(),visible:true,frustumCulled:true,renderOrder:0});}
  removeFromParent(){this.parent?.remove(this);}
  rotateZ(angle){this.quaternion.values[2]+=angle;return this;}
 }
 const scene={children:[],add(mesh){mesh.removeFromParent();mesh.parent=this;this.children.push(mesh);},remove(mesh){const at=this.children.indexOf(mesh);if(at>=0){this.children.splice(at,1);mesh.parent=null;}}};
 const camera={position:new Vector(1,1.6,.2),quaternion:new Quaternion(),matrixWorld:new Matrix(),aspect:16/9,fov:75,updateMatrixWorld(){}};
 camera.quaternion.values=[.1,.2,.3,.9];
 const context=vm.createContext({He:Vector,hs:Geometry,Je:Attribute,mt:Mesh,Xn:Material,Ui:Texture,vs:Geometry,
  Dl:2,we:1/128,Fv:()=>context.effectsEnabled,__aimCreatePresentationPool:createBoundedPresentationPool,
  m0(url,callback){loads.push(()=>{const texture=new Texture({url});callback(texture);return texture;});},
  document:{createElement:()=>({width:0,height:0,getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})},
  scene,camera,effectsEnabled:true,globalThis:null});context.globalThis=context;
 const constants=between(originalTraining,'const us=','function bw(');
 const factory=declaration(source,'bw');
 vm.runInContext(constants+'\n'+factory+'\neffect=bw(scene,camera)',context);
 const loaded=load?loads.map(callback=>callback()):[];
 const clean=value=>JSON.parse(JSON.stringify(value));
 const vector=value=>[value.x,value.y,value.z];
 const picture=()=>scene.children.map(mesh=>({
  position:vector(mesh.position),scale:vector(mesh.scale),quaternion:mesh.quaternion.values,
  basis:mesh.matrix.basis?.map(vector),matrixPosition:mesh.matrix.position?vector(mesh.matrix.position):null,
  material:{opacity:mesh.material.opacity,color:mesh.material.color,blend:mesh.material.blending,side:mesh.material.side,depthTest:mesh.material.depthTest,depthWrite:mesh.material.depthWrite,
   image:mesh.material.map?.image?.url??(mesh.material.map?'glow':null),repeat:mesh.material.map?[mesh.material.map.repeat.x,mesh.material.map.repeat.y]:null,offset:mesh.material.map?[mesh.material.map.offset.x,mesh.material.map.offset.y]:null},
  renderOrder:mesh.renderOrder,visible:mesh.visible,frustumCulled:mesh.frustumCulled,geometry:mesh.geometry.shape,attributes:mesh.geometry.attributes
 })).map(clean);
 return {effect:context.effect,context,scene,camera,counts,materials,textures,geometries,loaded,loads,picture};
}

test('real new impact factory preserves appearance and lifetime while reusing warmed objects',()=>{
  const native=impactFixture(originalTraining),fixed=impactFixture(training);
  for(const mesh of fixed.effect.warmUp())mesh.frustumCulled=false;
  const warmed=fixed.counts.mesh;
  for(let shot=0;shot<80;shot++){
    const tick=shot*128,point={x:shot%7-3,y:1+shot%3*.2,z:-6-shot%5},zone=['head','body','legs'][shot%3];
    for(const f of [native,fixed])f.effect.spawn(point,zone,tick);
    for(const age of [0,2,8,12,25]){native.effect.update(tick+age);fixed.effect.update(tick+age);assert.deepEqual(fixed.picture(),native.picture());}
  }
  assert.equal(fixed.counts.mesh,warmed);assert.equal(fixed.counts.clones,4);
  assert.equal(fixed.counts.materialDisposals,0);
  fixed.effect.dispose();fixed.effect.dispose();
  assert.equal(fixed.counts.materialDisposals,fixed.counts.material);
  assert.equal(fixed.counts.textureDisposals,fixed.counts.texture);
});

test('impact burst is not truncated and idle pool is bounded; late images are disposed',()=>{
  const native=impactFixture(originalTraining),fixed=impactFixture(training);
  for(let shot=0;shot<100;shot++)for(const f of [native,fixed])f.effect.spawn({x:shot/100,y:1,z:-5},'head',0);
  native.effect.update(5);fixed.effect.update(5);assert.deepEqual(fixed.picture(),native.picture());
  fixed.effect.update(128);assert.equal(fixed.counts.material-fixed.counts.materialDisposals,128);
  fixed.effect.dispose();assert.equal(fixed.counts.materialDisposals,fixed.counts.material);
  const late=impactFixture(training,{load:false});late.effect.warmUp();late.effect.dispose();late.loads.forEach(load=>load());
  assert.equal(late.counts.textureDisposals,late.counts.texture);assert.equal(late.effect.warmUp().length,0);
  late.effect.spawn({x:0,y:0,z:0},'head',1);assert.equal(late.scene.children.length,0);
});

test('stable Top-K matches native stable full sort including ties and reused scratch arrays',()=>{
  const output=[],scores=[];
  for(let seed=0;seed<40;seed++){
    const lights=Array.from({length:100},(_,id)=>({id,score:(id*37+seed*11)%19-3}));
    for(const cap of [0,1,4,16,120]){
      const expected=lights.filter(v=>v.score>0).sort((a,b)=>b.score-a.score).slice(0,cap);
      assert.deepEqual(stableLightTopK(lights,cap,v=>v.score,output,scores),expected);
    }
  }
});

function simulate({maxFps=0,nth=1,jitter=0,tickCpuMs=0,callbackDelay=()=>0,text=training}={}){
  let now=0,frameTime=0,callback,next=0,ticks=0,accumulator=0;const frames=[];
  const scheduler={now:()=>now,requestFrame:fn=>(callback=fn,++next),cancelFrame:()=>{callback=null}};
  const stats=()=>({record(){},report:()=>null,reset(){},frame(){},summary:()=>({}),recent:()=>[]});
  const make=vm.runInNewContext(declaration(text,'nk')+';nk',{
    qw:scheduler,Zw:1,Jw:8,ek:.98,Hw:stats,Xw:stats,
    Sp:()=>({advance(seconds){accumulator+=seconds;const count=Math.floor((accumulator+1e-10)*128);accumulator-=count/128;return count},alpha:()=>accumulator*128,reset(){accumulator=0}}),
  });
  const loop=make({onTick(){ticks++;now+=tickCpuMs},onRender(){frames.push(frameTime)}},{maxFps,renderEveryNthFrame:nth,showPerformance:false},scheduler);
  loop.start();for(let frame=0;frame<=2400;frame++){frameTime=1000+frame*1000/240+(frame%2?jitter:-jitter);now=frameTime+callbackDelay(frame);const fn=callback;callback=null;assert.equal(typeof fn,'function');fn(frameTime)}loop.stop();return {ticks,frames};
}
test('actual new RAF loop caps on display time without changing 128 Hz simulation',()=>{
  for(const cap of [0,60,120,144,165,240]){
    const idle=simulate({maxFps:cap}),loaded=simulate({maxFps:cap,tickCpuMs:.8,callbackDelay:frame=>frame%2?0:1});
    assert.equal(loaded.ticks,1280);assert.deepEqual(loaded.frames,idle.frames);
    assert.ok(loaded.frames.length<=(cap||240)*10+2);
  }
  assert.equal(simulate({nth:2}).frames.length,1201);
  const fixed=simulate({maxFps:120,jitter:.08}),native=simulate({maxFps:120,jitter:.08,text:originalTraining});
  const deviation=frames=>Math.max(...frames.slice(1).map((t,i)=>Math.abs(t-frames[i]-1000/120)));
  assert.ok(deviation(fixed.frames)<.161);assert.ok(deviation(native.frames)>4);
});

test('empty particle generation returns before scratch allocation or callbacks',()=>{
  const generator=vm.runInNewContext(declaration(training,'q0')+';q0',{Float32Array:class{constructor(){throw Error('allocation')}}});
  assert.equal(generator([],null,null,null),0);
});

test('muzzle prefixes replace stale ranges and zero emission retains pending uploads',()=>{
  const attr=itemSize=>({itemSize,ranges:[{start:999,count:1}],needsUpdate:false,clearUpdateRanges(){this.ranges=[]},addUpdateRange(start,count){this.ranges.push({start,count})}});
  const attrs=[attr(3),attr(2),attr(4)],dynAttr=attr(4),slot={attrs,dynAttr,mesh:{material:{userData:{dyn:true}}}};
  markMuzzleUploadRanges(slot,6);for(const a of [...attrs,dynAttr])assert.deepEqual(a.ranges,[{start:0,count:6*a.itemSize}]);
  markMuzzleUploadRanges(slot,0);for(const a of [...attrs,dynAttr])assert.equal(a.ranges[0].count,6*a.itemSize);
  markMuzzleUploadRanges(slot,3);for(const a of [...attrs,dynAttr])assert.equal(a.ranges[0].count,3*a.itemSize);
  const end=training.match(/end\(ie\)\{const ve=fe;if\(ve\)\{ve\.mesh\.geometry\.setDrawRange\(0,ie\);__aimMuzzleUploadRanges[^}]+\}\}/)?.[0];assert.ok(end);
  const scene={},layer={light:false,flash:false},mesh={visible:true,geometry:{setDrawRange(){}},material:{userData:{dyn:false}}};
  const finish=vm.runInNewContext('({'+end+'}).end',{fe:{...slot,mesh,scene},_: {lightScene:scene},A:layer,D:{},S(){},__aimMuzzleUploadRanges:markMuzzleUploadRanges});
  finish(0);assert.equal(layer.light,false);assert.equal(mesh.visible,false);
});

test('bot-order paint follows publishing and unsubscribe and aligns to rendered root',()=>{
  const view={current:{tick:0}},seen=[];const off=subscribeBotOrder(view,value=>seen.push(value.tick));
  view.current={tick:2};publishBotOrder(view);off();off();view.current={tick:3};publishBotOrder(view);assert.deepEqual(seen,[0,2]);
  const point=offsetBotOrderHead({x:5,y:4,z:3},{position:{x:4,y:1,z:2},offset:{x:1,y:1,z:1}},{x:4.5,y:2,z:3});
  assert.deepEqual(point,{x:4.5,y:4,z:3});
  assert.ok(training.indexOf('xn.apply(Q,bs,le,Jm(Q))')<training.indexOf('__aimPublishBotOrder(t.botOrder)'));
});

test('actual new actor renderer interpolates adjacent ticks, handles teleport and keeps apply-only path',()=>{
  const point=()=>({x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}}),children=new Set();
  const material=()=>({clone:material,dispose(){},color:{setHex(){}},emissive:{setHex(){return this},multiplyScalar(){}}});
  function mesh(){return {root:{position:point(),rotation:{y:0},visible:true},parts:[{material:material(),scale:{...point(),x:1,y:1,z:1}}],pivot:{scale:{setScalar(){}}},baseColor:0,hitColor:1}}
  const factory=vm.runInNewContext(declaration(patched['Do4sYkfr.js'],'v0')+';v0',{
    lw:class{},Wf:class{},dg:class{},OQ:class{},D8:a=>({x:a.position.x+a.offset.x,y:a.position.y+a.offset.y,z:a.position.z+a.offset.z}),
    Qi:()=>'',ya:()=>mesh(),Va(){},Oa(){},gi(){},ei:()=>null,Pw:()=>0,lP:()=>1,Di:3,ti:2,QE:.5,Ei:2.5,oi:2.5,IA:1/128,
    ZA:player=>({x:player.position.x,y:player.position.y+1.6,z:player.position.z}),dF:p=>p,
    ce:(a,b,t)=>a+(b-a)*t,et:(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}),__aimActorWarmPool:{release(){}},
  });
  const scene={root:{add:m=>children.add(m),remove:m=>children.delete(m)}},camera={position:point(),rotation:{set(){}}};
  const render=factory(scene,camera,{},{});
  const snapshot=(tick,x=tick*.1)=>({tick,actors:[{id:'bot',templateId:'bot',bornTick:0,visible:true,alive:true,position:{x,y:0,z:0},offset:{x:0,y:0,z:0}}],player:{position:{x,y:0,z:0},grounded:true,pitch:0,yaw:0}});
  let s=snapshot(0);render.capture(s);render.apply(s,[],.5);
  for(let tick=1;tick<=4;tick++){s=snapshot(tick);render.capture(s)}render.apply(s,[],.5);
  assert.ok(Math.abs(camera.position.x-.35)<1e-10);assert.ok(Math.abs(render.actorPosition('bot').x-.35)<1e-10);
  s=snapshot(5,10);render.capture(s);render.apply(s,[],.1);assert.equal(camera.position.x,10);assert.equal(render.actorPosition('bot').x,10);
  render.clear();s=snapshot(9);render.apply(s,[],.5);assert.equal(camera.position.x,.9);
  render.clear();s=snapshot(0);render.capture(s);render.apply(s,[],.5);
  s=snapshot(1,0);s.player.position.y=.2;render.capture(s);render.apply(s,[],.5);
  assert.ok(Math.abs(camera.position.y-1.609765625)<1e-10,'upward stair keeps native vertical smoothing without dipping');
});

test('actual preparation retains warmed first-wave actors and disposes failed/cancelled reservations',async()=>{
  const code=nestedDeclaration(training,'dc','async function dc(M,j){');
  for(const outcome of ['success','cancel','throw']){
    let skeletonDisposals=0,decalDisposals=0;const made=[];
    function make(){const child={isMesh:true,frustumCulled:true},root={parent:null,traverse(fn){fn(child)},removeFromParent(){this.parent?.remove(this)}};const mesh={root,skin:{skeleton:{dispose(){skeletonDisposals++}}}};made.push({mesh,child});return mesh;}
    const scene={actorTemplates:new Map([['bot',{spawn:make}]])},pool=createActorWarmPool(actorWarmCounts),phase={current:'idle'};
    const doc={actors:[{id:'bot',body:{shape:'sphere'}}],spawners:[{actorTemplateId:'bot',maxAlive:2}]};
    const parent={remove(root){root.parent=null}};
    const context={fn:scene,Za:1,Ys:false,__aimReadyPresentation:async current=>current(),t:{phase},__aimReserveActorWarmPool:(s,d)=>pool.reserve(s,d),i:{warmUp:()=>[]},c:{warmUp:()=>[{removeFromParent(){},material:{dispose(){decalDisposals++}}}]},l:{async prewarm(check,roots){for(const root of roots)root.parent=parent;for(const {child}of made)assert.equal(child.frustumCulled,false);if(outcome==='cancel')phase.current='running';if(outcome==='throw')throw Error('compile failed');return check()}}};
    const prepare=vm.runInNewContext(code+';dc',context);
    if(outcome==='throw')await assert.rejects(prepare(doc,1),/compile failed/);else await prepare(doc,1);
    assert.equal(made.length,2);assert.equal(decalDisposals,1);
    for(const {child,mesh}of made){assert.equal(child.frustumCulled,true);assert.equal(mesh.root.parent,null)}
    if(outcome==='success'){assert.equal(skeletonDisposals,0);assert.ok(pool.take(scene,'bot'));assert.ok(pool.take(scene,'bot'));assert.equal(pool.take(scene,'bot'),null)}else{assert.equal(skeletonDisposals,2);assert.equal(pool.take(scene,'bot'),null)}
  }
});

test('bad actor warmup falls back per template and still warms effects',async()=>{
  const code=nestedDeclaration(training,'dc','async function dc(M,j){');let warm=0,disposed=0;
  const good={root:{traverse(){},removeFromParent(){}},skin:{skeleton:{dispose(){disposed++}}}};
  const scene={actorTemplates:new Map([['bad',{spawn(){throw Error('asset missing')}}],['good',{spawn:()=>good}]])};
  const context={fn:scene,Za:1,Ys:false,__aimReadyPresentation:async current=>current(),t:{phase:{current:'idle'}},__aimReserveActorWarmPool(){throw Error('bad reservation')},i:{warmUp:()=>[]},c:{warmUp:()=>[]},l:{async prewarm(check,roots){warm++;assert.equal(roots.length,1)}}};
  await vm.runInNewContext(code+';dc',context)({actors:[]},1);assert.equal(warm,1);assert.equal(disposed,1);
});

test('presentation gate rechecks selection revision, waits model readiness and supports cancellation',async()=>{
  let revision=0,prepared=0,loaded=0,readied=0,active=true;const model={async ready(){readied++;if(readied===1)revision++}};
  const options={revision:()=>revision,async prepare(){prepared++},async load(){loaded++},model:()=>model,current:()=>active};
  assert.equal(await waitForStablePresentation(options),true);assert.equal(prepared,2);assert.equal(loaded,2);assert.equal(readied,2);
  options.prepare=async()=>{active=false};assert.equal(await waitForStablePresentation(options),false);assert.equal(loaded,2);
});

test('actual start gate cannot enter running while scene/skin/model preparation is pending',async()=>{
  const code=nestedDeclaration(training,'kc','async function kc(){');let resolveScene,resolvePresentation;const phases=[];
  const phase={current:'running'},context=vm.createContext({__aimStartGeneration:0,Za:1,fn:{},Ys:false,t:{phase},ya(){},gc(){},Nn:()=>true,_o(){throw Error('unexpected lock')},n:{onPhaseChange(value){phase.current=value;phases.push(value)},onLastResult(){},onSessionActive(){}},__aimPreparation:new Promise(resolve=>{resolveScene=resolve}),__aimReadyPresentation:()=>new Promise(resolve=>{resolvePresentation=resolve})});
  const start=vm.runInContext(code+';kc',context),job=start();assert.deepEqual(phases,['idle']);resolveScene();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(phases,['idle']);resolvePresentation(true);await job;assert.deepEqual(phases,['idle','running']);
});

test('queued native warm pass rechecks generation before allocating stale warm roots',async()=>{
  const code=nestedDeclaration(patched['CqM6URxy.js'],'T','function T(D,U){if(_)');let finish;
  const pending=new Promise(resolve=>{finish=resolve});const context=vm.createContext({_:pending,v:false,pi:class{constructor(){throw Error('unexpected allocation')}}});
  const warm=vm.runInContext(code+';T',context),job=warm(()=>false,[]);context._=null;finish();await job;
});

test('complete new-client transform is syntax-valid, immutable, idempotence-protected and fail-closed',()=>{
  for(const source of Object.values(patched))parse(source,{ecmaVersion:'latest',sourceType:'module'});
  assert.equal(originalTraining,fs.readFileSync(new URL('CBthEhpW.js',root),'utf8'));
  assert.throws(()=>applyUpstreamPerformancePatch({}),/missing/);
  assert.throws(()=>applyUpstreamPerformancePatch(patched),/already applied/);
  assert.throws(()=>applyUpstreamPerformancePatch({...original,'CBthEhpW.js':originalTraining.replace('function q0(e,t,n,s){','function changed(e,t,n,s){')}),/version mismatch/);
  assert.equal(Object.keys(upstreamPerformanceCoverage).length,13);
  assert.equal(typeof upstreamPerformanceCoverage.renderAllocation,'string');
});
