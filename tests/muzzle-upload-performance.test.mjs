import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyMuzzleLayerPerformancePatch} from '../patches/muzzle-layer-performance.mjs';
import {applyMuzzleBatchPerformancePatch} from '../patches/muzzle-batch-performance.mjs';
import {applyMuzzleUploadPerformancePatch} from '../patches/muzzle-upload-performance.mjs';
import {applyPrewarmPatch} from '../patches/prewarm.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const retained=fs.readFileSync(new URL('../site/js/CymPR-fm.js',import.meta.url),'utf8');
const original=applyMuzzleLayerPerformancePatch({'CymPR-fm.js':retained})['CymPR-fm.js'];
const patched=applyMuzzleUploadPerformancePatch({'CymPR-fm.js':original})['CymPR-fm.js'];
const three=fs.readFileSync(new URL('../site/js/aQOfOAp-.js',import.meta.url),'utf8');
function section(source,begin,end,at=0){const start=source.indexOf(begin,at),stop=source.indexOf(end,start+begin.length);assert.ok(start>=0&&stop>start,begin);return source.slice(start,stop);}
// Execute the retained Three implementations, including their real version,
// range-merging, initial-buffer and bufferSubData behavior. Only the GL driver
// and the unused event dispatcher base are mocked.
const {BufferAttribute,WebGLAttributes}=vm.runInThisContext(`(()=>{class Vi{};let GE=0;const mh=35044,Gt=5124;
 ${section(three,'class Mt extends Vi{','class ',three.indexOf('let GE=0;'))}
 ${section(three,'function Wb(n){','var qb=')}
 return {BufferAttribute:Mt,WebGLAttributes:Wb};})()`);

function mockDriver(){
 const calls=[],buffers=new Map();let bound=null,id=0;
 const gl={ARRAY_BUFFER:34962,FLOAT:5126,
  createBuffer(){return ++id;},bindBuffer(target,buffer){assert.equal(target,this.ARRAY_BUFFER);bound=buffer;},
  bufferData(target,array,usage){buffers.set(bound,new Float32Array(array));calls.push({kind:'data',buffer:bound,bytes:array.byteLength,usage});},
  bufferSubData(target,byteOffset,array,start=0,count=array.length-start){
   assert.equal(target,this.ARRAY_BUFFER);assert.equal(byteOffset%array.BYTES_PER_ELEMENT,0);
   assert.ok(start>=0&&count>0&&start+count<=array.length,'no empty or out-of-bounds GPU updates');
   buffers.get(bound).set(array.subarray(start,start+count),byteOffset/array.BYTES_PER_ELEMENT);
   calls.push({kind:'sub',buffer:bound,byteOffset,start,count,bytes:count*array.BYTES_PER_ELEMENT});
  },deleteBuffer(buffer){buffers.delete(buffer);}
 };
 const attributes=WebGLAttributes(gl);
 return {calls,gl,attributes,read(attribute){return buffers.get(attributes.get(attribute).buffer);}};
}
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const particle=(options={})=>({loc:[0,0,-1],col:[1,.7,.3],alpha:.8,size:[.2,.2,.2],rot:0,sub:0,...options});
const emitter=(mat,parts=[particle()],options={})=>({tpl:{mat,sub:[1,1],pivot:[0,0],align:'Square',...options},parts});

