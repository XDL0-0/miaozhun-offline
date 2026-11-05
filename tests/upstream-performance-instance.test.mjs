import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createInstanceVisibilityCompactor as createRawCompactor} from '../patches/instance-visibility-compaction.mjs';
import {applyUpstreamInstancePerformancePatch as applyInstanceVisibilityCompactionPatch} from '../patches/upstream-performance-instance.mjs';
const createInstanceVisibilityCompactor=(mesh,data,options={})=>createRawCompactor(mesh,data,{knownMaterialHook:mesh.material.onBeforeCompile,...options});

const original=fs.readFileSync(new URL('../upstream/aimpro-2026-11-05/source/js/CqM6URxy.js',import.meta.url),'utf8');
const patched=applyInstanceVisibilityCompactionPatch({'CqM6URxy.js':original},{minBatchTriangles:5})['CqM6URxy.js'];
const plain=value=>JSON.parse(JSON.stringify(value));
const section=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);};
class Vector{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}set(x,y,z){Object.assign(this,{x,y,z});return this;}copy(other){return this.set(other.x,other.y,other.z);}applyMatrix4(matrix){const a=matrix.elements,{x,y,z}=this;return this.set(a[0]*x+a[4]*y+a[8]*z+a[12],a[1]*x+a[5]*y+a[9]*z+a[13],a[2]*x+a[6]*y+a[10]*z+a[14]);}}
class Matrix{
  constructor(x=0,scale=1){this.elements=[scale,0,0,0,0,scale,0,0,0,0,scale,0,x,0,0,1];}
  fromArray(array,offset=0){this.elements=Array.from(array.slice(offset,offset+16));return this;}
  toArray(array,offset=0){for(let index=0;index<16;index++)array[offset+index]=this.elements[index];return array;}
  multiplyMatrices(a,b){const result=new Array(16).fill(0);for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)result[col*4+row]+=a.elements[k*4+row]*b.elements[col*4+k];this.elements=result;this.planes=a.planes;return this;}
  premultiply(a){return this.multiplyMatrices(a,{elements:this.elements});}
}
class Sphere{
  constructor(center=new Vector,radius=.5){Object.assign(this,{center,radius});}
  copy(other){this.center.copy(other.center);this.radius=other.radius;return this;}
  clone(){return new Sphere().copy(this);}
  makeEmpty(){this.radius=-1;return this;}
  union(other){if(this.radius<0)return this.copy(other);const distance=Math.hypot(this.center.x-other.center.x,this.center.y-other.center.y,this.center.z-other.center.z);this.radius=Math.max(this.radius,distance+other.radius);return this;}
  applyMatrix4(matrix){this.center.applyMatrix4(matrix);const a=matrix.elements;this.radius*=Math.max(Math.hypot(a[0],a[1],a[2]),Math.hypot(a[4],a[5],a[6]),Math.hypot(a[8],a[9],a[10]));return this;}
}
class Attribute{
  constructor(array,itemSize,{instanced=false,divisor=1,normalized=false}={}){Object.assign(this,{array,itemSize,count:array.length/itemSize,isInstancedBufferAttribute:instanced,meshPerAttribute:divisor,normalized,version:0,updateRanges:[]});}
  clone(){return new Attribute(this.array.slice(),this.itemSize,{instanced:this.isInstancedBufferAttribute,divisor:this.meshPerAttribute,normalized:this.normalized});}
  copy(other){this.array=other.array.slice();this.itemSize=other.itemSize;this.count=other.count;this.meshPerAttribute=other.meshPerAttribute;return this;}
  set needsUpdate(value){if(value)this.version++;}
  clearUpdateRanges(){this.updateRanges.length=0;}
  addUpdateRange(start,count){this.updateRanges.push({start,count});}
  onUploadCallback(){}
}
class Geometry{
  constructor(){this.isBufferGeometry=true;this.attributes={position:new Attribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3)};this.index=new Attribute(new Uint16Array([0,1,2]),1);this.boundingSphere=new Sphere;this.groups=[];this.morphAttributes={};this.disposals=0;}
  clone(){const value=new Geometry;value.attributes=Object.fromEntries(Object.entries(this.attributes).map(([key,attribute])=>[key,attribute.clone()]));value.index=this.index?.clone()??null;value.boundingSphere=this.boundingSphere.clone();return value;}
  dispose(){this.disposals++;}
  setAttribute(name,attribute){this.attributes[name]=attribute;return this;}
  setIndex(attribute){this.index=attribute;return this;}
}
const instanced=(values,size,Type=Float32Array)=>new Attribute(new Type(values),size,{instanced:true,normalized:Type===Uint8Array});
function batch(positions=[-30,-3,-1,0,2,30],geometry=null){
  const count=positions.length,g=geometry??new Geometry;
  if(!geometry){
    g.attributes.lmXform=instanced(positions.flatMap((_,i)=>[i+.1,i+.2,i+.3,i+.4]),4);
    g.attributes.colorLayer=instanced(positions.flatMap((_,i)=>[i,i+1,i+2,i+3]),4);
    g.attributes.minLight=instanced(positions.flatMap((_,i)=>[i+.2,i+.4,i+.6]),3);
    g.attributes.extra=instanced(positions.flatMap((_,i)=>[i,i+10]),2,Uint8Array);
  }
  return {isMesh:true,isInstancedMesh:true,matrixAutoUpdate:false,matrixWorld:new Matrix,count,geometry:g,
    instanceMatrix:instanced(positions.flatMap(x=>new Matrix(x).elements),16),instanceColor:instanced(positions.flatMap((_,i)=>[i/10,i/20,i/30]),3),
    boundingSphere:new Sphere(new Vector,40),material:{onBeforeCompile(){}},visible:true,userData:{alPvsKeys:['original-full-batch'],alInstanceNames:positions.map((_,i)=>'name'+i),alInstanceMaterials:positions.map((_,i)=>'material'+i)},
    getMatrixAt(index,target){return target.fromArray(this.instanceMatrix.array,index*16);}};
}
const box=(lo=-5,hi=5)=>[
  {normal:{x:1,y:0,z:0},constant:-lo},{normal:{x:-1,y:0,z:0},constant:hi},
  {normal:{x:0,y:1,z:0},constant:5},{normal:{x:0,y:-1,z:0},constant:5},
  {normal:{x:0,y:0,z:1},constant:5},{normal:{x:0,y:0,z:-1},constant:5},
];
class Frustum{setFromProjectionMatrix(matrix){this.planes=matrix.planes;return this;}}
function visibilityFactory(source){
  const helper=source.includes('const __aimCreateInstanceCompactor=')?section(source,'const __aimKnownStaticMapMaterials=','function sU(t,e){'):'';
  return vm.runInNewContext(helper+section(source,'function sU(t,e){','const Cu=')+';({create:sU,spheres:aU,visible:oU,knownMaterials:typeof __aimKnownStaticMapMaterials!=="undefined"?__aimKnownStaticMapMaterials:null});',
    {$e:Matrix,oi:Sphere,Ol:Frustum,Uh:'alPartSpheres',TC:(mask,bits)=>bits.some(index=>(mask[index>>3]&(1<<(index&7)))!==0)});
}
const native=visibilityFactory(original),optimized=visibilityFactory(patched);
function nativeVertexTypes(){
  const source=section(original,'class mt extends Vi{','class bh{')+section(original,'class bh{','let AB=')+';({Geometry:mt,InterleavedBuffer:bh,InterleavedAttribute:Ya});';
  let serial=0;
  return vm.runInNewContext(source,{Vi:class{dispatchEvent(event){if(event.type==='dispose')this.disposals=(this.disposals??0)+1;}},lB:0,Nn:()=>String(++serial),df:35044,It:Attribute,Q:Vector,Fe:()=>{}});
}
function interleavedGeometry(types){
  const geometry=new types.Geometry,data=new types.InterleavedBuffer(new Float32Array([0,0,0,0,1,0,.2,0,0,0,1,0,0,.2,0,0,1,0]),6);
  geometry.setAttribute('position',new types.InterleavedAttribute(data,3,0));geometry.setAttribute('normal',new types.InterleavedAttribute(data,3,3));
  geometry.setIndex(new Attribute(new Uint16Array([0,1,2]),1));geometry.boundingSphere=new Sphere;
  return geometry;
}
function rows(mesh){return Array.from({length:mesh.count},(_,index)=>({
  matrix:Array.from(mesh.instanceMatrix.array.slice(index*16,index*16+16)),
  color:Array.from(mesh.instanceColor.array.slice(index*3,index*3+3)),
  attributes:Object.fromEntries(Object.entries(mesh.geometry.attributes).filter(([,a])=>a.isInstancedBufferAttribute).map(([key,a])=>[key,Array.from(a.array.slice(index*a.itemSize,(index+1)*a.itemSize))])),
  name:mesh.userData.alInstanceNames[index],material:mesh.userData.alInstanceMaterials[index],
}));}
function spheres(mesh){return native.spheres(mesh,new Matrix,new Sphere);}
function camera(planes=box()){const projectionMatrix=new Matrix;projectionMatrix.planes=planes;return {position:new Vector,matrixWorldInverse:new Matrix,projectionMatrix,updateMatrixWorld(){}};}

