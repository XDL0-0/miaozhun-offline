import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {decodeRadianceHDR,isEnvironmentPanorama,resizeLinearHDR,floatToHalf,halfToFloat,encodeRGBA16F,environmentStats,halfEnvironmentStats} from '../scripts/weapon-environments.mjs';
import {createWeaponEnvironmentImporter,sourceEnvironmentIntensity} from '../scripts/import-weapon-environments.mjs';

const hdr=(width,height,pixels,orientation='-Y '+height+' +X '+width)=>Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n'+orientation+'\n'),Buffer.from(pixels)]);
const flatHDR=()=>hdr(2,1,[128,64,32,130,0,0,0,0]);

test('RGBE decoding preserves linear HDR values above one and black pixels',()=>{
  const image=decodeRadianceHDR(flatHDR());
  assert.deepEqual([image.width,image.height],[2,1]);
  assert.deepEqual([...image.rgba],[2,1,.5,1,0,0,0,1]);
  const reversed=decodeRadianceHDR(hdr(2,1,[128,64,32,130,0,0,0,0],'+Y 1 -X 2'));
  assert.deepEqual([...reversed.rgba],[0,0,0,1,2,1,.5,1]);
});

test('Radiance scanline runs and literals decode without crossing channel boundaries',()=>{
  const row=[2,2,0,8,136,128,8,0,16,32,48,64,80,96,112,136,0,136,130];
  const image=decodeRadianceHDR(hdr(8,1,row));
  for(let x=0;x<8;x++)assert.deepEqual([...image.rgba.slice(x*4,x*4+4)],[2,x*.25,0,1]);
  assert.throws(()=>decodeRadianceHDR(hdr(8,1,[2,2,0,7])),/width mismatch/);
  assert.throws(()=>decodeRadianceHDR(hdr(8,1,[2,2,0,8,137,1])),/exceeds scanline/);
  assert.throws(()=>decodeRadianceHDR(flatHDR().subarray(0,-1)),/Truncated/);
});

test('binary16 uses little endian, finite HDR values and ties-to-even rounding',()=>{
  for(const [value,word]of [[0,0],[1,0x3c00],[2,0x4000],[.5,0x3800],[65504,0x7bff],[2**-24,1],[2**-14,0x400],[-2,0xc000]]){
    assert.equal(floatToHalf(value),word);assert.equal(halfToFloat(word),value);
  }
  assert.equal(floatToHalf(1+2**-11),0x3c00);
  assert.equal(floatToHalf(1+3*2**-11),0x3c02);
  assert.throws(()=>floatToHalf(65505),/finite half/);
  assert.throws(()=>floatToHalf(Infinity),/finite half/);
  const bytes=encodeRGBA16F(new Float32Array([2,1,.5,1]));
  assert.deepEqual([...bytes],[0,64,0,60,0,56,0,60]);
  assert.deepEqual(gunzipSync(gzipSync(bytes)),bytes);
});

test('only oversized environments use area averaging in linear HDR space',()=>{
  const rgba=new Float32Array(Array.from({length:8},(_,i)=>[i*2,i,i*.5,1]).flat());
  const source={width:4,height:2,rgba},small=resizeLinearHDR(source,2,1);
  assert.deepEqual([small.width,small.height,small.resampled],[2,1,true]);
  assert.deepEqual([...small.rgba],[5,2.5,1.25,1,9,4.5,2.25,1]);
  assert.deepEqual(environmentStats(small.rgba).meanRGB,environmentStats(rgba).meanRGB);
  assert.equal(resizeLinearHDR(source).rgba,rgba);
  assert.equal(resizeLinearHDR(source).resampled,false);
  assert.ok(isEnvironmentPanorama(443,221));
  assert.ok(isEnvironmentPanorama(27,13));
  assert.equal(isEnvironmentPanorama(256,256),false);
  assert.throws(()=>resizeLinearHDR({width:2,height:2,rgba}),/2:1/);
});

test('an explicit HDRI uses its own named strength without multiplying inherited probe lighting',()=>{
  const Textures={HDRI:{ObjectPath:'/Game/Studio.0'}};
  assert.deepEqual(sourceEnvironmentIntensity({Textures,Scalars:{'HDRI Strength':.1,'Probe Influence':.6}},.6),{value:.1,parameter:'HDRI Strength'});
  assert.deepEqual(sourceEnvironmentIntensity({Textures,Scalars:{'HDRI Brightness':1.8,'Probe Influence':.6}},.6),{value:1.8,parameter:'HDRI Brightness'});
  assert.deepEqual(sourceEnvironmentIntensity({Textures,Scalars:{'HDRI Strength':0,'HDRI Brightness':1.8}},.6),{value:0,parameter:'HDRI Strength'});
  assert.deepEqual(sourceEnvironmentIntensity({Scalars:{'HDRI Strength':.1}},.6),{value:.6,parameter:null});
  assert.deepEqual(sourceEnvironmentIntensity({Textures,Scalars:{'Reflection Intensity':1.75}},.6),{value:.6,parameter:null});
});