function fixture(source,emitters,{capacity=3072,dynamics={},meshes={}}={}){
 const driver=mockDriver(),events=[],slots=[],materials=new Map();
 const camera={fov:90,aspect:1,near:.1,far:200,getEffectiveFOV:()=>90,projectionMatrix:{elements:[1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-.2,0]}};
 const scene=name=>({name,children:[],add(mesh){this.children.push(mesh);},remove(mesh){this.children=this.children.filter(value=>value!==mesh);}});
 const q={lightScene:scene('light'),flashScene:scene('flash'),quadCam:{},fxCam:camera,
  lightPass:{scene:scene('light-composite'),mat:{uniforms:{tex:{value:null}}}},tonePass:{scene:scene('tone-composite'),mat:{uniforms:{tex:{value:null}}}}};
 const gun=scene('gun'),model={fxLayer:()=>({scene:gun,camera})},target={width:1920,height:1080,texture:{},scissor:{set(){}},scissorTest:false};
 const renderer={autoClear:true,target:null,scissor:true,color:0x123456,alpha:.4,
  initTexture(){assert.fail('No steady-state texture creation');},
  getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;},
  getScissorTest(){return this.scissor;},setScissorTest(value){this.scissor=value;},setScissor(){},
  getClearColor(out){out.value=this.color;return out;},getClearAlpha(){return this.alpha;},
  setClearColor(value,alpha){this.color=typeof value==='object'?value.value:value;this.alpha=alpha;},
  getDrawingBufferSize(out){out.x=1920;out.y=1080;return out;},getPixelRatio:()=>1,
  clear(...mask){events.push({clear:mask});},render(scene){
   const batches=scene.children.filter(mesh=>mesh.visible&&mesh.geometry.drawRange.count>0).sort((a,b)=>a.renderOrder-b.renderOrder);
   const triangles=[];
   for(const mesh of batches){const count=mesh.geometry.drawRange.count,attrs=mesh.geometry.attributes;
    // WebGLGeometries updates every attribute, even attributes unused by the
    // current material. Read rendered vertices back from the simulated GPU.
    for(const attribute of Object.values(attrs))driver.attributes.update(attribute,driver.gl.ARRAY_BUFFER);
    for(let at=0;at<count;at+=3)triangles.push({material:mesh.material.key,vertices:Array.from({length:3},(_,vertex)=>{
     const index=at+vertex,values=[];
     for(const [name,attribute] of Object.entries(attrs)){
      if(name==='dyn4'&&!mesh.material.userData.dyn)continue;
      const gpu=driver.read(attribute),start=index*attribute.itemSize;
      assert.deepEqual([...gpu.slice(start,start+attribute.itemSize)],[...attribute.array.slice(start,start+attribute.itemSize)],'drawn GPU '+name+' equals latest CPU emission');
      values.push(...gpu.slice(start,start+attribute.itemSize));
     }
     return values;
    })});
   }
   events.push({render:scene.name,draws:batches.length,triangles});
  }
 };
 const material=key=>{if(!materials.has(key))materials.set(key,{key,forceSinglePass:true,userData:{layer:key.startsWith('light')?'light':'flash',dyn:dynamics[key]??true}});return materials.get(key);};
 class Geometry{
  constructor(){this.attributes={};this.index=null;this.groups=[];this.drawRange={start:0,count:0};}
  setAttribute(name,attr){this.attributes[name]=attr;}
  setDrawRange(start,count){this.drawRange={start,count};}
 }
 const context={a:false,__aimPreparing:0,s:{enabled:true,viewModel:model,weapon:'vandal',time:1},w:[],n:{systems:[{emitters}],setDetail(){},update(){},clear(){},fire(){assert.fail('No simulation shots');}},
  t:{guns:{vandal:{hip:[],ads:[]}},meshes},u:'vandal',r:model,l:0,Xv:.1,A:{gameTime:{value:0}},C:q,z:{value:0},o:15,
  p:{copy(){}},d:{copy(){}},c:1,ce:()=>()=>null,i:[],I:{},k:slots,ws:capacity,
  Ps:Geometry,Ct:BufferAttribute,Float32Array,Bd:35048,yt:class{constructor(geometry,material){this.geometry=geometry;this.material=material;}},
  _:material,P:()=>target,G:{},$: {},v:false,H(){},Pl(q,renderer){renderer.render(gun);},ue:0,de:0,
  Iv:[0,0,0,0],zv:.1,Cv:[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]],Ti:()=>identity(),
  y:{shifted(matrix,out){out.set(matrix);},toView(position,out){out.splice(0,3,...position);}},
  an(out){const length=Math.hypot(...out)||1;for(let index=0;index<3;index++)out[index]/=length;return out;},
  Si:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  Fv(lock,l,u,r,c,p,d){p[0]=1;p[1]=p[2]=0;d[1]=1;d[0]=d[2]=0;}
 };
 const begin=source.indexOf('function qv(e){');
 const prefixStart=Math.min(...['const __aimMuzzleUploadRanges=','const __aimCoalesceMuzzleBatches='].map(marker=>source.indexOf(marker)).filter(index=>index>=0),begin);
 const helpers=source.slice(prefixStart,begin);
 const nativeFactory=section(source,'function L(){const S=new Ps','let R=null;',begin);
 const nativeLv=section(source,'function Lv(','function ',source.indexOf('const Iv='));
 const nativeBounds=section(source,'function B(S,K,F){','const Y=new po',begin);
 const nativeRender=section(source,'render(S,K){','},setDetail(S){o=S}',begin)+'}';
 vm.runInNewContext(helpers+nativeFactory+section(source,'function Ru(','const Ti=')+section(source,'function Pv(','const Ll=')+nativeLv+nativeBounds+';globalThis.render=({'+nativeRender+'}).render;',context);
 function render(){context.render(renderer,{getEffectiveFOV:()=>90,matrixWorld:identity(),matrixWorldInverse:identity()});
  assert.equal(renderer.autoClear,true);assert.equal(renderer.target,null);assert.equal(renderer.scissor,true);assert.equal(renderer.color,0x123456);assert.equal(renderer.alpha,.4);}
 render();
 return {driver,events,context,renderer,slots,render,clear(){events.length=0;driver.calls.length=0;}};
}
const visualEvents=events=>events.map(({draws,...event})=>event);
const bytes=f=>f.driver.calls.reduce((sum,call)=>sum+call.bytes,0);
const attrList=slot=>[...slot.attrs,slot.dynAttr];
const replaceParts=(f,parts)=>{f.context.n.systems[0].emitters[0].parts=parts;};
function trackFloatAllocations(f){
 const lengths=[];
 f.context.Float32Array=new Proxy(Float32Array,{construct(target,args){lengths.push(args[0]);return Reflect.construct(target,args);}});
 return lengths;
}

