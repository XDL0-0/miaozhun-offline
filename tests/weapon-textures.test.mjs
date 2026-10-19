import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeaponTextureLease,weaponAssetBytes} from '../patches/weapon-textures-runtime.mjs';
import {decodeWeaponEnvironment} from '../patches/weapon-models-runtime.mjs';

test('live gun and knife share one upload and release it only after both controllers finish',()=>{
  class Texture{constructor(){this.disposals=0;}dispose(){this.disposals++;}}
  const gun=createWeaponTextureLease(Texture),knife=createWeaponTextureLease(Texture);let allocations=0;
  const make=()=>{allocations++;return new Texture();};
  const a=gun.acquire('shared:linear',make),b=knife.acquire('shared:linear',make);
  assert.equal(a,b);assert.equal(gun.acquire('shared:linear',make),a);assert.equal(allocations,1);
  const color=gun.acquire('shared:srgb',make);assert.notEqual(color,a,'color-space variants must remain independent');
  gun.dispose();gun.dispose();assert.equal(color.disposals,1);assert.equal(a.disposals,0);
  knife.dispose();assert.equal(a.disposals,1);
  const replacement=createWeaponTextureLease(Texture).acquire('shared:linear',make);assert.notEqual(replacement,a,'disposed GPU objects cannot return on a later selection');
  assert.throws(()=>gun.acquire('other',make),/disposed/);
});

test('asset accounting includes decoded pixels and original motion buffers without double counting shared views',()=>{
  const buffer=new ArrayBuffer(128),picture={naturalWidth:2048,naturalHeight:2048};
  const assets={pictures:new Map([['a',picture],['alias',picture]]),parts:[{data:{primitives:[{position:new Float32Array(buffer,0,8),normal:new Float32Array(buffer,32,8),material:0}]}}],motions:{clips:{idle:{values:new Float32Array(10)}}},environments:new Map([['studio',{pixels:new Uint16Array(32)}]])};
  assert.equal(weaponAssetBytes(assets),2048*2048*4+128+40+64);
});

test('HDR environment decoder retains values above white and rejects truncated, nonfinite or external payloads',()=>{
  const meta={data:'/skin-packs/models/assets/abc.bin.gz',width:8,height:4,type:'rgba16f'},pixels=new Uint16Array(8*4*4);
  for(let i=0;i<pixels.length;i+=4)pixels.set([0x4000,0x3c00,0,0x3c00],i);
  const result=decodeWeaponEnvironment(meta,pixels.buffer);assert.equal(result.pixels[0],0x4000,'HDR two remains two, without 8-bit clipping');
  assert.throws(()=>decodeWeaponEnvironment(meta,pixels.buffer.slice(0,-2)),/Invalid/);
  assert.throws(()=>decodeWeaponEnvironment({...meta,data:'https://example.com/environment.bin.gz'},pixels.buffer),/Invalid/);
  const corrupt=pixels.slice();corrupt[2]=0x7c00;assert.throws(()=>decodeWeaponEnvironment(meta,corrupt.buffer),/Invalid HDR/);
  assert.throws(()=>decodeWeaponEnvironment({...meta,width:2048,height:1024},pixels.buffer),/Invalid/);
});