test('environment imports retain the original RGBE file, distinguish source and fallback, and omit hidden materials',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aim-hdri-test-')),source=path.join(directory,'source'),originals=path.join(directory,'originals');
  fs.mkdirSync(path.join(source,'ShooterGame/Content'),{recursive:true});
  const file=path.join(source,'ShooterGame/Content/Studio.hdr'),bytes=flatHDR();fs.writeFileSync(file,bytes);
  const assets=[],audit={};
  const store=(bytes,ext,metadata)=>{assets.push({bytes,ext,metadata});return '/skin-packs/models/assets/'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24)+'.'+ext;};
  try{
    const importer=createWeaponEnvironmentImporter({sourceRoot:source,store,audit,originalDirectory:originals,repositoryRoot:directory,fallback:'/Game/Studio'});
    const material={envIntensity:.6},fallback=importer('Metal',{},material,'/Game/Metal');
    const explicit=importer('Glass',{Textures:{HDRI:{ObjectPath:'/Game/Studio.0'}},Scalars:{'HDRI Rotation Angle':.5}},material,'/Game/Glass');
    assert.deepEqual(fallback,explicit);assert.equal(assets.length,1);
    assert.deepEqual({width:fallback.width,height:fallback.height,type:fallback.type},{width:2,height:1,type:'rgba16f'});
    assert.equal(importer('Hidden',{}, {...material,hidden:true},'/Game/Hidden'),null);
    assert.deepEqual(audit.environments.materials.map(m=>m.assignment),['weapon-studio-fallback','source-material-hdri']);
    assert.equal(audit.environments.materials[1].parameters.scalars['HDRI Rotation Angle'],.5);
    assert.deepEqual(fs.readFileSync(path.join(directory,audit.environments.sources[0].original.file)),bytes);
    const half=gunzipSync(assets[0].bytes),stats=halfEnvironmentStats(half);
    assert.equal(half.length,2*1*8);assert.deepEqual(stats.maximumRGB,[2,1,.5]);assert.equal(stats.pixelsAboveOne,1);
    assert.equal(audit.environments.sources[0].statistics.meanLuminance,stats.meanLuminance);
  }finally{
    for(const file of fs.readdirSync(originals))fs.unlinkSync(path.join(originals,file));fs.rmdirSync(originals);
    fs.unlinkSync(file);fs.rmdirSync(path.dirname(file));fs.rmdirSync(path.join(source,'ShooterGame'));fs.rmdirSync(source);fs.rmdirSync(directory);
  }
});

test('shipped environments are bounded HDR payloads with original source backups and complete material coverage',()=>{
  const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p.replace(/^\//,''),root)));
  const audit=read('skin-packs/audit/weapon-model-sources.json'),index=read('skin-packs/models/index.json'),review=audit.environments;
  assert.equal(review.type,'rgba16f');assert.equal(review.byteOrder,'little-endian');
  assert.equal(review.colorSpace,'linear-srgb');assert.deepEqual(review.cap,{width:1024,height:512});
  assert.ok(review.sources.length>5);
  let bright=false,resampled=false;
  const urls=new Set();
  for(const source of review.sources){
    const meta=source.environment;
    assert.ok(isEnvironmentPanorama(meta.width,meta.height));assert.ok(meta.width<=1024&&meta.height<=512);
    assert.match(meta.data,/^\/skin-packs\/models\/assets\/[a-f0-9]{24}\.bin\.gz$/);
    const original=fs.readFileSync(new URL(source.original.file,root));
    assert.equal(crypto.createHash('sha256').update(original).digest('hex'),source.original.sha256);
    const bytes=gunzipSync(fs.readFileSync(new URL(meta.data.slice(1),root)));
    assert.equal(bytes.length,meta.width*meta.height*8);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),source.decodedSha256);
    for(let at=0;at<bytes.length;at+=2){
      const value=bytes.readUInt16LE(at);assert.notEqual(value&0x7c00,0x7c00,'runtime radiance must stay finite');
      if(at%8===6)assert.equal(value,0x3c00,'environment alpha stays one');
    }
    assert.deepEqual(halfEnvironmentStats(bytes),source.statistics);
    bright||=source.statistics.maximumRGB.some(v=>v>1);resampled||=source.resampled;urls.add(meta.data);
  }
  assert.ok(bright,'source HDR highlights must not be normalized into 0..1');assert.ok(resampled,'oversized source panoramas must exercise the size cap');
  const packages=new Set([...Object.values(index.models),...Object.values(index.variants).flatMap(Object.values)]);
  for(const url of packages)for(const part of read(url).parts)for(const material of part.materials){
    if(material.hidden)assert.equal(material.environment,undefined);
    else{assert.ok(material.environment,material.name);assert.ok(urls.has(material.environment.data),material.name);}
  }
  assert.ok(review.materials.some(m=>m.assignment==='source-material-hdri'));
  assert.ok(review.materials.some(m=>m.assignment==='weapon-studio-fallback'));
});