function nativeGpu(){
  const writes=[];let bound;
  const gl={createBuffer:()=>({}),bindBuffer(target,buffer){bound=buffer;},bufferData(target,array){bound.array=array.slice();},
    bufferSubData(target,byteOffset,array,start=0,count=array.length){bound.array.set(array.subarray(start,start+count),byteOffset/array.BYTES_PER_ELEMENT);writes.push({byteOffset,start,count});}};
  const factory=vm.runInNewContext(section(original,'function uT(t){','var fT=')+';uT;',{Float32Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Int8Array,Uint8Array,Uint8ClampedArray});
  const gpu=factory(gl);
  return {writes,flush(mesh){
    const attributes=[mesh.instanceMatrix,mesh.instanceColor,...Object.values(mesh.geometry.attributes).filter(attribute=>attribute.isInstancedBufferAttribute)];
    for(const attribute of attributes){gpu.update(attribute,0);assert.deepEqual(Array.from(gpu.get(attribute).buffer.array.slice(0,mesh.count*attribute.itemSize)),Array.from(attribute.array.slice(0,mesh.count*attribute.itemSize)));}
  }};
}

test('stable compaction preserves every matrix, lightmap, layer, color and instance pick identity',()=>{
  const mesh=batch(),full=rows(mesh),originalGeometry=mesh.geometry,originalAttributes=Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key,a])=>[key,Array.from(a.array)]));
  const bound=mesh.boundingSphere,pvs=mesh.userData.alPvsKeys,data=spheres(mesh),planes=box();
  const expected=full.filter((_,index)=>native.visible(data.subarray(index*4,index*4+4),planes));
  const compactor=createInstanceVisibilityCompactor(mesh,data,{minBatchTriangles:5});assert.ok(compactor);
  assert.notEqual(mesh.geometry,originalGeometry);assert.equal(compactor.compact(planes),4);
  assert.deepEqual(rows(mesh),expected);assert.equal(mesh.boundingSphere,bound);assert.equal(mesh.userData.alPvsKeys,pvs);
  for(const[key,a]of Object.entries(originalGeometry.attributes))assert.deepEqual(Array.from(a.array),originalAttributes[key]);
  for(const a of Object.values(mesh.geometry.attributes).filter(a=>a.isInstancedBufferAttribute))assert.deepEqual(a.updateRanges,[{start:0,count:4*a.itemSize}]);
  compactor.restore();assert.deepEqual(rows(mesh),full);
  const owned=mesh.geometry;compactor.dispose();compactor.dispose();assert.equal(mesh.geometry,originalGeometry);assert.equal(owned.disposals,1);assert.equal(originalGeometry.disposals,0);
});

