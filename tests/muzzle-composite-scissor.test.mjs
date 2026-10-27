import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyMuzzleLayerPerformancePatch} from '../patches/muzzle-layer-performance.mjs';
import {applyMuzzleCompositeScissorPatch} from '../patches/muzzle-composite-scissor.mjs';

const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const retained=fs.readFileSync(new URL('../site/js/CymPR-fm.js',import.meta.url),'utf8');
const original=applyMuzzleLayerPerformancePatch({'CymPR-fm.js':retained})['CymPR-fm.js'];
const patched=applyMuzzleCompositeScissorPatch({'CymPR-fm.js':original})['CymPR-fm.js'];
const plain=value=>JSON.parse(JSON.stringify(value));
function section(source,start,end,at=0){const a=source.indexOf(start,at),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const triangle=(layer,x,y,size=.08,z=-1)=>({layer,positions:[x,y,z,x+size,y,z,x,y+size,z]});

function fixture(source,emitters,{width=192,height=108,dpr=1,overGun=false,target=null,warm=false,scissorTest=false,scissorRect=[0,0,width,height]}={}){
 const events=[],commands=[],slots=[],materials=new Map();let projectionReads=0;
 const projection=new Proxy([1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-.2,0],{get(array,key){if(/^\d+$/.test(String(key)))projectionReads++;return array[key];}});
 const camera={fov:90,aspect:width/height,near:.1,far:200,getEffectiveFOV:()=>90,projectionMatrix:{elements:projection}};
 const scene=name=>({name,children:[],add(mesh){this.children.push(mesh);},remove(mesh){this.children=this.children.filter(value=>value!==mesh);}});
 const light=scene('light'),flash=scene('flash'),gun=scene('gun');gun.overrideMaterial={name:'original-glass-material'};
 const q={lightScene:light,flashScene:flash,fxCam:camera,quadCam:{},maskMaterial:{name:'native-depth-stencil-mask'},lightPass:{scene:scene('light-composite'),mat:{uniforms:{tex:{value:null}}}},tonePass:{scene:scene('tone-composite'),mat:{uniforms:{tex:{value:null}}}}};
 class Vector{copy(){return this;}}
 class Target{constructor(w,h,options){Object.assign(this,{name:'fx',width:w,height:h,options,texture:{},scissorTest:false,scissor:{rect:[0,0,w,h],set(...rect){this.rect=rect;}}});}dispose(){}}
 const renderer={target,autoClear:true,scissorTest,scissor:[...scissorRect],color:0x123456,alpha:.4,extensions:{has:()=>true},
  initTexture(){assert.fail('Steady-state fixture has no upload');},
  getDrawingBufferSize(out){out.x=width;out.y=height;return out;},getPixelRatio:()=>dpr,
  getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;commands.push({target:value?.name??'main'});},getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=value;commands.push({scissorTest:value});},setScissor(...value){this.scissor=value;commands.push({scissor:[...value]});},
  getClearColor(out){out.value=this.color;return out;},getClearAlpha(){return this.alpha;},setClearColor(value,alpha){this.color=typeof value==='object'?value.value:value;this.alpha=alpha;},
  clear(...mask){commands.push({clear:mask});events.push({clear:mask,target:this.target?.name??'main',scissor:[...this.target.scissor.rect],scissorTest:this.target.scissorTest,color:this.color,alpha:this.alpha});},
  render(value){commands.push({render:value.name});const fx=this.target?.name==='fx';events.push({render:value.name,target:this.target?.name??'main',scissor:[...(fx?this.target.scissor.rect:this.scissor)],scissorTest:fx?this.target.scissorTest:this.scissorTest,override:value.overrideMaterial?.name??null,draws:value.children.filter(mesh=>mesh.visible&&mesh.geometry.drawRange.count>0).map(mesh=>({layer:mesh.material.key,count:mesh.geometry.drawRange.count,vertices:[...mesh.sink.pos.slice(0,mesh.geometry.drawRange.count*3)]}))});}
 };
 const material=key=>{if(!materials.has(key))materials.set(key,{key,userData:{layer:key,dyn:false}});return materials.get(key);};
 const context={a:false,s:{enabled:true,viewModel:{fxLayer:()=>({scene:gun,camera})},weapon:'vandal',time:1},w:[],n:{systems:emitters,setDetail(){},update(){},clear(){}},t:{guns:{vandal:{hip:[],ads:[],overGun}}},u:'vandal',r:null,l:null,c:1,p:new Vector,d:new Vector,Xv:.1,A:{gameTime:{value:0}},C:q,z:{value:0},o:15,i:[],I:undefined,k:slots,ws:3072,
  L(){const sink={pos:new Float32Array(3072*3)},mesh={sink,geometry:{drawRange:{count:0},setDrawRange(start,count){this.drawRange.count=count;}},visible:false};return{sink,mesh,attrs:[{}],dynAttr:{},scene:null};},
  _:material,y:{},ce:()=>()=>null,ue:0,de:0,v:warm,H(q,s,rt){events.push({warm:true,scissor:[0,0,1,1]});},ie(){},$: {},
  Lv(systems,manifest,transform,callbacks){for(const emitter of systems){const sink=callbacks.begin(null,{tpl:{mat:emitter.layer}});sink.pos.set(emitter.positions);callbacks.end(emitter.positions.length/3);}return systems.length;},
  Un:Vector,Uc:Target,Kv:1920,Hc:'half',li:'byte',Rs:'linear',ai:'linear-srgb',
 };
 delete context.I;
 const at=source.indexOf('function qv(e){');
 const helpers=section(source,'let R=null;const G=new Un;function P(S){','const Y=new po',at);
 const render=section(source,'render(S,K){if(a||!s', '},setDetail(S){',at)+'}';
 const mask=section(source,'function Pl(e,t,n,o){','function qv(e){');
 vm.runInNewContext(helpers+mask+';globalThis.render=({'+render+'}).render;',context);
 function run(nextEmitters=emitters){events.length=0;commands.length=0;context.n.systems=nextEmitters;context.render(renderer,{getEffectiveFOV:()=>90,matrixWorld:{},matrixWorldInverse:{}});assert.equal(renderer.target,target);assert.equal(renderer.autoClear,true);assert.equal(renderer.color,0x123456);assert.equal(renderer.alpha,.4);return plain(events);}
 const result=run();return{events:result,run,projectionReads,renderer,get commands(){return plain(commands);}};
}
const composites=events=>events.filter(event=>event.render?.endsWith('-composite'));
const exceptCompositeRect=events=>events.map(event=>event.render?.endsWith('-composite')?{...event,scissor:'layer-specific'}:event);

