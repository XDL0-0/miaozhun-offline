import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyMuzzleLayerPerformancePatch} from '../patches/muzzle-layer-performance.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const original=fs.readFileSync(new URL('../site/js/CymPR-fm.js',import.meta.url),'utf8');
const patched=applyMuzzleLayerPerformancePatch({'CymPR-fm.js':original})['CymPR-fm.js'];

function section(source,begin,end,at=0){const start=source.indexOf(begin,at),stop=source.indexOf(end,start+begin.length);assert.ok(start>=0&&stop>start,begin);return source.slice(start,stop);}
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const particle=(options={})=>({loc:[0,0,-1],col:[1,.7,.3],alpha:.8,size:[.2,.2,.2],rot:0,sub:0,...options});
const emitter=(mat,parts=[particle()],options={})=>({tpl:{mat,sub:[1,1],pivot:[0,0],align:'Square',...options},parts});

function fixture(source,emitters,{overGun=false,capacity=6,warm=false}={}){
 const events=[],slots=[],camera={fov:90,aspect:1,near:.1,far:200,getEffectiveFOV:()=>90,projectionMatrix:{elements:[1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-.2,0]}};
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
  clear(...mask){events.push({clear:mask});},render(scene){events.push({render:scene.name,drawn:scene.children.filter(mesh=>mesh.visible&&mesh.geometry.count>0).map(mesh=>({count:mesh.geometry.count,order:mesh.renderOrder,material:mesh.material.key}))});}
 };
 const material=key=>({key,userData:{layer:key.startsWith('light')?'light':'flash',dyn:true}});
 const context={a:false,s:{enabled:true,viewModel:model,weapon:'vandal',time:1},w:[],n:{systems:[{emitters}],setDetail(){},update(){},fire(){assert.fail('No newly fired shots in render fixture');}},
  t:{guns:{vandal:{hip:[],ads:[],overGun}},meshes:{oversized:{i:Array(9).fill(0)}}},u:'vandal',r:model,l:0,Xv:.1,A:{gameTime:{value:0}},C:q,z:{value:0},o:15,
  p:{copy(){}},d:{copy(){}},c:1,ce:()=>()=>null,i:[],I:{},k:slots,
  L(){const slot={scene:null,attrs:[{},{},{}],dynAttr:{},mesh:{geometry:{count:0,setDrawRange(start,count){assert.equal(start,0);this.count=count;}},visible:false},sink:{pos:new Float32Array(capacity*3),uv:new Float32Array(capacity*2),col:new Float32Array(capacity*4),dyn:new Float32Array(capacity*4),capacity}};return slot;},
  _:material,P:()=>target,G:{},$: {},v:warm,H(){events.push({warm:true});},Pl(q,renderer){renderer.render(gun);},ue:0,de:0,
  Iv:[0,0,0,0],zv:.1,Cv:[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]],Ti:()=>identity(),
  y:{shifted(matrix,out){out.set(matrix);},toView(position,out){out.splice(0,3,...position);}},
  Xo(matrix,x,y,z,out){out[0]=x;out[1]=y;out[2]=z;return out;},
  Ru(matrix,x,y,z,out){out[0]=x;out[1]=y;out[2]=z;return out;},
  an(out){const length=Math.hypot(...out)||1;for(let index=0;index<3;index++)out[index]/=length;return out;},
  Fv(lock,l,u,r,c,p,d){p[0]=1;p[1]=p[2]=0;d[1]=1;d[0]=d[2]=0;},
 };
 const begin=source.indexOf('function qv(e){');
 const nativeLv=section(source,'function Lv(','function ',source.indexOf('const Iv='));
 const nativeBounds=section(source,'function B(S,K,F){','const Y=new po',begin);
 const nativeRender=section(source,'render(S,K){if(a||!s)return;','},setDetail(S){o=S}',begin)+'}';
 vm.runInNewContext(nativeLv+nativeBounds+';globalThis.render=({'+nativeRender+'}).render;',context);
 context.render(renderer,{getEffectiveFOV:()=>90,matrixWorld:identity(),matrixWorldInverse:identity()});
 assert.equal(renderer.autoClear,true);assert.equal(renderer.target,null);assert.equal(renderer.scissor,true);assert.equal(renderer.color,0x123456);assert.equal(renderer.alpha,.4);
 return {events,context,renderer,slots,passes:events.filter(value=>value.render).map(value=>value.render),draws:events.filter(value=>value.drawn?.length).flatMap(value=>value.drawn)};
}