test('unchanged camera and unchanged visibility mask reuse results without uploads or allocations',()=>{
  const mesh=batch(),compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0}),planes=box();
  compactor.compact(planes);const first=compactor.stats(),versions=[mesh.instanceMatrix.version,...Object.values(mesh.geometry.attributes).map(a=>a.version)];
  for(let index=0;index<50;index++)compactor.compact(planes);
  assert.deepEqual(compactor.stats(),first);assert.deepEqual([mesh.instanceMatrix.version,...Object.values(mesh.geometry.attributes).map(a=>a.version)],versions);
  compactor.compact(box(-5.1,5.1));assert.equal(compactor.stats().classifications,2);assert.equal(compactor.stats().uploads,first.uploads);
  compactor.restore();assert.equal(mesh.count,6);compactor.compact(box(-5.1,5.1));assert.equal(mesh.count,4);assert.equal(compactor.stats().classifications,2,'restoring shadows does not discard the cached visibility mask');
});

test('native WebGLAttributes receives correct prefixes across deferred restores, empty draws and cached selections',()=>{
  const mesh=batch(),full=rows(mesh),compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0}),gpu=nativeGpu();
  gpu.flush(mesh);compactor.compact(box());gpu.flush(mesh);
  compactor.restore();compactor.compact(box(20,40));assert.equal(mesh.count,1);gpu.flush(mesh);
  assert.deepEqual(mesh.instanceMatrix.updateRanges,[],'native WebGLAttributes consumes pending component ranges');
  compactor.restore();gpu.flush(mesh);assert.deepEqual(rows(mesh),full);
  const uploads=compactor.stats().uploads,writes=gpu.writes.length;
  compactor.compact(box(100,120));assert.equal(mesh.count,0);gpu.flush(mesh);
  assert.equal(compactor.stats().uploads,uploads,'an empty draw needs no new attribute version');assert.equal(gpu.writes.length,writes);
  compactor.restore();compactor.compact(box(100,120));gpu.flush(mesh);
  compactor.compact(box());gpu.flush(mesh);compactor.restore();gpu.flush(mesh);
  assert.deepEqual(rows(mesh),full);assert.ok(gpu.writes.every(write=>write.count>0),'zero-length ranges are never sent to WebGL');
  assert.deepEqual(mesh.instanceMatrix.updateRanges,[]);compactor.dispose();
});

test('invalid frusta temporarily restore full data and scaled plane equations retain the same boundary intersections',()=>{
  const mesh=batch(),compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0});
  compactor.compact(box());
  for(const invalid of [null,box().slice(1),box().map((plane,index)=>index===0?{normal:{x:0,y:0,z:0},constant:-1}:plane),box().map((plane,index)=>index===0?{normal:{x:NaN,y:0,z:0},constant:0}:plane)]){
    assert.equal(compactor.compact(invalid),6);assert.equal(mesh.count,6);assert.equal(compactor.stats().disabled,false);
    assert.equal(compactor.compact(box()),4);assert.equal(compactor.stats().classifications,1,'temporary invalid cameras preserve the valid cached selection');
  }
  const boundary=batch([-.5,0]),boundaryCompactor=createInstanceVisibilityCompactor(boundary,spheres(boundary),{minBatchTriangles:0}),planes=box(0,5);
  assert.equal(boundaryCompactor.compact(planes),2);
  for(const plane of planes){plane.normal.x*=4;plane.normal.y*=4;plane.normal.z*=4;plane.constant*=4;}
  assert.equal(boundaryCompactor.compact(planes),2,'sphere radius is scaled by plane normal length');
  compactor.dispose();boundaryCompactor.dispose();
});

test('native world-space spheres keep boundary intersections and scaled or mirrored instances conservative',()=>{
  const mesh=batch([-6,-5.5,-5,0,5,5.5,6]);mesh.matrixWorld=new Matrix(0,-2);
  const data=spheres(mesh),full=rows(mesh),planes=box(),expected=full.filter((_,index)=>native.visible(data.subarray(index*4,index*4+4),planes));
  const compactor=createInstanceVisibilityCompactor(mesh,data,{minBatchTriangles:0});compactor.compact(planes);assert.deepEqual(rows(mesh),expected);
  mesh.matrixWorld.elements[12]=1;compactor.compact(planes);assert.deepEqual(rows(mesh),full);assert.equal(compactor.stats().disabled,true,'moving a formerly static map disables compaction');
});

test('sheared transforms retain a visible surface that native max-column sphere would exclude',()=>{
  const mesh=batch([0,0]);mesh.geometry.boundingSphere.radius=1;
  const direction={x:.85065080835204,y:.525731112119134},m=mesh.instanceMatrix.array;
  m[4]=1;m[12]=direction.x*1.5;m[13]=direction.y*1.5;
  const data=spheres(mesh),planes=box(-100,100);planes[0]={normal:{x:-direction.x,y:-direction.y,z:0},constant:0};
  assert.equal(native.visible(data.subarray(0,4),planes),false,'native max-column radius underbounds this shear');
  assert.equal(native.visible(data.subarray(4,8),planes),true,'another member keeps the original whole draw visible');
  const surface=new Vector(-.525731112119134,-.85065080835204,0).applyMatrix4(new Matrix().fromArray(m));
  assert.ok(planes[0].normal.x*surface.x+planes[0].normal.y*surface.y>0,'a vertex inside the local sphere remains on screen');
  const compactor=createInstanceVisibilityCompactor(mesh,data,{minBatchTriangles:0});assert.equal(compactor.compact(planes),2,'the conservative Frobenius bound keeps that surface');
});