test('empty native systems return zero without callbacks or scratch typed arrays, preserving the entire nonempty generator body',()=>{
 const native=section(original,'function Lv(','function ',original.indexOf('const Iv='));
 const optimized=section(patched,'function Lv(','function ',patched.indexOf('const Iv='));
 assert.equal(optimized,native.replace('function Lv(e,t,n,o){','function Lv(e,t,n,o){if(e.length===0)return 0;'));
 for(const [source,expected]of [[original,[16]],[patched,[]]]){
  const f=fixture(source,[]),allocations=trackFloatAllocations(f),callbacks=[];
  const count=f.context.Lv([],null,null,{begin(){callbacks.push('begin');},end(value){callbacks.push(['end',value]);}});
  assert.equal(count,0);assert.deepEqual(callbacks,[]);assert.deepEqual(allocations,expected);
 }
});

test('empty-system render still updates simulation, hides previous batches and executes native tail cleanup',()=>{
 const make=()=>[emitter('light'),emitter('flash')];
 const before=fixture(original,make()),after=fixture(patched,make());
 for(const [f,expected]of [[before,[16]],[after,[]]]){
  assert.ok(f.slots.every(slot=>slot.mesh.visible));
  const versions=f.slots.map(slot=>attrList(slot).map(attr=>attr.version));
  f.clear();const allocations=trackFloatAllocations(f);
  f.context.n.systems=[];f.context.s.time=2;
  f.context.n.setDetail=value=>f.events.push({detail:value});
  f.context.n.update=value=>f.events.push({update:value});
  f.context.v=true;f.context.H=()=>f.events.push({warmup:'tail'});
  f.render();
  assert.deepEqual(allocations,expected);assert.equal(bytes(f),0);
  assert.equal(f.context.l,2);assert.equal(f.context.ue,0);assert.equal(f.context.de,0);
  assert.equal(f.context.I.light,false);assert.equal(f.context.I.flash,false);assert.equal(f.context.v,false);
  assert.deepEqual(f.slots.map(slot=>attrList(slot).map(attr=>attr.version)),versions);
  for(const slot of f.slots){assert.equal(slot.mesh.visible,false);assert.equal(slot.mesh.geometry.drawRange.count,0);}
 }
 assert.deepEqual(after.events,before.events);
 assert.deepEqual(after.events,[{detail:15},{update:.1},{warmup:'tail'}]);
});