test('actual qv keeps union clears, glass mask and particle draws identical while only composite rectangles shrink',()=>{
 const emitters=[triangle('light',-.75,-.3,.25),triangle('flash',.35,.2,.12)];
 for(const options of [{},{width:3840,height:2160,dpr:2},{overGun:true}]){
  const before=fixture(original,emitters,options),after=fixture(patched,emitters,options);
  assert.deepEqual(exceptCompositeRect(after.events),exceptCompositeRect(before.events));
  const a=composites(before.events),b=composites(after.events);
  assert.equal(a.length,2);assert.notDeepEqual(b[0].scissor,b[1].scissor);
  for(let index=0;index<2;index++)assert.ok(b[index].scissor[2]*b[index].scissor[3]<a[index].scissor[2]*a[index].scissor[3]);
  assert.equal(after.projectionReads,before.projectionReads,'every emitted vertex is projected exactly once');
  assert.equal(after.events.find(event=>event.render==='gun').override,'native-depth-stencil-mask');
 }
});

test('single layer, empty layer, near-camera fallback and external float targets retain the original full union path',()=>{
 const cases=[{emitters:[triangle('flash',.2,.2)]},{emitters:[triangle('light',-.2,-.2)]},
  {emitters:[{layer:'light',positions:[]},triangle('flash',.2,.2)]},
  {emitters:[triangle('light',-.7,-.2),triangle('flash',.3,.2,.1,1)]},
  {emitters:[triangle('light',-.7,-.2),triangle('flash',.3,.2)],options:{target:{name:'float-target'}}},
  {emitters:[]}];
 for(const {emitters,options}of cases)assert.deepEqual(fixture(patched,emitters,options).events,fixture(original,emitters,options).events);
 // Even the unpatched native begin() can mark an empty layer participating.
 const empty=[{layer:'light',positions:[]},triangle('flash',.2,.2)];
 assert.deepEqual(fixture(applyMuzzleCompositeScissorPatch({'CymPR-fm.js':retained})['CymPR-fm.js'],empty).events,fixture(retained,empty).events);
});