test('shared source geometries and independent native matrix buffers stay isolated across map clones',()=>{
  const first=batch(),second=batch([-30,-3,-1,0,2,30],first.geometry),originalRows=rows(second),source=first.geometry;
  const a=createInstanceVisibilityCompactor(first,spheres(first),{minBatchTriangles:0}),b=createInstanceVisibilityCompactor(second,spheres(second),{minBatchTriangles:0});
  a.compact(box(-5,5));b.compact(box(20,40));assert.equal(first.count,4);assert.equal(second.count,1);assert.equal(rows(second)[0].name,'name5');
  a.dispose();assert.equal(first.geometry,source);assert.equal(second.count,1);b.dispose();assert.deepEqual(rows(second),originalRows);assert.equal(source.disposals,0);
});

test('actual native interleaved vertex buffers are cloned intact, never compacted or shared on disposal',()=>{
  const types=nativeVertexTypes(),geometry=interleavedGeometry(types),template=batch();
  for(const[name,attribute]of Object.entries(template.geometry.attributes))if(attribute.isInstancedBufferAttribute)geometry.setAttribute(name,attribute);
  const mesh=batch(undefined,geometry),source=geometry.attributes.position.data,array=Array.from(source.array);
  const compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0});assert.ok(compactor);
  const owned=mesh.geometry,position=owned.attributes.position,normal=owned.attributes.normal;
  assert.equal(position.data,normal.data,'native BufferGeometry.clone preserves interleaved vertex layout');
  assert.notEqual(position.data,source);assert.notEqual(position.data.array.buffer,source.array.buffer);
  compactor.compact(box());assert.equal(mesh.count,4);assert.deepEqual(Array.from(position.data.array),array);assert.deepEqual(Array.from(source.array),array);
  compactor.dispose();assert.equal(owned.disposals,1);assert.equal(geometry.disposals??0,0);assert.equal(mesh.geometry,geometry);
  const unsupported=interleavedGeometry(types);unsupported.attributes.position.data.isInstancedInterleavedBuffer=true;
  const rejected=batch(undefined,unsupported);let detail=null;
  assert.equal(createInstanceVisibilityCompactor(rejected,spheres(rejected),{minBatchTriangles:0,onReject:(reason,value)=>{detail={reason,...value};}}),null);
  assert.equal(detail.reason,'unsupported-attribute');assert.equal(detail.name,'position');assert.equal(detail.isInterleaved,true);assert.equal(detail.dataIsInstanced,true);
});

test('unsupported divisors, interleaving, morphs, groups, displacement and light batches fail closed',()=>{
  const mutations=[mesh=>{mesh.geometry.attributes.extra.meshPerAttribute=2;},mesh=>{mesh.geometry.attributes.extra.isInterleavedBufferAttribute=true;},mesh=>{mesh.morphTexture={};},mesh=>{mesh.geometry.morphAttributes.position=[{}];},mesh=>{mesh.geometry.groups=[{}];},mesh=>{mesh.material.displacementMap={};},mesh=>{mesh.material.isShaderMaterial=true;},mesh=>{mesh.matrixAutoUpdate=true;},mesh=>{mesh.instanceMatrix.itemSize=4;},mesh=>{mesh.instanceColor.meshPerAttribute=2;},mesh=>{mesh.geometry.index.isGLBufferAttribute=true;},mesh=>{mesh.geometry.clone=()=>{throw Error('unsupported clone');};}];
  for(const mutate of mutations){const mesh=batch(),g=mesh.geometry;mutate(mesh);assert.equal(createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0}),null);assert.equal(mesh.geometry,g);assert.equal(mesh.count,6);}
  const light=batch();assert.equal(createInstanceVisibilityCompactor(light,spheres(light)),null);
  const unknown=batch();assert.equal(createRawCompactor(unknown,spheres(unknown),{minBatchTriangles:0}),null,'an unregistered onBeforeCompile is not trusted');
  const changed=batch(),compactor=createInstanceVisibilityCompactor(changed,spheres(changed),{minBatchTriangles:0});compactor.compact(box());changed.material.onBeforeCompile=()=>{};compactor.compact(box());assert.equal(changed.count,6);assert.equal(compactor.stats().disabled,true);
});

test('runtime material, geometry and attribute changes disable the static snapshot before reusing cached spheres',()=>{
  const mutations=[
    mesh=>{mesh.material={onBeforeCompile:mesh.material.onBeforeCompile};},
    mesh=>{mesh.material.displacementMap={};},mesh=>{mesh.material.isShaderMaterial=true;},mesh=>{mesh.material.isRawShaderMaterial=true;},
    mesh=>{mesh.morphTexture={};},mesh=>{mesh.isSkinnedMesh=true;},mesh=>{mesh.geometry.morphAttributes.position=[{}];},mesh=>{mesh.geometry.groups=[{}];},
    mesh=>{mesh.geometry.attributes={...mesh.geometry.attributes};},mesh=>{mesh.geometry.attributes.newStream=instanced([1,2,3,4,5,6],1);},
    mesh=>{mesh.geometry.attributes.extra=mesh.geometry.attributes.extra.clone();},mesh=>{mesh.geometry.attributes.extra.meshPerAttribute=2;},
    mesh=>{mesh.geometry.attributes.position.needsUpdate=true;},mesh=>{mesh.geometry.index=mesh.geometry.index.clone();},
    mesh=>{mesh.instanceMatrix=mesh.instanceMatrix.clone();},mesh=>{mesh.instanceColor=null;},mesh=>{mesh.matrixWorld=null;},mesh=>{mesh.matrixAutoUpdate=true;},
  ];
  for(const mutate of mutations){
    const mesh=batch(),compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0});
    compactor.compact(box());mutate(mesh);assert.equal(compactor.compact(box()),6);assert.equal(mesh.count,6);assert.equal(compactor.stats().disabled,true);compactor.dispose();
  }
  const types=nativeVertexTypes(),mesh=batch(undefined,interleavedGeometry(types)),compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0});
  compactor.compact(box());mesh.geometry.attributes.position.data.needsUpdate=true;
  assert.equal(compactor.compact(box()),6);assert.equal(compactor.stats().disabled,true);compactor.dispose();
});

