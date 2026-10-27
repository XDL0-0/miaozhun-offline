import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyImpactTracerPoolingPatch} from '../patches/impact-tracer-pooling.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const original=fs.readFileSync(new URL('../site/js/CymPR-fm.js',import.meta.url),'utf8');
const patched=applyImpactTracerPoolingPatch({'CymPR-fm.js':original})['CymPR-fm.js'];
function between(source,begin,end){const at=source.indexOf(begin),stop=source.indexOf(end,at+begin.length);assert.ok(at>=0&&stop>at,begin);return source.slice(at,stop);}

function fixture(source,kind,{load=true}={}){
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
 const context=vm.createContext({Pe:Vector,Ps:Geometry,gr:Attribute,yt:Mesh,Vn:Material,Fi:Texture,ts:Geometry,
  ya:'srgb',As:2,$n:2,Oc:103,he:1/128,bd:()=>context.effectsEnabled,
  wn:()=>({muzzle:{x:.15,y:-.1,z:-1}}),kd:(h,aspect)=>Math.atan(Math.tan(h*Math.PI/360)/aspect)*360/Math.PI,
  Ui(url,callback){loads.push(()=>{const texture=new Texture({url});callback(texture);return texture;});},
  document:{createElement:()=>({width:0,height:0,getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})},
  scene,camera,effectsEnabled:true,globalThis:null});context.globalThis=context;
 const constants=kind==='tracer'?'const '+between(original,'rt={speedMs:','function Lh('):between(original,'const mn=','function Oh(');
 const factory=kind==='tracer'?between(source,'function Lh(','const mn='):between(source,'function Oh(','const Nh=');
 vm.runInContext(constants+'\n'+factory+'\neffect='+(kind==='tracer'?'Lh':'Oh')+'(scene,camera)',context);
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
const point=(x=0,y=1,z=-8)=>({x,y,z});

test('actual tracer simulation, placement, color and fading stay native while sequential shots reuse objects',()=>{
 const before=fixture(original,'tracer'),after=fixture(patched,'tracer');
 for(const mesh of after.effect.warmUp())mesh.frustumCulled=false;const warmed={mesh:after.counts.mesh,material:after.counts.material};
 for(let shot=0;shot<100;shot++){
  const tick=shot*128;
  for(const f of [before,after])f.effect.spawn(point(.2,1.3,-.4),point(shot%3-1,1.5,-30),tick);
  for(const age of [0,2,6,14,30]){
   before.effect.update(tick+age);after.effect.update(tick+age);assert.deepEqual(after.picture(),before.picture());
  }
 }
 assert.equal(after.counts.mesh,warmed.mesh);assert.equal(after.counts.material,warmed.material);
 assert.ok(before.counts.mesh>after.counts.mesh);assert.equal(after.counts.materialDisposals,0);
 after.effect.dispose();assert.equal(after.counts.materialDisposals,after.counts.material);assert.equal(after.counts.geometryDisposals,1);
 assert.equal(after.counts.textureDisposals,after.counts.texture);
 after.effect.dispose();
});

test('actual impact appearance preserves atlas choice, camera-facing pose, roll and lifetime across head/body/legs',()=>{
 const before=fixture(original,'impact'),after=fixture(patched,'impact');
 for(const mesh of after.effect.warmUp())mesh.frustumCulled=false;const warmed={mesh:after.counts.mesh,material:after.counts.material,clones:after.counts.clones};
 for(let shot=0;shot<80;shot++){
  const tick=shot*128,location=point(shot%7-3,1+shot%3*.2,-6-shot%5),zone=['head','body','legs'][shot%3];
  for(const f of [before,after])f.effect.spawn(location,zone,tick);
  for(const age of [0,2,8,12,25]){
   before.effect.update(tick+age);after.effect.update(tick+age);assert.deepEqual(after.picture(),before.picture());
  }
 }
 assert.equal(after.counts.mesh,warmed.mesh);assert.equal(after.counts.material,warmed.material);
 assert.equal(after.counts.clones,4,'one atlas texture per cell, not one clone per hit');
 assert.equal(after.counts.materialDisposals,0);assert.equal(after.loaded[0].source.version,4,'steady fire never requests another pixel upload');
 assert.equal(before.counts.clones,80);assert.equal(before.loaded[0].source.version,80);
 after.effect.dispose();assert.equal(after.counts.materialDisposals,after.counts.material);assert.equal(after.counts.textureDisposals,after.counts.texture);
 after.effect.dispose();
});

test('burst content and insertion order are retained beyond warm capacity and idle pools stay bounded',()=>{
 for(const kind of ['tracer','impact']){
  const before=fixture(original,kind),after=fixture(patched,kind);after.effect.warmUp();
  for(let shot=0;shot<100;shot++){
   for(const f of [before,after])kind==='tracer'?f.effect.spawn(point(),point(shot*.01,1,-25),0):f.effect.spawn(point(shot*.01,1,-5),'head',0);
  }
  before.effect.update(5);after.effect.update(5);assert.deepEqual(after.picture(),before.picture());
  before.effect.update(128);after.effect.update(128);assert.equal(after.scene.children.length,0);
  const perEntry=kind==='tracer'?1:2;
  assert.equal(after.counts.material-after.counts.materialDisposals,64*perEntry,'only the idle peak up to 64 entries is retained');
  after.effect.dispose();assert.equal(after.counts.materialDisposals,after.counts.material);assert.equal(after.counts.textureDisposals,after.counts.texture);
 }
});

test('clear, disabled impacts, late image completion and disposal preserve ownership',()=>{
 for(const kind of ['tracer','impact']){
  const f=fixture(patched,kind,{load:false});f.effect.warmUp();
  kind==='tracer'?f.effect.spawn(point(),point(1,1,-20),0):f.effect.spawn(point(),'body',0);
  f.effect.clear();assert.equal(f.scene.children.length,0);f.effect.clear();
  if(kind==='impact'){f.context.effectsEnabled=false;f.effect.spawn(point(),'head',1);assert.equal(f.scene.children.length,0);}
  f.effect.dispose();const before={...f.counts};f.loads.forEach(load=>load());
  assert.equal(f.counts.textureDisposals,f.counts.texture,'late loaded texture is released immediately');
  assert.equal(f.counts.material,before.material);assert.equal(f.effect.warmUp().length,0);
  kind==='tracer'?f.effect.spawn(point(),point(1,1,-20),1):f.effect.spawn(point(),'body',1);
  assert.equal(f.scene.children.length,0);f.effect.dispose();
 }
});

test('pool transformation is pinned and emits valid retained modules without mutating input',()=>{
 const input={'CymPR-fm.js':original,other:'same'},output=applyImpactTracerPoolingPatch(input);
 assert.equal(input['CymPR-fm.js'],original);assert.equal(output.other,'same');
 parse(output['CymPR-fm.js'],{ecmaVersion:'latest',sourceType:'module'});
 assert.throws(()=>applyImpactTracerPoolingPatch({}),/missing training/);
 assert.throws(()=>applyImpactTracerPoolingPatch(output),/already applied/);
 assert.throws(()=>applyImpactTracerPoolingPatch({'CymPR-fm.js':original.replace('function Lh(e,t){','function changedTracer(e,t){')}),/version mismatch/);
 assert.throws(()=>applyImpactTracerPoolingPatch({'CymPR-fm.js':original.replace('new yt(o,M()),from:g','new yt(o,other()),from:g')}),/version mismatch/);
});

test('offline build applies impact/tracer pooling after the other production transforms',async()=>{
 const buildUrl=new URL('../prepare-offline.mjs',import.meta.url);
 const program=parse(fs.readFileSync(buildUrl,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
 const imports=new Map();
 for(const statement of program.body)if(statement.type==='ImportDeclaration')for(const binding of statement.specifiers){
  if(binding.type==='ImportSpecifier')imports.set(binding.local.name,{file:statement.source.value,name:binding.imported.name});
 }
 const optimized=program.body.flatMap(statement=>statement.type==='VariableDeclaration'?statement.declarations:[]).find(declaration=>declaration.id.name==='optimizedModules');
 assert.equal(optimized?.init.callee.property.name,'reduce');
 const steps=optimized.init.callee.object.elements.map(step=>step.name);
 assert.equal(steps.at(-1),'applyImpactTracerPoolingPatch','production preparation must finish by applying the pooled native effects');
 const transforms=await Promise.all(steps.map(async name=>{
  const binding=imports.get(name);assert.ok(binding,'build transform has an actual import: '+name);
  const module=await import(new URL(binding.file,buildUrl));
  assert.equal(typeof module[binding.name],'function');return module[binding.name];
 }));
 const directory=new URL('../site/js/',import.meta.url);
 const input=Object.fromEntries(fs.readdirSync(directory).filter(name=>name.endsWith('.js')).map(name=>[name,fs.readFileSync(new URL(name,directory),'utf8')]));
 // Exercise the production transform chain entirely in memory; no build/dist writes.
 const output=transforms.reduce((modules,apply)=>apply(modules),input);
 assert.match(output['CymPR-fm.js'],/__aimTracerPool/);assert.match(output['CymPR-fm.js'],/__aimImpactAtlas/);
 assert.equal(input['CymPR-fm.js'],original);
 parse(output['CymPR-fm.js'],{ecmaVersion:'latest',sourceType:'module'});
});
