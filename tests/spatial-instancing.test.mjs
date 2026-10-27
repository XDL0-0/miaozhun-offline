import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {applySpatialInstancingPatch} from '../patches/world-performance.mjs';
import {applyMapBatchDensityPatch} from '../patches/map-batch-density.mjs';

const original=fs.readFileSync(new URL('../site/js/aQOfOAp-.js',import.meta.url),'utf8');
const patched=applySpatialInstancingPatch({'aQOfOAp-.js':original})['aQOfOAp-.js'];
const plain=value=>JSON.parse(JSON.stringify(value));
const section=(text,start,end)=>{
  const a=text.indexOf(start),b=text.indexOf(end,a);
  assert.ok(a>=0&&b>a,`Missing retained function: ${start}`);
  return text.slice(a,b);
};
class Vector {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  copy(v){Object.assign(this,{x:v.x,y:v.y,z:v.z});return this;}
  applyMatrix4(m){const a=m.elements,{x,y,z}=this,w=1/(a[3]*x+a[7]*y+a[11]*z+a[15]);this.x=(a[0]*x+a[4]*y+a[8]*z+a[12])*w;this.y=(a[1]*x+a[5]*y+a[9]*z+a[13])*w;this.z=(a[2]*x+a[6]*y+a[10]*z+a[14])*w;return this;}
}
class Attribute {
  constructor(array,itemSize){Object.assign(this,{array,itemSize,count:array.length/itemSize});}
}
class Geometry {
  constructor(){this.uuid='geometry';this.attributes={};this.groups=[];this.index=null;this.boundingSphere=null;this.boundingBox=null;}
  setAttribute(name,value){this.attributes[name]=value;return this;}
  setIndex(value){this.index=value;return this;}
  computeBoundingSphere(){this.boundingSphere={center:new Vector(),radius:2};}
}
class InstanceMesh {
  constructor(geometry,material,count){Object.assign(this,{isMesh:true,isInstancedMesh:true,geometry,material,count,userData:{},visible:true,matrices:[],instanceMatrix:{}});}
  setMatrixAt(index,matrix){this.matrices[index]=matrix;}
  updateMatrix(){}
  computeBoundingSphere(){}
}
function factory(text){
  const functions=section(text,'function So(n){','function Tg(n){')+
    section(text,'function Tg(n){','function JT(n,e){')+
    section(text,'function Pu(n){','function ZT(n,e){')+
    section(text,'function Sg(n){','function kT(){')+
    section(text,'const TA=new WeakMap;','const eB=.002,')+
    section(text,'function XB(n){','function jB(n,e){');
  return vm.runInNewContext(`(()=>{${functions};return {group:XT,pvs:JB}})()`,{
    P:Vector,gt:Geometry,sr:Attribute,Mt:Attribute,Au:InstanceMesh,
    VT:3,WT:6000,Ll:48,Zo:'colorLayer',ec:'minLight',Ru:'alInstanceNames',Ig:'alInstanceMaterials',Fu:'alPvsKeys',
    // Small merged meshes are outside this transform. Preserve their descriptors
    // to compare this path without recreating the whole geometry merger.
    JT:(value)=>[{smallMerge:value}],atob:value=>Buffer.from(value,'base64').toString('binary'),
  });
}
const native=factory(original),spatial=factory(patched);
function matrix(x,y=0,z=0,scale=1){return {elements:[scale,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1],determinant:()=>scale};}
function geometry(id='shared',triangles=3000){
  const g=new Geometry();g.uuid=id;g.setAttribute('position',new Attribute(new Float32Array(9),3));g.setIndex(new Attribute(new Uint16Array(triangles*3),1));g.computeBoundingSphere();return g;
}
function group(id,positions,{geom=geometry(),atlas='0',mirror=false,slotKey='array',layer=2}={}){
  const material={uuid:'material:'+id,name:'material:'+id};
  const value={geometry:geom,material,atlas,matrices:positions.map(p=>matrix(p[0],p[1]??0,p[2]??0,mirror?-1:1)),
    names:positions.map((_,i)=>id+'#'+i),lms:positions.map((_,i)=>atlas===null?null:{cs:[.25,.5],cb:[i/100,0]}),castShadow:true,receiveShadow:true};
  const slot={key:slotKey,name:material.name,color:[.1,.2,.3],layer,minLight:[.04,.05,.06],withMinLight:true};
  return [value,slot];
}
const renderMaterials={material:(slot,atlas,kind)=>({name:'array-material:'+slot.key,key:slot.key,atlas,kind})};
function rows(meshes){
  return Array.from(meshes).filter(m=>m.isInstancedMesh).flatMap(m=>m.matrices.map((transform,index)=>({
    name:m.userData.alInstanceNames[index],material:m.userData.alInstanceMaterials[index],
    matrix:transform.elements,atlas:m.material.atlas,kind:m.material.kind,
    lm:Array.from(m.geometry.attributes.lmXform.array.slice(index*4,index*4+4)),
    colorLayer:Array.from(m.geometry.attributes.colorLayer.array.slice(index*4,index*4+4)),
    minLight:m.geometry.attributes.minLight?Array.from(m.geometry.attributes.minLight.array.slice(index*3,index*3+3)):null,
    index:Array.from(m.geometry.index.array),castShadow:m.castShadow,receiveShadow:m.receiveShadow,
  }))).sort((a,b)=>a.name.localeCompare(b.name));
}