test('native instance setters restore original indices before accepting an edit and are released on disposal',()=>{
  const mesh=batch(),full=rows(mesh);
  mesh.setMatrixAt=function(index,matrix){matrix.toArray(this.instanceMatrix.array,index*16);return this;};
  mesh.setColorAt=function(index,color){this.instanceColor.array.set(color,index*3);return this;};
  const originalMatrixSetter=mesh.setMatrixAt,originalColorSetter=mesh.setColorAt,compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0});
  compactor.compact(box());assert.equal(mesh.count,4);assert.equal(mesh.setMatrixAt(0,new Matrix(123)),mesh);
  assert.equal(mesh.count,6);assert.equal(mesh.instanceMatrix.array[12],123);assert.equal(mesh.instanceMatrix.array[28],full[1].matrix[12]);
  assert.equal(compactor.stats().disabled,true);assert.equal(compactor.compact(box()),6);
  mesh.setColorAt(0,[.25,.5,.75]);compactor.dispose();assert.equal(mesh.instanceMatrix.array[12],123);
  assert.deepEqual(Array.from(mesh.instanceColor.array.slice(0,3)),[.25,.5,.75]);
  assert.equal(mesh.setMatrixAt,originalMatrixSetter);assert.equal(mesh.setColorAt,originalColorSetter);
  const colorMesh=batch();colorMesh.setColorAt=originalColorSetter;
  const colorCompactor=createInstanceVisibilityCompactor(colorMesh,spheres(colorMesh),{minBatchTriangles:0});colorCompactor.compact(box());colorMesh.setColorAt(0,[.25,.5,.75]);
  assert.equal(colorMesh.count,6);assert.equal(colorCompactor.stats().disabled,true);colorCompactor.dispose();
});

test('raw instance writes require restoration first; an unexpected version restores the complete static snapshot',()=>{
  const mesh=batch(),full=rows(mesh),compactor=createInstanceVisibilityCompactor(mesh,spheres(mesh),{minBatchTriangles:0});
  compactor.compact(box());mesh.instanceMatrix.array[12]=123;mesh.instanceMatrix.needsUpdate=true;
  assert.equal(compactor.compact(box()),6);assert.deepEqual(rows(mesh),full,'unsupported compacted raw writes cannot redefine original instance indices');assert.equal(compactor.stats().disabled,true);compactor.dispose();
  const restored=batch(),restoredCompactor=createInstanceVisibilityCompactor(restored,spheres(restored),{minBatchTriangles:0});
  restoredCompactor.compact(box());restoredCompactor.restore();restored.instanceMatrix.array[12]=123;restored.instanceMatrix.needsUpdate=true;
  restoredCompactor.compact(box());assert.equal(restored.instanceMatrix.array[12],123,'explicit restoration before a bulk edit preserves the edit when disabling');restoredCompactor.dispose();
  assert.equal(restored.instanceMatrix.array[12],123);
});

test('invalid affine transforms, normalized matrices, aliased index clones and immutable setters are rejected without leasing buffers',()=>{
  const mutations=[mesh=>{mesh.matrixWorld.elements[12]=Infinity;},mesh=>{mesh.matrixWorld.elements[3]=.1;},
    mesh=>{mesh.instanceMatrix.array[12]=NaN;},mesh=>{mesh.instanceMatrix.array[15]=0;},mesh=>{mesh.instanceMatrix.normalized=true;},
    mesh=>{mesh.geometry.attributes.extra.array=new BigInt64Array(12);},mesh=>{mesh.geometry.attributes.position.array=new Float64Array(9);},
    mesh=>{mesh.boundingSphere.radius=-1;},mesh=>{mesh.geometry.index.clone=function(){return new Attribute(new Uint16Array(this.array.buffer,this.array.byteOffset,this.array.length),1);};},
    mesh=>{mesh.setMatrixAt=()=>{};Object.defineProperty(mesh,'setColorAt',{value:()=>{},writable:false});}];
  for(const mutate of mutations){
    const mesh=batch(),data=spheres(mesh),source=mesh.geometry;mutate(mesh);const setter=mesh.setMatrixAt;
    assert.equal(createInstanceVisibilityCompactor(mesh,data,{minBatchTriangles:0}),null);assert.equal(mesh.geometry,source);assert.equal(mesh.count,6);assert.equal(mesh.setMatrixAt,setter);
  }
});

test('actual sU preserves PVS and whole-batch visibility, restores all shadow occluders and disposes leases',()=>{
  const a=batch(),b=batch(),cam=camera(),pvs={bitsOf:new Map([[a,[0]],[b,[0]]]),allow:true,mask(){return new Uint8Array([this.allow?1:0]);}};
  optimized.knownMaterials.set(b.material,b.material.onBeforeCompile);
  const before=native.create({children:[a]},pvs),after=optimized.create({children:[b]},pvs),source=b.geometry===a.geometry?null:b.geometry;
  // b now owns a geometry clone; both original native whole-batch bounds remain.
  before.update(cam,false);after.update(cam,false);assert.equal(a.visible,b.visible);assert.equal(a.count,6);assert.equal(b.count,4);
  const counters=plain(after.compactionStats());assert.equal(counters.eligibleBatches,1);assert.equal(counters.visibleBatches,1);assert.equal(counters.drawnFullTriangles,6);assert.equal(counters.drawnTriangles,4);assert.equal(counters.drawnFullInstances,6);assert.equal(counters.drawnInstances,4);
  assert.deepEqual(plain(after.compactionStats()),counters,'diagnostic reads leave rendering state untouched');
  after.update(cam,true);assert.equal(b.count,6);assert.ok(b.visible);assert.deepEqual(rows(b),rows(a),'shadow-dirty frame keeps every occluder and the native main draw');
  after.update(cam,false);assert.equal(b.count,4);pvs.allow=false;before.update(cam,false);after.update(cam,false);assert.equal(a.visible,b.visible);assert.equal(b.visible,false);
  after.update(cam,true);assert.equal(b.count,6);assert.equal(b.visible,true,'shadow update ignores main-camera PVS like native');
  const owned=b.geometry;after.dispose();after.dispose();assert.equal(owned.disposals,1);assert.notEqual(b.geometry,owned);assert.deepEqual(rows(b),rows(a));assert.ok(source);
});