test('retained Three GL code uploads 312 steady-state bytes per dynamic quad instead of 159744, with identical rendered vertices',()=>{
 const make=()=>[emitter('flash',[particle({dyn:[.1,.2,.3,.4]})])];
 const before=fixture(original,make()),after=fixture(patched,make());
 assert.deepEqual(after.events,before.events);
 assert.equal(bytes(after),3072*13*4,'first bufferData retains full capacity allocation');
 assert.ok(after.driver.calls.every(call=>call.kind==='data'));
 before.clear();after.clear();
 const parts=[particle({loc:[.2,.3,-1.3],rot:.2,dyn:[.8,.7,.6,.5]})];
 replaceParts(before,parts);replaceParts(after,parts);before.render();after.render();
 assert.deepEqual(after.events,before.events);
 assert.equal(bytes(before),3072*13*4);assert.equal(bytes(after),6*13*4);
 assert.deepEqual(after.driver.calls.map(({byteOffset,start,count,bytes})=>({byteOffset,start,count,bytes})),[
  {byteOffset:0,start:0,count:18,bytes:72},{byteOffset:0,start:0,count:12,bytes:48},
  {byteOffset:0,start:0,count:24,bytes:96},{byteOffset:0,start:0,count:24,bytes:96}
 ]);
 assert.ok(attrList(after.slots[0]).every(attr=>attr.updateRanges.length===0),'actual Three consumer clears ranges after upload');
});

test('empty and capacity-rejected emissions never dirty buffers, then later growth uploads current vertices',()=>{
 const clipped=()=>particle({loc:[0,0,-.05],camOff:.2});
 const f=fixture(patched,[emitter('light',[clipped()])],{capacity:12});
 assert.equal(f.slots.length,1);assert.equal(bytes(f),0);assert.ok(attrList(f.slots[0]).every(attr=>attr.version===0));
 assert.equal(f.slots[0].mesh.visible,false);
 replaceParts(f,[particle()]);f.render();f.clear();
 const versions=attrList(f.slots[0]).map(attr=>attr.version);
 replaceParts(f,[clipped()]);f.render();
 assert.equal(bytes(f),0);assert.deepEqual(attrList(f.slots[0]).map(attr=>attr.version),versions);
 replaceParts(f,[particle({loc:[.1,0,-1]}),particle({loc:[-.1,0,-1]})]);f.render();
 assert.equal(bytes(f),12*13*4);assert.equal(f.slots[0].mesh.geometry.drawRange.count,12);
 const tooLarge=fixture(patched,[emitter('flash',[particle()],{mesh:{name:'huge'}})],{capacity:6,meshes:{huge:{i:Array(9).fill(0)}}});
 assert.equal(bytes(tooLarge),0);assert.ok(attrList(tooLarge.slots[0]).every(attr=>attr.version===0));
});

test('shrinking, growing, full capacity and over-capacity frames preserve all rendered GPU channels',()=>{
 const before=fixture(original,[emitter('flash')],{capacity:18}),after=fixture(patched,[emitter('flash')],{capacity:18});
 for(const [frame,count]of [3,1,2,4,0,3,1].entries()){
  before.clear();after.clear();
  const parts=Array.from({length:count},(_,index)=>particle({loc:[index*.05,frame*.01,-1],dyn:[frame,index,.3,.9]}));
  replaceParts(before,parts);replaceParts(after,parts);before.render();after.render();
  assert.deepEqual(after.events,before.events);
  assert.equal(bytes(after),Math.min(count,3)*6*13*4);
 }
 assert.equal(after.slots.length,1,'same buffer pool is reused');
});

