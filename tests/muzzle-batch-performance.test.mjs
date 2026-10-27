import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyMuzzleLayerPerformancePatch} from '../patches/muzzle-layer-performance.mjs';
import {applyMuzzleBatchPerformancePatch,coalesceMuzzleBatches} from '../patches/muzzle-batch-performance.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const retained=fs.readFileSync(new URL('../site/js/CymPR-fm.js',import.meta.url),'utf8');
const original=applyMuzzleLayerPerformancePatch({'CymPR-fm.js':retained})['CymPR-fm.js'];
const patched=applyMuzzleBatchPerformancePatch({'CymPR-fm.js':original})['CymPR-fm.js'];
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const particle=(options={})=>({loc:[0,0,-1],col:[1,.7,.3],alpha:.8,size:[.2,.2,.2],rot:0,sub:0,...options});
const emitter=(mat,parts=[particle()],options={})=>({tpl:{mat,sub:[1,1],pivot:[0,0],align:'Square',...options},parts});
function section(source,begin,end,at=0){const start=source.indexOf(begin,at),stop=source.indexOf(end,start+begin.length);assert.ok(start>=0&&stop>start,begin);return source.slice(start,stop);}

function fixture(source,emitters,{overGun=false,capacity=3072,warm=false,materialOptions={},meshes={},layers={},dynamics={}}={}){
 const events=[],slots=[],materials=new Map(),camera={fov:90,aspect:1,near:.1,far:200,getEffectiveFOV:()=>90,projectionMatrix:{elements:[1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-.2,0]}};
 const scene=name=>({name,children:[],add(mesh){this.children.push(mesh);},remove(mesh){this.children=this.children.filter(value=>value!==mesh);}});
 const q={lightScene:scene('light'),flashScene:scene('flash'),quadCam:{},fxCam:camera,
  lightPass:{scene:scene('light-composite'),mat:{uniforms:{tex:{value:null}}}},tonePass:{scene:scene('tone-composite'),mat:{uniforms:{tex:{value:null}}}}};
 const gun=scene('gun'),model={fxLayer:()=>({scene:gun,camera})},target={width:1920,height:1080,texture:{},scissor:{set(){}},scissorTest:false};
 const renderer={autoClear:true,target:null,scissor:true,color:0x123456,alpha:.4,
  initTexture(){assert.fail('No texture uploads in steady-state fixture');},
  getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;},
  getScissorTest(){return this.scissor;},setScissorTest(value){this.scissor=value;},setScissor(){},
  getClearColor(out){out.value=this.color;return out;},getClearAlpha(){return this.alpha;},
  setClearColor(value,alpha){this.color=typeof value==='object'?value.value:value;this.alpha=alpha;},
  getDrawingBufferSize(out){out.x=1920;out.y=1080;return out;},getPixelRatio:()=>1,
  clear(...mask){events.push({clear:mask});},render(scene){
   const batches=scene.children.filter(mesh=>mesh.visible&&mesh.geometry.drawRange.count>0).sort((a,b)=>a.renderOrder-b.renderOrder);
   const triangles=[];
   for(const mesh of batches){const count=mesh.geometry.drawRange.count,sink=mesh.sink;
    for(let at=0;at<count;at+=3)triangles.push({material:mesh.material.key,uniforms:mesh.material.uniforms,vertices:Array.from({length:3},(_,vertex)=>{
     const index=at+vertex;return [...sink.pos.slice(index*3,index*3+3),...sink.uv.slice(index*2,index*2+2),...sink.col.slice(index*4,index*4+4),...sink.dyn.slice(index*4,index*4+4)];
    })});
   }
   events.push({render:scene.name,draws:batches.length,triangles});
  }
 };
 const material=key=>{if(!materials.has(key))materials.set(key,{key,forceSinglePass:true,userData:{layer:layers[key]??(key.startsWith('light')?'light':'flash'),dyn:dynamics[key]??true},uniforms:{texture:key,time:1},...materialOptions});return materials.get(key);};
 const context={a:false,s:{enabled:true,viewModel:model,weapon:'vandal',time:1},w:[],n:{systems:[{emitters}],setDetail(){},update(){},clear(){},fire(){assert.fail('No new simulation shots');}},
  t:{guns:{vandal:{hip:[],ads:[],overGun}},meshes},u:'vandal',r:model,l:0,Xv:.1,A:{gameTime:{value:0}},C:q,z:{value:0},o:15,
  p:{copy(){}},d:{copy(){}},c:1,ce:()=>()=>null,i:[],I:{},k:slots,ws:capacity,
  L(){const sink={pos:new Float32Array(capacity*3),uv:new Float32Array(capacity*2),col:new Float32Array(capacity*4),dyn:new Float32Array(capacity*4),capacity};
   const geometry={index:null,groups:[],drawRange:{start:0,count:0},setDrawRange(start,count){assert.equal(start,0);this.drawRange.count=count;}};
   return {scene:null,attrs:[{},{},{}],dynAttr:{},mesh:{sink,geometry,visible:false},sink};},
  _:material,P:()=>target,G:{},$: {},v:warm,H(){events.push({warm:true});},Pl(q,renderer){renderer.render(gun);},ue:0,de:0,
  Iv:[0,0,0,0],zv:.1,Cv:[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]],Ti:()=>identity(),
  y:{shifted(matrix,out){out.set(matrix);},toView(position,out){out.splice(0,3,...position);}},
  Xo(matrix,x,y,z,out){out[0]=x;out[1]=y;out[2]=z;return out;},
  Ru(matrix,x,y,z,out){out[0]=x;out[1]=y;out[2]=z;return out;},
  an(out){const length=Math.hypot(...out)||1;for(let index=0;index<3;index++)out[index]/=length;return out;},
  Si:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  Fv(lock,l,u,r,c,p,d){p[0]=1;p[1]=p[2]=0;d[1]=1;d[0]=d[2]=0;},
  __aimCoalesceMuzzleBatches:coalesceMuzzleBatches,
 };
 const begin=source.indexOf('function qv(e){');
 const nativeLv=section(source,'function Lv(','function ',source.indexOf('const Iv='));
 const nativeBounds=section(source,'function B(S,K,F){','const Y=new po',begin);
 const nativeRender=section(source,'render(S,K){if(a||!s)return;','},setDetail(S){o=S}',begin)+'}';
 const nativeTransforms=section(source,'function Ru(','const Ti=');
 const nativeOrientation=section(source,'function Pv(','const Ll=');
 vm.runInNewContext(nativeTransforms+nativeOrientation+nativeLv+nativeBounds+';globalThis.render=({'+nativeRender+'}).render;',context);
 function render(){context.render(renderer,{getEffectiveFOV:()=>90,matrixWorld:identity(),matrixWorldInverse:identity()});
  assert.equal(renderer.autoClear,true);assert.equal(renderer.target,null);assert.equal(renderer.scissor,true);assert.equal(renderer.color,0x123456);assert.equal(renderer.alpha,.4);}
 render();
 return {events,context,renderer,slots,materials,render};
}
const visualEvents=events=>events.map(({draws,...event})=>event);
const drawCount=fixture=>fixture.events.reduce((sum,event)=>sum+(event.draws??0),0);

