import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {weaponBodyMaterial,surfacePackFilter} from '../scripts/weapon-body-materials.mjs';
import {weaponMaterialTextures} from '../patches/weapon-body-materials-runtime.mjs';
import {decodeWeaponGlb} from '../patches/weapon-models-runtime.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const index=read('skin-packs/models/index.json');

test('an inherited zero-emission surface cannot become a white glowing gun',()=>{
  const texture=r=>r.ObjectPath;
  const m=weaponBodyMaterial('BoltSniper_Ego2_MI',{Textures:{Albedo:{ObjectPath:'diffuse'},AEM:{ObjectPath:'mask'},MRS:{ObjectPath:'mrs'}},Colors:{'Emissive Color':{R:0,G:0,B:0}},Scalars:{'Emissive Intensity':0},BlendMode:0},texture);
  assert.equal(m.emissiveIntensity,0);assert.equal(m.emissiveMap,null);assert.deepEqual(m.emissive,[0,0,0]);
  assert.equal(m.map,'diffuse');assert.equal(m.surfacePacked,true);
});

test('dedicated LED brightness and plastic opacity do not inherit ordinary metal defaults',()=>{
  const ref={ObjectPath:'mask'},texture=r=>r.ObjectPath;
  const led=weaponBodyMaterial('AK_Afterglow_LEDs_MI',{Textures:{AEM:ref},Colors:{'LED Emissive Color':{R:.65,G:.27,B:.006}},Scalars:{'Emissive Intensity':0,'LED Emissive Base Intensity':90}},texture);
  assert.equal(led.emissiveIntensity,3);assert.equal(led.emissiveMap,null,'dedicated LED geometry must not be extinguished by the generic zero-emission AEM mask');
  const plastic=weaponBodyMaterial('plastic',{Textures:{'MRS (Plastic Opacity, Roughness, Specular)':ref},BlendMode:2},texture);
  assert.equal(plastic.metalness,0);assert.ok(plastic.shader.plastic.map);assert.equal(plastic.transparent,true);
});

test('Champions source lookup and cube projections cannot turn into white diffuse proxy planes',()=>{
  const texture=r=>r.ObjectPath;
  const infinity=weaponBodyMaterial('Infinity_RedDot',{Textures:{PM_Diffuse:{ObjectName:"TextureCube'Environment'",ObjectPath:'/Game/VFX/Textures/cubemap/Environment.0'}},BlendMode:2},texture);
  assert.equal(infinity.map,null);assert.equal(infinity.hidden,true);assert.match(infinity.source.omitted,/environment-cube/);
  const jelly=weaponBodyMaterial('champions_jellyTest_MI',{Textures:{Albedo:{ObjectPath:'generic-white'},Liquid:{ObjectPath:'original-liquid'},'Liquid Graident':{ObjectPath:'original-gradient'}},Colors:{'Glass Tint':{R:.17,G:0,B:.53}},Scalars:{'Emissive Strength':2.2,'Liquid Speed X':.02,'Liquid Speed Y':.01},BlendMode:0},texture);
  assert.equal(jelly.map,null);assert.equal(jelly.shader.flow.map,'original-liquid');assert.equal(jelly.shader.flow.gradient,'original-gradient');assert.deepEqual(jelly.color,[.17,0,.53]);assert.ok(jelly.shader.flow.intensity<=.6);
});

test('surface packing preserves AO, roughness, metalness and specular as independent channels',()=>{
  const ff=process.env.FFMPEG_PATH??'ffmpeg',directory=fs.mkdtempSync(path.join(os.tmpdir(),'aim-surface-test-'));
  const a=path.join(directory,'mrs.rgba'),b=path.join(directory,'aem.rgba');
  try{
    fs.writeFileSync(a,Buffer.from([10,20,30,255,60,70,80,255]));fs.writeFileSync(b,Buffer.from([40,50,60,255,90,100,110,255]));
    const raw=p=>['-f','rawvideo','-pixel_format','rgba','-video_size','2x1','-i',p];
    const r=spawnSync(ff,['-v','error',...raw(a),...raw(b),'-filter_complex',surfacePackFilter(2,1),'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{windowsHide:true});
    assert.equal(r.status,0,r.stderr?.toString()??r.error?.message);assert.deepEqual([...r.stdout],[40,20,10,30,90,70,60,80]);
  }finally{fs.unlinkSync(a);fs.unlinkSync(b);fs.rmdirSync(directory);}
});

test('the shipped Operator retains all four textured surfaces without invented emission or gamma lift',()=>{
  const p=read(index.models['ora-by-onetap/operator'].slice(1)),materials=[...new Map(p.parts.flatMap(p=>p.materials).map(m=>[m.name,m])).values()];
  assert.equal(materials.length,4);
  for(const m of materials){assert.ok(m.map&&m.normalMap&&m.ormMap);assert.equal(m.emissiveIntensity,0);assert.equal(m.source.emissiveIntensity,0);assert.ok(m.surfacePacked);assert.equal(m.brightness,1);}
});

test('complex surface textures are local, preloaded and retain the original secondary UVs',()=>{
  let uvSets=0,features=new Set();
  for(const url of Object.values(index.models))for(const part of read(url.slice(1)).parts){
    for(const m of part.materials){Object.keys(m.shader).forEach(k=>features.add(k));for(const texture of weaponMaterialTextures(m)){assert.match(texture,/^\/skin-packs\/models\/assets\/[a-f0-9]+\.png$/);assert.ok(fs.existsSync(new URL('../'+texture.slice(1),import.meta.url)));}}
    const b=fs.readFileSync(new URL('../'+part.url.slice(1),import.meta.url)),d=decodeWeaponGlb(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
    for(const g of d.primitives)if(g.uv1){uvSets++;assert.equal(g.uv1.length,g.uv.length);assert.ok(g.uv1.every(Number.isFinite));}
  }
  assert.ok(uvSets>10);for(const f of ['flow','heat','rim','scroll'])assert.ok(features.has(f));
});