test('actual large-batch grouping preserves every transform, name, material, lightmap and texture-array attribute',()=>{
  const shared=geometry(),input=new Map([
    group('a',[[0,0,0],[1,0,0],[23.99,0,0],[24,0,0],[49,0,0],[-.01,0,0],[-25,0,0]],{geom:shared}),
    group('b',[[1,30,0],[25,30,0],[50,30,0],[75,30,0]],{geom:shared,layer:4}),
    group('c',[[0,0,0],[24,0,0],[48,0,0],[72,0,0]],{geom:shared,atlas:'1'}),
    group('d',[[0,0,0],[24,0,0],[48,0,0],[72,0,0]],{geom:shared,mirror:true}),
    group('e',[[0,0,0],[24,0,0],[48,0,0],[72,0,0]],{geom:shared,atlas:null}),
  ]);
  const before=native.group(input,renderMaterials),after=spatial.group(input,renderMaterials,matrix(0));
  assert.ok(after.length>before.length);
  assert.deepEqual(rows(after),rows(before));
  for(const mesh of after){assert.equal(mesh.geometry.attributes.lmXform.count,mesh.count);assert.equal(mesh.geometry.attributes.colorLayer.count,mesh.count);}
});

test('world transform and 24m cell boundaries drive spatial membership without changing instance transforms',()=>{
  const input=new Map([group('a',[[0,0,0],[1,0,0],[23,0,0],[24,0,0],[48,0,0]],{})]);
  const local=spatial.group(input,renderMaterials,matrix(0));
  assert.deepEqual(Array.from(local,m=>m.count),[3,1,1]);
  const shifted=spatial.group(input,renderMaterials,matrix(1));
  assert.deepEqual(Array.from(shifted,m=>m.count),[2,2,1]);
  assert.deepEqual(rows(shifted),rows(local));
  const scaled=spatial.group(input,renderMaterials,matrix(0,0,0,2));
  assert.deepEqual(Array.from(scaled,m=>m.count),[2,1,1,1]);
});

test('PVS keeps original identities and a split batch contains only the bits of its own members',()=>{
  const shared=geometry(),input=new Map([
    group('a',[[0,0,0],[1,0,0],[2,0,0],[3,0,0]],{geom:shared}),
    group('b',[[50,0,0],[51,0,0],[52,0,0],[53,0,0]],{geom:shared}),
  ]);
  const before=native.group(input,renderMaterials),after=spatial.group(input,renderMaterials,matrix(0));
  assert.equal(before.length,1);assert.equal(after.length,2);
  const keys=before[0].userData.alPvsKeys;
  const data={batches:keys,cell:24,layer:4,cells:{'0,0,0':Buffer.from([1]).toString('base64'),'1,0,0':Buffer.from([2]).toString('base64')}};
  const pvs=spatial.pvs({children:after},data);
  assert.equal(pvs.ready,true);assert.equal(pvs.bitsOf.size,2);
  pvs.apply(new Vector(0));
  assert.deepEqual(Array.from(after,m=>m.visible),[true,false]);
  pvs.apply(new Vector(24));
  assert.deepEqual(Array.from(after,m=>m.visible),[false,true]);
  pvs.apply(new Vector(240));assert.ok(after.every(m=>m.visible),'missing PVS cell stays conservative');
});

test('co-located instances do not add draws and small-mesh clustering stays at 48m',()=>{
  const large=group('large',[[1,0,0],[2,0,0],[3,0,0],[4,0,0]],{});
  const small=group('small',[[0,0,0],[24,0,0]],{geom:geometry('small',1)});
  const input=new Map([large,small]);
  const before=native.group(input,renderMaterials),after=spatial.group(input,renderMaterials,matrix(0));
  assert.equal(after.filter(m=>m.isInstancedMesh).length,before.filter(m=>m.isInstancedMesh).length);
  assert.deepEqual(rows(after),rows(before));
  assert.deepEqual(plain(after.filter(m=>m.smallMerge).map(m=>m.smallMerge)),plain(before.filter(m=>m.smallMerge).map(m=>m.smallMerge)));
  assert.ok(patched.includes('const VT=3,WT=6e3,Ll=48;'));
});