test('native adjacent same-material draws become one while every triangle and pass remains identical',()=>{
 const emitters=[emitter('flash-a',[particle({col:[.2,.3,.4],dyn:[1,2,3,4]})]),emitter('flash-a',[particle({loc:[.1,.2,-1.1],flipU:true,rot:.3})]),emitter('flash-a'),emitter('light-b'),emitter('light-b')];
 const before=fixture(original,emitters),after=fixture(patched,emitters);
 assert.deepEqual(visualEvents(after.events),visualEvents(before.events));
 assert.equal(drawCount(before),5);assert.equal(drawCount(after),2);
 assert.equal(after.context.ue,before.context.ue);assert.equal(after.context.de,before.context.de,'retain logical emitter stats');
 assert.deepEqual(after.context.I,before.context.I,'native screen bounds and layer decisions are unchanged');
});

test('different materials and interleaved layer draws retain native ordering and never cross-merge',()=>{
 for(const keys of [['flash-a','flash-b','flash-a'],['flash-a','light-b','flash-a']]){
  const emitters=keys.map(key=>emitter(key));
  const before=fixture(original,emitters),after=fixture(patched,emitters);
  assert.deepEqual(after.events,before.events);assert.equal(drawCount(after),3);
 }
});

test('each emitter keeps its original capacity truncation and exact-capacity joins remain safe',()=>{
 const first=particle({loc:[-.1,0,-1]}),second=particle({loc:[.1,0,-1]});
 const emitters=[emitter('flash-a',[first]),emitter('flash-a',[first,second,particle({loc:[.3,0,-1]})])];
 const before=fixture(original,emitters,{capacity:12}),after=fixture(patched,emitters,{capacity:12});
 assert.equal(before.context.ue,3);assert.equal(after.context.ue,3);assert.equal(drawCount(after),2);
 assert.deepEqual(after.events,before.events,'remaining capacity must not truncate emitter 2 down to one particle');
 const three=[emitter('flash-a'),emitter('flash-a'),emitter('flash-a')];
 const boundaryBefore=fixture(original,three,{capacity:12}),boundaryAfter=fixture(patched,three,{capacity:12});
 assert.equal(drawCount(boundaryAfter),2);assert.equal(boundaryAfter.slots[0].mesh.geometry.drawRange.count,12);
 assert.deepEqual(visualEvents(boundaryAfter.events),visualEvents(boundaryBefore.events));
});