test('actual sU toggle immediately restores full data and preserves native visibility, bounds and shadow behavior',()=>{
  const mesh=batch(),full=rows(mesh),bound=mesh.boundingSphere,pvsKeys=mesh.userData.alPvsKeys;
  optimized.knownMaterials.set(mesh.material,mesh.material.onBeforeCompile);
  const visibility=optimized.create({children:[mesh]},null),owned=mesh.geometry;
  assert.equal(visibility.compactionStats().enabled,true);visibility.update(camera(),false);assert.equal(mesh.count,4);
  visibility.setCompactionEnabled(false);assert.equal(mesh.count,6);assert.deepEqual(rows(mesh),full);assert.equal(mesh.geometry,owned);assert.equal(mesh.boundingSphere,bound);assert.equal(mesh.userData.alPvsKeys,pvsKeys);
  const uploaded=visibility.compactionStats().attributeUploads;visibility.setCompactionEnabled(false);assert.equal(visibility.compactionStats().attributeUploads,uploaded,'repeated off calls do not upload again');
  const shifted=camera(box(20,40));visibility.update(shifted,false);assert.equal(mesh.count,6);assert.equal(mesh.visible,true);assert.equal(visibility.compactionStats().enabled,false);
  visibility.setCompactionEnabled(true);assert.equal(mesh.count,6,'enable waits for the next native visibility update');visibility.update(shifted,false);assert.equal(mesh.count,1);assert.equal(mesh.userData.alInstanceNames[0],'name5');
  visibility.update(shifted,true);assert.equal(mesh.count,6);assert.deepEqual(rows(mesh),full);assert.equal(mesh.visible,true,'shadow update remains full independently of the toggle');
  visibility.update(shifted,false);assert.equal(mesh.count,1);visibility.setCompactionEnabled(false);visibility.update(camera(box(100,120)),false);assert.equal(mesh.visible,false,'whole-batch native frustum still runs while compaction is off');assert.equal(mesh.count,6);
  assert.equal(mesh.geometry,owned);assert.equal(mesh.boundingSphere,bound);visibility.dispose();
});

test('actual bU releases compacted geometry on map replacement and viewport disposal',()=>{
  let shadowDisposals=0,lightingDisposals=0;
  class Scene{constructor(){this.children=[];}add(value){this.children.push(value);}remove(value){this.children=this.children.filter(item=>item!==value);}clear(){this.children=[];}}
  class Bounds{makeEmpty(){}expandByObject(){}}
  const source=section(patched,'const __aimKnownStaticMapMaterials=','const Cu=')+section(patched,'function bU(t,e){','function O5(t,e,n){')+';({create:bU,knownMaterials:__aimKnownStaticMapMaterials});';
  const {create,knownMaterials}=vm.runInNewContext(source,{$e:Matrix,oi:Sphere,Ol:Frustum,Uh:'alPartSpheres',TC:()=>true,aB:Scene,Re:class{},Eh:class{},ai:Bounds,rn:class{},md:()=>75,Ed:75,Th:{},G0:()=>({group:{},keyLight:{shadow:{dispose(){shadowDisposals++}}},dispose(){lightingDisposals++},sunDir:{}}),If:()=>null,OP:()=>{},BC:()=>null,rU:()=>({ready:false})});
  const viewport=create({environment:{fogEnabled:false}},{aspectRatio:1}),a=batch(),b=batch(),root=mesh=>({children:[mesh],updateWorldMatrix(){},traverse(fn){fn(mesh);}});
  for(const mesh of [a,b])knownMaterials.set(mesh.material,mesh.material.onBeforeCompile);
  viewport.setMapCompactionEnabled(false);viewport.setMapVisual(root(a));const ownedA=a.geometry;viewport.updateMapVisibility(camera(),false);assert.equal(a.count,6);assert.equal(viewport.mapCompactionStats().enabled,false,'a toggle set before async map loading is retained');
  viewport.setMapCompactionEnabled(true);viewport.updateMapVisibility(camera(),false);assert.equal(a.count,4);
  assert.equal(viewport.mapCompactionStats().drawnTriangles,4);
  viewport.setMapVisual(root(b));assert.equal(ownedA.disposals,1);assert.equal(a.count,6);const ownedB=b.geometry;
  viewport.dispose();viewport.dispose();assert.equal(ownedB.disposals,1);assert.equal(b.count,6);
  assert.equal(shadowDisposals,1);assert.equal(lightingDisposals,1);assert.equal(viewport.scene.environment,null);
});