test('bounds reset between frames and pooled output rectangles never retain an old flash region',()=>{
 const first=[triangle('light',-.8,-.4,.2),triangle('flash',.2,.2,.1)],next=[triangle('flash',-.2,-.1,.2),triangle('light',.6,.1,.1)];
 const before=fixture(original,first),after=fixture(patched,first),a=before.run(next),b=after.run(next);
 assert.deepEqual(exceptCompositeRect(b),exceptCompositeRect(a));
 const own=composites(b);assert.ok(own[0].scissor[0]>own[1].scissor[0]);
});

test('an already-scissored main-output caller preserves native union draws and the rectangle left by finally',()=>{
 const emitters=[triangle('light',-.75,-.3,.25),triangle('flash',.35,.2,.12)],scissorRect=[3,4,5,6];
 for(const dpr of [1,2]){
  const options={scissorTest:true,scissorRect,dpr},before=fixture(original,emitters,options),after=fixture(patched,emitters,options);
  assert.deepEqual(after.events,before.events,'tt=true must leave both composites on the original union rectangle');
  assert.deepEqual(after.commands,before.commands,'fallback paths introduce no extra renderer commands');
  assert.equal(after.renderer.scissorTest,true);assert.equal(before.renderer.scissorTest,true);
  assert.deepEqual(after.renderer.scissor,before.renderer.scissor);
  assert.notDeepEqual(after.renderer.scissor,scissorRect,'native finally leaves the union rectangle rather than restoring the input rectangle');
  assert.deepEqual(after.renderer.scissor,composites(before.events).at(-1).scissor);
 }
});

test('trimmed composite commands end by restoring the native union rectangle even with scissorTest=false',()=>{
 const emitters=[triangle('light',-.75,-.3,.25),triangle('flash',.35,.2,.12)],scissorRect=[3,4,5,6];
 for(const dpr of [1,2]){
  const options={scissorTest:false,scissorRect,dpr},before=fixture(original,emitters,options),after=fixture(patched,emitters,options);
  const union=composites(before.events).at(-1).scissor,commands=after.commands,restoreIndex=commands.findLastIndex(command=>command.scissor);
  assert.deepEqual(after.renderer.scissor,before.renderer.scissor);assert.deepEqual(after.renderer.scissor,union);
  assert.notDeepEqual(after.renderer.scissor,scissorRect,'restore native output state rather than changing its input-rectangle semantics');
  assert.equal(after.renderer.scissorTest,false);
  assert.deepEqual(commands.slice(restoreIndex-1),[{target:'main'},{scissor:union},{scissorTest:false}]);
  const expected=before.commands.map(command=>command.scissor?{scissor:'per-layer'}:command);
  const actual=commands.filter((_,index)=>index!==restoreIndex).map(command=>command.scissor?{scissor:'per-layer'}:command);
  assert.deepEqual(actual,expected,'only the two composite rectangles and one final union restoration differ from native commands');
 }
});