test('mesh particles, dynamic channels and clipped empty emitters preserve actual native output',()=>{
 const meshes={triangle:{i:[0,1,2],v:[0,0,0,.1,0,0,0,.2,0],uv:[0,0,1,0,0,1]}};
 const emitters=[emitter('flash-a',[particle({dyn:[.1,.2,.3,.4]})],{mesh:{name:'triangle'}}),
  emitter('light-clipped',[particle({loc:[0,0,-.05],camOff:.2})]),
  emitter('flash-a',[particle({size:[.4,.2,.3],col:[.3,.4,.5],dyn:[.6,.7,.8,.9]})],{mesh:{name:'triangle'}})];
 const before=fixture(original,emitters,{meshes,overGun:true,warm:true}),after=fixture(patched,emitters,{meshes,overGun:true,warm:true});
 assert.deepEqual(visualEvents(after.events),visualEvents(before.events));assert.equal(drawCount(after),1);assert.equal(drawCount(before),2);
 assert.equal(after.context.I.light,false);assert.equal(after.context.I.flash,true);
});

test('reused pool restores every native slot on later frames without changing particle contents or allocation count',()=>{
 const emitters=[emitter('flash-a'),emitter('flash-a'),emitter('flash-b')];
 const before=fixture(original,emitters),after=fixture(patched,emitters);
 const count=after.slots.length;
 before.events.length=0;after.events.length=0;
 before.render();after.render();
 assert.equal(after.slots.length,count);assert.deepEqual(visualEvents(after.events),visualEvents(before.events));
 assert.equal(drawCount(after),2);assert.equal(after.context.de,3);
 const noSingle=fixture(patched,emitters,{materialOptions:{forceSinglePass:false}});
 assert.equal(drawCount(noSingle),3,'double-pass material order is not changed');
});