test('offscreen skipped renders replace pending ranges with the latest prefix rather than accumulating or losing vertices',()=>{
 const f=fixture(patched,[emitter('flash')],{capacity:24});
 f.clear();
 for(const count of [3,1,4]){
  replaceParts(f,Array.from({length:count},(_,index)=>particle({loc:[100+index,0,-1],dyn:[count,index,0,1]})));
  f.render();assert.equal(bytes(f),0,'screen bounds reject actual draw');
  for(const attr of attrList(f.slots[0]))assert.deepEqual(Array.from(attr.updateRanges,range=>({...range})),[{start:0,count:count*6*attr.itemSize}]);
 }
 const versions=attrList(f.slots[0]).map(attr=>attr.version);
 replaceParts(f,[particle({loc:[0,0,-.05],camOff:.2})]);f.render();
 assert.equal(bytes(f),0);assert.deepEqual(attrList(f.slots[0]).map(attr=>attr.version),versions);
 assert.ok(attrList(f.slots[0]).every(attr=>attr.updateRanges.length===1),'empty frame leaves pending dirty range intact');
 replaceParts(f,[particle({loc:[.1,.1,-1],dyn:[9,8,7,6]}),particle({loc:[-.1,0,-1],dyn:[5,4,3,2]})]);f.render();
 assert.equal(bytes(f),12*13*4);assert.ok(attrList(f.slots[0]).every(attr=>attr.updateRanges.length===0));
});

test('dynamic channels keep native opt-in updates across material changes and pending skipped frames',()=>{
 const f=fixture(patched,[emitter('static')],{capacity:18,dynamics:{static:false,dynamic:true}}),slot=f.slots[0],em=f.context.n.systems[0].emitters[0];
 const initialDynVersion=slot.dynAttr.version;
 f.clear();replaceParts(f,[particle({dyn:[1,2,3,4]})]);f.render();
 assert.equal(bytes(f),6*9*4);assert.equal(slot.dynAttr.version,initialDynVersion);
 f.clear();em.tpl.mat='dynamic';replaceParts(f,[particle({loc:[100,0,-1],dyn:[5,6,7,8]})]);f.render();
 assert.equal(bytes(f),0);const pendingVersion=slot.dynAttr.version;assert.ok(pendingVersion>initialDynVersion);
 em.tpl.mat='static';replaceParts(f,[particle(),particle()]);f.render();
 assert.equal(slot.dynAttr.version,pendingVersion,'non-dynamic material never requests another dyn update');
 f.clear();em.tpl.mat='dynamic';replaceParts(f,[particle({dyn:[8,7,6,5]}),particle({loc:[.1,0,-1],dyn:[4,3,2,1]}),particle({loc:[-.1,0,-1],dyn:[.1,.2,.3,.4]})]);f.render();
 assert.equal(bytes(f),18*13*4);assert.ok(slot.dynAttr.version>pendingVersion);
});

test('mesh particles upload their actual triangle count with static and dynamic material behavior preserved',()=>{
 const meshes={triangle:{i:[0,1,2],v:[0,0,0,.1,0,0,0,.2,0],uv:[0,0,1,0,0,1]}};
 const make=()=>[emitter('light',[particle({dyn:[.1,.2,.3,.4]})],{mesh:{name:'triangle'}}),emitter('flash',[particle()],{mesh:{name:'triangle'}})];
 const options={meshes,dynamics:{light:true,flash:false}};
 const before=fixture(original,make(),options),after=fixture(patched,make(),options);
 before.clear();after.clear();before.render();after.render();
 assert.deepEqual(after.events,before.events);assert.equal(bytes(after),3*(13+9)*4);
});

