import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyMapBatchDensityPatch} from '../patches/map-batch-density.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const original=fs.readFileSync(new URL('../site/js/aQOfOAp-.js',import.meta.url),'utf8');
const patched=applyMapBatchDensityPatch({'aQOfOAp-.js':original})['aQOfOAp-.js'];
const section=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);};
class Vector {
  constructor(){this.x=this.y=this.z=0;}
  copy(v){Object.assign(this,{x:v.x,y:v.y,z:v.z});return this;}
  applyMatrix4(matrix){this.x+=matrix.x;this.y+=matrix.y;this.z+=matrix.z;return this;}
}
function factory(text){
  const constants=text.match(/const VT=3,WT=6e3,Ll=([\d.]+);/);assert.ok(constants);
  const functions=section(text,'function So(n){','function KT(n){')+section(text,'function KT(n){','function Tg(n){')+section(text,'function Pu(n){','function Rg(n){');
  return vm.runInNewContext('(()=>{'+functions+';return XT})()',{
    P:Vector,VT:3,WT:6000,Ll:Number(constants[1]),
    // Native XT's grouping is the sole changed behavior. Keep its complete
    // descriptors so native JT/YT receive exactly the same geometry payloads.
    JT:descriptor=>[{kind:'merged',descriptor}],YT:descriptor=>({kind:'instanced',descriptor})
  });
}
const native=factory(original),dense=factory(patched);
function group(name,positions,{layer=1,atlas='0',slotKey='array',triangles=1,cast=true,receive=true}={}){
  const geometry={uuid:'g:'+name,attributes:{position:{count:3},normal:{count:3},uv:{count:3}},index:{count:triangles*3},boundingSphere:{center:{x:0,y:0,z:0},radius:1}};
  const value={geometry,material:{uuid:'material:'+name,name:'material:'+name},atlas,matrices:positions.map(x=>({x,y:0,z:0,determinant:()=>1})),names:positions.map((_,i)=>name+'#'+i),lms:positions.map((_,i)=>({cs:[.5,.5],cb:[i/100,0]})),castShadow:cast,receiveShadow:receive};
  const slot={key:slotKey,name:'slot:'+name,color:[.1,.2,.3],layer,minLight:[.04,.05,.06],withMinLight:true};
  return [value,slot];
}
function rows(meshes){return Array.from(meshes).flatMap(mesh=>mesh.descriptor.items.map(item=>({name:item.name,matrix:[item.matrix.x,item.matrix.y,item.matrix.z],geometry:item.geometry.uuid,material:item.slot.name,color:item.slot.color,layer:item.slot.layer,minLight:item.slot.minLight,lm:item.lm,pvsKey:item.pvsKey,atlas:mesh.descriptor.atlas}))).sort((a,b)=>a.name.localeCompare(b.name));}
const plain=value=>JSON.parse(JSON.stringify(value));

test('actual native XT merges compatible small geometry in larger cells without losing members or attributes',()=>{
  const input=new Map([group('a',[0,48,96]),group('b',[1,49,97],{layer:3}),group('atlas',[0,48,96],{atlas:'1'}),group('material',[0,48,96],{slotKey:'different'})]);
  const before=native(input,{}),after=dense(input,{});
  assert.ok(after.length<before.length,'actual merged draw descriptors decrease');
  assert.deepEqual(plain(rows(after)),plain(rows(before)));
  for(const mesh of after){assert.equal(mesh.descriptor.castShadow,true);assert.equal(mesh.descriptor.receiveShadow,true);}
});

test('large instance policy stays unchanged and merged PVS identities remain the native original keys',()=>{
  const input=new Map([group('small',[0,48,95]),group('large',[0,48,96,144],{triangles:3000})]);
  const before=native(input,{}),after=dense(input,{});
  assert.deepEqual(plain(rows(after)),plain(rows(before)));
  assert.deepEqual(plain(before.filter(value=>value.kind==='instanced')),plain(after.filter(value=>value.kind==='instanced')));
  const nativeKeys=new Set(rows(before).map(item=>item.pvsKey));
  assert.ok(rows(after).every(item=>nativeKeys.has(item.pvsKey)));
  assert.equal(section(patched,'function JT(n,e){','function IA(n,e,t,i,s,r){'),section(original,'function JT(n,e){','function IA(n,e,t,i,s,r){'),'native geometry baking and ordering remain byte-for-byte untouched');
});

test('optional transform parses, keeps source inputs, and refuses unknown/repeated versions',()=>{
  const input={'aQOfOAp-.js':original,'other':'unchanged'};
  const output=applyMapBatchDensityPatch(input,{cellSize:192});
  assert.equal(input['aQOfOAp-.js'],original);assert.equal(output.other,'unchanged');
  assert.ok(output['aQOfOAp-.js'].includes('Ll=192;'));
  parse(patched,{ecmaVersion:'latest',sourceType:'module'});
  assert.throws(()=>applyMapBatchDensityPatch(output),/already applied/);
  for(const cellSize of [0,-1,NaN,Infinity,'96'])assert.throws(()=>applyMapBatchDensityPatch(input,{cellSize}),/positive finite/);
  assert.throws(()=>applyMapBatchDensityPatch({}),/missing graphics/);
  assert.throws(()=>applyMapBatchDensityPatch({'aQOfOAp-.js':original.replace('Ll=48;','Ll=47;')}),/version mismatch/);
});