test('only exact material identity, unindexed single-range geometry and a single scene can join',()=>{
 const make=()=>fixture(original,[emitter('flash-a'),emitter('flash-a')]);
 for(const change of [f=>{f.slots[1].mesh.material={...f.slots[1].mesh.material};},f=>{f.slots[1].scene={};},
  f=>{f.slots[1].mesh.geometry.index={};},f=>{f.slots[1].mesh.geometry.groups=[{}];}]){
  const f=make();change(f);assert.equal(coalesceMuzzleBatches(f.slots,2,3072),0);
  assert.ok(f.slots.every(slot=>slot.mesh.visible));
 }
});

test('nonzero draw-range starts refuse either merge position without rewriting its range',()=>{
 for(const index of [0,1]){
  const f=fixture(original,[emitter('flash-a'),emitter('flash-a')]);
  f.slots[index].mesh.geometry.drawRange.start=3;
  const before=f.slots.map(slot=>({...slot.mesh.geometry.drawRange}));
  assert.equal(coalesceMuzzleBatches(f.slots,2,3072),0);
  assert.deepEqual(f.slots.map(slot=>slot.mesh.geometry.drawRange),before);
  assert.ok(f.slots.every(slot=>slot.mesh.visible));
 }
});

test('actual Champions 2023 catalogue emitter pairs retain native vertices while reducing steady draw batches',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../skin-packs/models/fire-effects.json',import.meta.url),'utf8'));
 const gun=manifest.guns['champions-2023/vandal'];
 const layers=Object.fromEntries(Object.entries(manifest.materials).map(([key,value])=>[key,value.kind==='fakelight'?'light':'flash']));
 const dynamics=Object.fromEntries(Object.entries(manifest.materials).map(([key,value])=>[key,value.kind==='skinmask'||value.kind==='procsmoke']));
 const measured=[];
 for(const rule of [gun.hip[0],gun.hip[1],gun.ads[0],gun.ads[1]]){
  const templates=manifest.systems[rule.sys].emitters.filter(template=>template.enabled&&template.mat);
  const emitters=templates.map((tpl,index)=>({tpl,parts:[particle({loc:[index*.01,0,-1],dyn:[.1,.2,.3,.4]})]}));
  const options={meshes:manifest.meshes,layers,dynamics};
  const before=fixture(original,emitters,options),after=fixture(patched,emitters,options);
  assert.deepEqual(visualEvents(after.events),visualEvents(before.events),rule.sys);
  assert.equal(after.context.ue,before.context.ue);
  assert.ok(drawCount(after)<drawCount(before),rule.sys+' must contain the actual neighboring material pairs');
  measured.push({before:drawCount(before),after:drawCount(after)});
 }
 assert.ok(measured.some(value=>value.before-value.after>=2),'full original Champions catalogue pair sets merge');
});

test('optional source transform composes with the default layer patch, parses, and refuses changed native shapes',()=>{
 const modules={'CymPR-fm.js':original,untouched:'value'},output=applyMuzzleBatchPerformancePatch(modules);
 assert.equal(modules['CymPR-fm.js'],original);assert.equal(output.untouched,'value');
 parse(output['CymPR-fm.js'],{ecmaVersion:'latest',sourceType:'module'});
 assert.ok(output['CymPR-fm.js'].includes('__aimMuzzleVisibleLayers'));
 assert.throws(()=>applyMuzzleBatchPerformancePatch({}),/missing training/);
 assert.throws(()=>applyMuzzleBatchPerformancePatch(output),/already applied/);
 assert.throws(()=>applyMuzzleBatchPerformancePatch({'CymPR-fm.js':original.replace('q.frustumCulled=!1,q.matrixAutoUpdate=!1','q.frustumCulled=!0,q.matrixAutoUpdate=!1')}),/version mismatch/);
 assert.throws(()=>applyMuzzleBatchPerformancePatch({'CymPR-fm.js':original.replace('}),de=D;for(let Me=D;','}),de=D+1;for(let Me=D;')}),/version mismatch/);
});