test('a nonempty emitter can become end(0) after near clipping, so its empty light passes are skipped',()=>{
 const emitters=[emitter('light-near',[particle({loc:[0,0,-.05],camOff:.2})]),emitter('flash')];
 const before=fixture(original,emitters),after=fixture(patched,emitters);
 assert.deepEqual(before.passes,['gun','light','light-composite','flash','tone-composite']);
 assert.deepEqual(after.passes,['gun','flash','tone-composite']);
 assert.deepEqual(after.draws,before.draws);assert.equal(after.context.ue,1);assert.equal(after.context.de,2);
 assert.equal(after.slots[0].mesh.visible,false);assert.equal(after.slots[0].mesh.geometry.count,0);
});

test('capacity-rejected flash emitters skip only their empty flash and tone pass',()=>{
 const emitters=[emitter('light'),emitter('flash-too-large',[particle()],{mesh:{name:'oversized'}})];
 const before=fixture(original,emitters),after=fixture(patched,emitters);
 assert.deepEqual(before.passes,['gun','light','light-composite','flash','tone-composite']);
 assert.deepEqual(after.passes,['gun','light','light-composite']);assert.deepEqual(after.draws,before.draws);
 assert.equal(after.context.ue,1);assert.equal(after.context.de,2);
});

test('real light and flash geometry preserve native order, contents, state and all passes',()=>{
 const emitters=[emitter('flash-first'),emitter('light-second'),emitter('flash-third')];
 const before=fixture(original,emitters),after=fixture(patched,emitters);
 assert.deepEqual(after.events,before.events);assert.deepEqual(after.draws,before.draws);
 assert.deepEqual(after.slots.map(slot=>[...slot.sink.pos]),before.slots.map(slot=>[...slot.sink.pos]));
 assert.deepEqual(after.draws.map(value=>value.order),[2,1,3]);
});

test('later empty batches do not clear an earlier populated layer and warm-up remains native',()=>{
 const emitters=[emitter('light-visible'),emitter('light-clipped',[particle({loc:[0,0,-.05],camOff:.2})]),emitter('flash')];
 const before=fixture(original,emitters,{warm:true}),after=fixture(patched,emitters,{warm:true});
 assert.deepEqual(after.events,before.events);assert.equal(after.context.I.light,true);assert.equal(after.context.I.flash,true);
 const allEmpty=fixture(patched,[emitter('light',[]),emitter('flash-near',[particle({loc:[0,0,-.05],camOff:.2})])],{warm:true});
 assert.deepEqual(allEmpty.events,[{warm:true}]);assert.equal(allEmpty.context.ue,0);assert.equal(allEmpty.context.I.light,false);assert.equal(allEmpty.context.I.flash,false);
});

test('overGun flash-only behavior no longer depends on a clipped light emitter',()=>{
 const flashOnly=fixture(patched,[emitter('flash')],{overGun:true});
 const clippedLight=fixture(patched,[emitter('light-near',[particle({loc:[0,0,-.05],camOff:.2})]),emitter('flash')],{overGun:true});
 assert.deepEqual(clippedLight.passes,flashOnly.passes);assert.deepEqual(clippedLight.passes,['flash','tone-composite']);
});

test('patch is pinned, keeps source immutable, and emits a valid complete training module',()=>{
 const modules={'CymPR-fm.js':original,untouched:'value'},output=applyMuzzleLayerPerformancePatch(modules);
 assert.equal(modules['CymPR-fm.js'],original);assert.equal(output.untouched,'value');
 parse(patched,{ecmaVersion:'latest',sourceType:'module'});
 assert.throws(()=>applyMuzzleLayerPerformancePatch({}),/missing training/);
 assert.throws(()=>applyMuzzleLayerPerformancePatch(output),/already applied/);
 assert.throws(()=>applyMuzzleLayerPerformancePatch({'CymPR-fm.js':original.replace('function qv(e){','function changedEffect(e){')}),/version mismatch/);
 assert.throws(()=>applyMuzzleLayerPerformancePatch({'CymPR-fm.js':original.replace('B(Ie.sink,Me,ee),Me===0','B(Ie.sink,Me,ee),Me===1')}),/version mismatch/);
});