test('optional coalescing expands upload ranges over appended vertices in either patch order',()=>{
 const orders=[sources=>applyMuzzleBatchPerformancePatch(applyMuzzleUploadPerformancePatch(sources)),sources=>applyMuzzleUploadPerformancePatch(applyMuzzleBatchPerformancePatch(sources))];
 for(const compose of orders){
  const source=compose({'CymPR-fm.js':original})['CymPR-fm.js'];
  parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const make=()=>[emitter('flash',[particle({dyn:[1,2,3,4]})]),emitter('flash',[particle({loc:[.1,0,-1],dyn:[5,6,7,8]})]),emitter('flash',[particle({loc:[-.1,0,-1],dyn:[9,10,11,12]})])];
  const before=fixture(original,make(),{capacity:18}),after=fixture(source,make(),{capacity:18});
  assert.deepEqual(visualEvents(after.events),visualEvents(before.events));
  before.clear();after.clear();before.render();after.render();
  assert.deepEqual(visualEvents(after.events),visualEvents(before.events));assert.equal(bytes(after),18*13*4);
  assert.equal(after.slots[0].mesh.geometry.drawRange.count,18);
  assert.deepEqual(after.driver.calls.map(call=>call.count),[54,36,72,72],'merged range covers all three native batches');
  // Give a previously hidden merged slot its own material. Its first GPU
  // allocation and later partial updates must be correct on pool reuse.
  for(const f of [before,after]){f.clear();f.context.n.systems[0].emitters[1].tpl.mat='other';f.render();}
  assert.deepEqual(visualEvents(after.events),visualEvents(before.events));
 }
});

test('pinned transform composes with layer optimization in either order, preserves source and rejects repeated or changed shapes',()=>{
 const modules={'CymPR-fm.js':original,untouched:'value'},output=applyMuzzleUploadPerformancePatch(modules);
 assert.equal(modules['CymPR-fm.js'],original);assert.equal(output.untouched,'value');
 parse(output['CymPR-fm.js'],{ecmaVersion:'latest',sourceType:'module'});
 assert.equal(applyMuzzleLayerPerformancePatch(applyMuzzleUploadPerformancePatch({'CymPR-fm.js':retained}))['CymPR-fm.js'],patched);
 assert.throws(()=>applyMuzzleUploadPerformancePatch({}),/missing training/);
 assert.throws(()=>applyMuzzleUploadPerformancePatch(output),/already applied/);
 for(const [before,after]of [
  ['function qv(e){','function changed(e){'],
  ['function Lv(e,t,n,o){','function Lv(e,t,n,changed){'],
  ['function Lv(e,t,n,o){','function Lv(e,t,n,o){if(e.length===0)return 0;'],
  ['const s=new Float32Array(16),i=[0,0,0]','const s=new Float32Array(32),i=[0,0,0]'],
  ['q.frustumCulled=!1,q.matrixAutoUpdate=!1','q.frustumCulled=!0,q.matrixAutoUpdate=!1'],
  ['for(const We of Ie.attrs)We.needsUpdate=!0;','for(const We of Ie.attrs)We.needsUpdate=!1;'],
 ])assert.throws(()=>applyMuzzleUploadPerformancePatch({'CymPR-fm.js':original.replace(before,after)}),/version mismatch/);
 const nativeGenerator=section(original,'function Lv(','function ',original.indexOf('const Iv='));
 assert.throws(()=>applyMuzzleUploadPerformancePatch({'CymPR-fm.js':original+nativeGenerator}),/version mismatch: native particle generator/);
});

test('prewarm preparation guard and actual emitted draw uploads compose in either transform order',()=>{
 const sources={'CymPR-fm.js':original,'aQOfOAp-.js':three,'tmIeW3Ig.js':fs.readFileSync(new URL('../site/js/tmIeW3Ig.js',import.meta.url),'utf8')};
 const orders=[value=>applyPrewarmPatch(applyMuzzleUploadPerformancePatch(value)),value=>applyMuzzleUploadPerformancePatch(applyPrewarmPatch(value))];
 for(const compose of orders){
  const source=compose(sources)['CymPR-fm.js'];
  parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const f=fixture(source,[emitter('flash')]);f.clear();
  f.context.__aimPreparing=1;f.render();assert.equal(bytes(f),0);assert.equal(f.events.length,0);
  f.context.__aimPreparing=0;f.render();assert.equal(bytes(f),6*13*4);
 }
});