test('selective threshold keeps light native batches intact and splits only heavy final batches',()=>{
  const selective=factory(applySpatialInstancingPatch({'aQOfOAp-.js':original},{minBatchTriangles:50000})['aQOfOAp-.js']);
  const input=new Map([
    group('heavy',[[0],[24],[48],[72]],{geom:geometry('heavy',13000)}),
    group('light',[[0],[24],[48],[72]],{geom:geometry('light',1000)}),
    group('small',[[0],[24]],{geom:geometry('small',1)}),
  ]);
  const before=native.group(input,renderMaterials),after=selective.group(input,renderMaterials,matrix(0));
  assert.deepEqual(Array.from(after.filter(m=>m.isInstancedMesh),m=>m.count),[1,1,1,1,4]);
  assert.deepEqual(rows(after),rows(before));
  assert.deepEqual(plain(after.filter(m=>m.smallMerge)),plain(before.filter(m=>m.smallMerge)));
});

test('threshold aggregates source descriptors by the complete final native batch key',()=>{
  const shared=geometry(),input=new Map([
    group('a',[[0],[1],[2],[3]],{geom:shared}),
    group('b',[[48],[49],[50],[51]],{geom:shared}),
    group('other-slot',[[0],[24],[48],[72]],{geom:shared,slotKey:'other'}),
    group('other-atlas',[[0],[24],[48],[72]],{geom:shared,atlas:'1'}),
    group('other-mirror',[[0],[24],[48],[72]],{geom:shared,mirror:true}),
  ]);
  const atThreshold=factory(applySpatialInstancingPatch({'aQOfOAp-.js':original},{minBatchTriangles:24000})['aQOfOAp-.js']);
  const aboveThreshold=factory(applySpatialInstancingPatch({'aQOfOAp-.js':original},{minBatchTriangles:24001})['aQOfOAp-.js']);
  const before=native.group(input,renderMaterials),at=atThreshold.group(input,renderMaterials,matrix(0)),above=aboveThreshold.group(input,renderMaterials,matrix(0));
  assert.equal(before.length,4);assert.equal(at.length,5,'two 12k descriptors must jointly pass the 24k threshold');
  assert.deepEqual(Array.from(at,m=>m.count),[4,4,4,4,4]);
  assert.equal(above.length,4,'the threshold is inclusive and respects final batch boundaries');
  assert.deepEqual(rows(at),rows(before));assert.deepEqual(rows(above),rows(before));
});

test('selective threshold counts nonindexed geometry and composes with 96m small-mesh merging',()=>{
  const geom=geometry('nonindexed');geom.index=null;geom.attributes.position.count=90;
  const input=new Map([group('unindexed',[[0],[24],[48],[72]],{geom})]);
  const run=threshold=>factory(applySpatialInstancingPatch({'aQOfOAp-.js':original},{minBatchTriangles:threshold})['aQOfOAp-.js']).group(input,renderMaterials,matrix(0));
  assert.equal(run(120).length,4);assert.equal(run(121).length,1);
  const options={cellSize:24,minBatchTriangles:50000},sources={'aQOfOAp-.js':original};
  const first=applyMapBatchDensityPatch(applySpatialInstancingPatch(sources,options),{cellSize:96});
  const second=applySpatialInstancingPatch(applyMapBatchDensityPatch(sources,{cellSize:96}),options);
  assert.equal(first['aQOfOAp-.js'],second['aQOfOAp-.js']);
  assert.ok(first['aQOfOAp-.js'].includes('Ll=96;'));
  const parsed=spawnSync(process.execPath,['--check','--input-type=module'],{input:first['aQOfOAp-.js'],encoding:'utf8',windowsHide:true});
  assert.equal(parsed.status,0,parsed.stderr);
});

test('optional patch accepts other cell sizes, preserves source inputs and fails on unknown/repeated builds',()=>{
  const input={'aQOfOAp-.js':original,'other.js':'unchanged'};
  const output=applySpatialInstancingPatch(input,{cellSize:16});
  assert.equal(input['aQOfOAp-.js'],original);assert.equal(output['other.js'],'unchanged');
  assert.ok(output['aQOfOAp-.js'].includes('Math.floor(r.x/16)'));
  const parsed=spawnSync(process.execPath,['--check','--input-type=module'],{input:patched,encoding:'utf8',windowsHide:true});
  assert.equal(parsed.status,0,parsed.stderr);
  assert.throws(()=>applySpatialInstancingPatch(output),/already applied/);
  assert.throws(()=>applySpatialInstancingPatch({}),/missing graphics/);
  for(const cellSize of [0,-1,NaN,Infinity,'24'])assert.throws(()=>applySpatialInstancingPatch(input,{cellSize}),/positive finite/);
  assert.equal(applySpatialInstancingPatch(input,{minBatchTriangles:0})['aQOfOAp-.js'],patched,'zero retains the previous transform exactly');
  assert.ok(!patched.includes('__aimSpatialBatchTriangles'),'default behavior has no selective prepass');
  for(const minBatchTriangles of [-1,NaN,Infinity,'50000'])assert.throws(()=>applySpatialInstancingPatch(input,{minBatchTriangles}),/nonnegative finite/);
  assert.throws(()=>applySpatialInstancingPatch({'aQOfOAp-.js':original.replace('function XT(n,e){','function XT_changed(n,e){')}),/version mismatch/);
});