function resourceLeaseRuntime(){
  class Scene{constructor(){this.children=[];}add(value){this.children.push(value);}remove(value){this.children=this.children.filter(item=>item!==value);}clear(){this.children=[];}}
  class Bounds{makeEmpty(){}expandByObject(){}}
  const state={Us:new Map,Ns:new Map,Gi:new Map,zi:new Map,bs:new Map,La:new Map,Fa:new Map,Sc:new Map,Vl:new Map,hl:new Map,sr:null,
    Er:new Map,Fs:new Map,br:new Map,ul:new WeakMap,Al:new Set,Ls:new Map,Ka:name=>'/maps/'+name};
  const source=section(patched,'const __aimKnownStaticMapMaterials=','const Cu=')+
    section(patched,'function bU(t,e){','function O5(t,e,n){')+
    section(patched,'function xL(t,e){','function ML(){')+section(patched,'function uL(t){','function fL(){')+
    section(patched,'function jF(t){','function ZF(){')+';({create:bU,release:jF});';
  const runtime=vm.runInNewContext(source,{...state,$e:Matrix,oi:Sphere,Ol:Frustum,Uh:'alPartSpheres',TC:()=>true,
    aB:Scene,Re:class{},Eh:class{},ai:Bounds,rn:class{},md:()=>75,Ed:75,Th:{},
    G0:()=>({group:{},keyLight:{shadow:{dispose(){}}},dispose(){},sunDir:{}}),If:()=>null,OP:()=>{},BC:()=>null,rU:()=>({ready:false})});
  const disposable=()=>({disposals:0,closes:0,dispose(){this.disposals++;},close(){this.closes++;}});
  return {...runtime,state,viewport:()=>runtime.create({environment:{fogEnabled:false}},{aspectRatio:1}),
    map(id){
      const root={name:'map:'+id,children:[],updateWorldMatrix(){},traverse(){}},bitmap=disposable(),texture=disposable(),material=disposable(),array=disposable(),depth=disposable();
      const manifest={atlases:{one:{irr:id+'.irr',sh:id+'.sh'}}};
      state.Us.set(id,root);state.Ns.set(id,[]);state.zi.set(id,manifest);state.bs.set(id,{});state.Gi.set(id,{});state.Vl.set(id,{});
      state.Er.set('/maps/'+id+'.irr',bitmap);state.Fs.set('/maps/'+id+'.irr|s',texture);
      state.br.set(id,material);state.ul.set(manifest,[id]);state.hl.set(id,[array]);state.Al.add(array);state.Ls.set(array,depth);
      return{root,bitmap,texture,material,array,depth};
    }};
}

test('native releaseMapAssets retains shared resources until the last mounted viewport lease ends',()=>{
  const runtime=resourceLeaseRuntime(),a=runtime.viewport(),b=runtime.viewport(),map=runtime.map('ascent');
  a.setMapVisual(map.root);b.setMapVisual({...map.root});
  assert.deepEqual(plain(runtime.release([])),[]);
  a.setMapVisual(null);a.dispose();a.dispose();
  assert.deepEqual(plain(runtime.release([])),[],'one released viewport cannot dispose another viewport’s material or atlas');
  for(const key of ['texture','material','array','depth'])assert.equal(map[key].disposals,0);
  assert.equal(map.bitmap.closes,0);
  b.dispose();b.dispose();
  assert.deepEqual(plain(runtime.release([])),['ascent']);
  for(const key of ['texture','material','array','depth'])assert.equal(map[key].disposals,1);
  assert.equal(map.bitmap.closes,1);
  for(const key of ['Us','Ns','Gi','zi','bs','Vl','hl','Er','Fs','br','Al','Ls'])assert.equal(runtime.state[key].size,0,key+' released');
  assert.deepEqual(plain(runtime.release([])),[],'repeated cleanup does not dispose resources twice');
});

test('map replacement transfers the viewport lease while native keep lists and in-flight guards remain authoritative',()=>{
  const runtime=resourceLeaseRuntime(),viewport=runtime.viewport(),old=runtime.map('old'),next=runtime.map('next'),kept=runtime.map('unmounted'),pending=runtime.map('pending');
  runtime.state.La.set('pending',Promise.resolve());
  viewport.setMapVisual(old.root);viewport.setMapVisual(next.root);
  assert.deepEqual(plain(runtime.release(['unmounted'])),['old']);
  assert.equal(old.material.disposals,1);assert.equal(next.material.disposals,0);assert.equal(kept.material.disposals,0);assert.equal(pending.material.disposals,0);
  viewport.dispose();runtime.state.La.delete('pending');
  assert.deepEqual(plain(runtime.release(['unmounted'])),['next','pending']);
  assert.equal(next.material.disposals,1);assert.equal(pending.material.disposals,1);
  assert.deepEqual(plain(runtime.release([])),['unmounted'],'unmounted clones still follow the documented native keep argument');
  assert.equal(kept.material.disposals,1);
});

test('actual native lightmap and texture-array factories register only their known vertex hooks',()=>{
  const source='const __aimKnownStaticMapMaterials=new WeakMap;'+section(patched,'function eC(t,e,n){','function tC(t,e,n,i){')+section(patched,'function _L(t,e,n,i,r){','function yf(t,e){')+';({lightmap:CL,array:_L,known:__aimKnownStaticMapMaterials});';
  const material=()=>({onBeforeCompile(){},alphaTest:0,polygonOffset:false,color:{setRGB(){}}});
  const factories=vm.runInNewContext(source,{br:new Map,ul:new WeakMap,vL:material,aC:material});
  const light=factories.lightmap({uuid:'light'},{},null,'0','instanced');assert.equal(factories.known.get(light),light.onBeforeCompile);
  const atlas=factories.array({key:'array',template:{},array:{name:'atlas'}},{},null,null,'instanced');assert.equal(factories.known.get(atlas),atlas.onBeforeCompile);
  atlas.onBeforeCompile=()=>{};assert.notEqual(factories.known.get(atlas),atlas.onBeforeCompile);
  const modified=original.replace('function nC(t,e,n){return','function nC(t,e,n){/* wind */return');
  assert.throws(()=>applyInstanceVisibilityCompactionPatch({'CqM6URxy.js':modified}),/unknown map vertex material/);
  const modifiedBase=original.replace('function aC(t){const e=new Ch;','function aC(t){/* new base vertex behavior */const e=new Ch;');
  assert.throws(()=>applyInstanceVisibilityCompactionPatch({'CqM6URxy.js':modifiedBase}),/unknown map vertex material/);
});