const mix=(a,b,t)=>a+(b-a)*t,clamp=x=>Math.max(0,Math.min(1,x));
function neutralFlash(mode){
 if(mode===0)return [0,0,0];
 // Actual pinned ueFilmic(0): pre-tone AP0/AP1 are all zero (saturation glow
 // and red correction vanish). Preserve the shader's logarithmic floor/toe.
 const FS=.88,TS=.45,SS=.78,TM=-.3902772,SM=.9016409,HM=-.6061863,WC=.04;
 const L=Math.log2(1e-10)*.30103,st=FS*(L+SM),toe=L<TM?2*TS/(1+Math.exp((-2*FS/TS)*(L-TM))):st,sh=L>HM?(1+WC)-2*SS/(1+Math.exp((2*FS/SS)*(L-HM))):st;
 let t=1-clamp((L-TM)/(HM-TM));t=(3-2*t)*t*t;
 const tone=Math.max(0,mix(toe,sh,t)),dot=(row,v)=>row.reduce((sum,x,index)=>sum+x*v[index],0);
 const v=[tone,tone,tone],transformed=[[1.0653749,.0000014,-.0653710],[-.0000003,1.2036635,-.2036677],[0,0,.9999996]].map(row=>dot(row,v));
 const ap1=v.map((x,index)=>mix(x,transformed[index],.6));
 return [[1.7050515,-.6217907,-.0832584],[-.1302571,1.1408029,-.0105485],[-.0240033,-.1289688,1.1529717]].map(row=>Math.max(0,dot(row,ap1))*12.92);
}
const rgba8=value=>Math.round(clamp(value)*255);
test('pinned native composite shaders are identity outside their layer after actual RGBA8 output quantization',()=>{
 assert.ok(retained.includes('vec3 ratio = max(texture2D(tex, vUv).rgb, vec3(1.0));'));
 assert.ok(retained.includes('gl_FragColor = vec4(toSRGB(tonemapX(c.rgb * exposure, tmMode)), clamp(c.a, 0.0, 1.0));'));
 const light=[1,1,1].map(value=>Math.pow(Math.max(value,1),1/2.2)-1);
 assert.deepEqual(light,[0,0,0]);
 assert.ok(neutralFlash(1).every(value=>value>0&&value<1e-12),'UE black toe is tiny but must not be falsely called exact float zero');
 for(const mode of [0,1])for(let dst=0;dst<=255;dst++)for(const channel of neutralFlash(mode)){
  assert.equal(rgba8(dst/255*(1+light[0])),dst,'Cu: source*destination + destination');
  assert.equal(rgba8(channel+dst/255*(1-0)),dst,'zu: premultiplied source + destination*(1-alpha)');
 }
});

test('software pixel comparison keeps the native pass order and all RGBA8 pixels across disjoint layer bounds',()=>{
 const emitters=[triangle('light',-.7,-.2,.2),triangle('flash',.35,.2,.12)],options={width:96,height:64};
 const before=fixture(original,emitters,options).events,after=fixture(patched,emitters,options).events;
 const bounds=composites(after).map(event=>event.scissor),inside=(rect,x,y)=>x>=rect[0]&&x<rect[0]+rect[2]&&y>=rect[1]&&y<rect[1]+rect[3];
 function paint(events,mode){const pixels=[];for(let y=0;y<64;y++)for(let x=0;x<96;x++){
  let dst=[(x*3+y)%256,(x+y*5)%256,(x*7+y*3)%256];
  for(const event of composites(events))if(inside(event.scissor,x,y)){
   const light=event.render==='light-composite',active=inside(bounds[light?0:1],x,y),src=light?(active?[.25,.1,0]:[0,0,0]):active?[.4,.2,.1]:neutralFlash(mode),alpha=light?1:active?.6:0;
   dst=dst.map((value,index)=>rgba8(light?src[index]*value/255+value/255:src[index]+value/255*(1-alpha)));
  }
  pixels.push(...dst);
 }return pixels;}
 for(const mode of [0,1])assert.deepEqual(paint(after,mode),paint(before,mode));
});

test('the optional source patch composes, parses, preserves unrelated modules and rejects changed shader or native anchors',()=>{
 const input={'CymPR-fm.js':original,other:'same'},output=applyMuzzleCompositeScissorPatch(input);
 assert.equal(input['CymPR-fm.js'],original);assert.equal(output.other,'same');
 parse(output['CymPR-fm.js'],{ecmaVersion:'latest',sourceType:'module'});
 assert.throws(()=>applyMuzzleCompositeScissorPatch({}),/missing training/);
 assert.throws(()=>applyMuzzleCompositeScissorPatch(output),/already applied/);
 assert.throws(()=>applyMuzzleCompositeScissorPatch({'CymPR-fm.js':original.replace('vec3 ratio = max(texture2D(tex, vUv).rgb, vec3(1.0));','vec3 ratio = texture2D(tex, vUv).rgb;')}),/neutral composite shader/);
 assert.throws(()=>applyMuzzleCompositeScissorPatch({'CymPR-fm.js':original.replace('B(Ie.sink,Me,ee),','B(Ie.sink,Me+1,ee),')}),/version mismatch/);
});