test('actual native LE, UL, material factory and clone initialize an eligible sU batch before first render',()=>{
  class MeshBase{
    constructor(geometry=new Geometry,material={}){Object.assign(this,{isMesh:true,geometry,material,matrixWorld:new Matrix,userData:{},matrixAutoUpdate:true,visible:true});}
    updateMatrix(){return this;}
    copy(other){this.geometry=other.geometry;this.material=other.material;this.matrixWorld=new Matrix().fromArray(other.matrixWorld.elements);this.matrixAutoUpdate=other.matrixAutoUpdate;this.userData=plain(other.userData);return this;}
  }
  class InstanceAttribute extends Attribute{constructor(array,size,normalized=false,divisor=1){super(array,size,{instanced:true,divisor,normalized});}}
  const source=section(patched,'const __aimKnownStaticMapMaterials=','function sU(t,e){')+
    section(original,'class LE extends tn{','const kA=')+section(original,'function AC(t){','function NL(t,e){')+
    section(original,'function fC(t){','function kL(t,e){')+section(original,'function oC(t){','function xL(t,e){')+section(patched,'function eC(t,e,n){','function CL(t,e,n,i,r){')+
    section(patched,'function _L(t,e,n,i,r){','function yf(t,e){')+section(patched,'function sU(t,e){','const Cu=')+
    ';({create:UL,Mesh:LE,visibility:sU,material:(slot)=>_L(slot,{},null,null,"instanced")});';
  const types=nativeVertexTypes(),runtime=vm.runInNewContext(source,{tn:MeshBase,Xa:InstanceAttribute,mt:types.Geometry,$e:Matrix,oi:Sphere,Ol:Frustum,gB:new Matrix,Wr:new Matrix,aa:new Sphere,
    cl:'colorLayer',ll:'minLight',Lh:'alInstanceNames',cC:'alInstanceMaterials',Nh:'alPvsKeys',Uh:'alPartSpheres',TC:()=>true,
    br:new Map,ul:new WeakMap,aC:()=>({onBeforeCompile(){},alphaTest:0,polygonOffset:false,color:{setRGB(){}}})});
  const geom=interleavedGeometry(types),slot={key:'native-array',name:'native',color:[1,1,1],layer:0,array:{name:'native-array'},withMinLight:false};
  const positions=[-30,-3,-1,0,2,30],items=positions.map((x,index)=>({geometry:geom,matrix:new Matrix(x),name:'native#'+index,lm:null,slot,pvsKey:'original-native-key'}));
  const base=runtime.create({items,geometry:geom,slot,atlas:null,mirrored:false,castShadow:true,receiveShadow:true},{material:()=>runtime.material(slot)});
  assert.ok(base.boundingSphere,'actual UL eagerly computes full native instance bounds');
  const mesh=new runtime.Mesh(undefined,undefined,0).copy(base);assert.ok(mesh.boundingSphere,'actual LE.copy preserves the full native bounds');
  assert.equal(mesh.geometry,base.geometry);assert.notEqual(mesh.instanceMatrix.array,base.instanceMatrix.array);
  const visibility=runtime.visibility({children:[mesh]},null);assert.equal(visibility.compactionStats().eligibleBatches,1,JSON.stringify(visibility.compactionStats()));
  assert.equal(mesh.geometry.attributes.position.isInterleavedBufferAttribute,true,'the actual UL path retains ordinary interleaved vertex attributes');
  visibility.update(camera(),false);assert.equal(mesh.count,4);assert.equal(base.count,6);assert.deepEqual(mesh.userData.alInstanceNames.slice(0,4),['native#1','native#2','native#3','native#4']);
  const withoutBounds=new runtime.Mesh(undefined,undefined,0).copy(base);withoutBounds.boundingSphere=null;
  const missing=runtime.visibility({children:[withoutBounds]},null);assert.equal(missing.compactionStats().eligibleBatches,1);assert.ok(withoutBounds.boundingSphere);missing.dispose();visibility.dispose();
});

test('optional transform is version-pinned, preserves source and parses as a complete module',()=>{
  const input={'CqM6URxy.js':original,'other.js':'unchanged'},output=applyInstanceVisibilityCompactionPatch(input);
  assert.equal(input['CqM6URxy.js'],original);assert.equal(output['other.js'],'unchanged');
  assert.throws(()=>applyInstanceVisibilityCompactionPatch(output),/already applied/);assert.throws(()=>applyInstanceVisibilityCompactionPatch({}),/missing world/);
  for(const value of [-1,NaN,Infinity,'50000'])assert.throws(()=>applyInstanceVisibilityCompactionPatch(input,{minBatchTriangles:value}),/nonnegative finite/);
  assert.throws(()=>applyInstanceVisibilityCompactionPatch({'CqM6URxy.js':original.replace('setMapVisual(E){if(p','setMapVisual(E){if(false&&p')}),/version mismatch/);
  assert.throws(()=>applyInstanceVisibilityCompactionPatch({'CqM6URxy.js':original.replace('if(e.has(r)||La.has(r)','if(e.has(r)||false||La.has(r)')}),/version mismatch/);
  assert.throws(()=>applyInstanceVisibilityCompactionPatch({'CqM6URxy.js':original.replace('o.name=`map:${t}`,o.updateMatrixWorld(!0)','o.name=`scene:${t}`,o.updateMatrixWorld(!0)')}),/version mismatch/);
  assert.throws(()=>applyInstanceVisibilityCompactionPatch({'CqM6URxy.js':original+'function sU(t,e){}'}),/version mismatch/);
  assert.equal(section(patched,'function PL(t,e){','const GL='),section(original,'function PL(t,e){','const GL='),'native batching, geometry, materials, PVS keys and lighting data are unchanged');
  assert.equal(section(patched,'function aU(t,e,n){','const Cu='),section(original,'function aU(t,e,n){','const Cu='),'native whole-batch spheres and conservative visibility predicates are unchanged');
  const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:patched,encoding:'utf8',windowsHide:true});assert.equal(checked.status,0,checked.stderr);
});
