import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {decodeWeaponGlb,createWeaponModelLoader} from '../patches/weapon-models-runtime.mjs';
import {applyWeaponModelsPatch} from '../patches/weapon-models.mjs';
import {createSkinPackRuntime} from '../patches/skin-packs-runtime.mjs';

const root=new URL('../',import.meta.url),source=new URL('skin-packs/models/',root);
const read=url=>JSON.parse(fs.readFileSync(url,'utf8'));
const index=read(new URL('index.json',source)),catalog=read(new URL('skin-packs/catalog.json',root));
const binary=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length);
const local=url=>new URL(url.replace(/^\/skin-packs\/models\//,''),source);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const warnings=fn=>{const previous=console.warn;console.warn=()=>{};return Promise.resolve().then(fn).finally(()=>console.warn=previous);};
function harness(key='ayakashi/phantom',options={}){
  let selected=key,fetches=[],imageLoads=0;
  const gate=new Map(),failures=new Map(),changes=new Map();
  const skins={async initialize(){},selection(weapon){const [collection,gun]=(selected??'default/'+weapon).split('/');return {collection:gun===weapon?collection:'default',modelEnabled:options.enabled!==false};}};
  const loader=createWeaponModelLoader({skins,timeoutMs:options.timeoutMs??1000,
    async fetcher(url,{signal}){
      fetches.push(url);await gate.get(url)?.promise;
      if(failures.get(url))return new Response('',{status:404});
      const data=changes.get(url)??fs.readFileSync(local(url));
      return new Response(data,{status:200});
    },
    makeImage(){
      imageLoads++;const image={async decode(){await options.decodeGate?.promise;}};
      Object.defineProperty(image,'src',{set(value){queueMicrotask(()=>options.imageFailure?image.onerror?.():image.onload?.());}});return image;
    }});
  return {loader,skins,fetches,gate,failures,changes,choose(key){selected=key;},get imageLoads(){return imageLoads;}};
}
function deferred(){let resolve;const promise=new Promise(a=>resolve=a);return {promise,resolve};}

test('real gun models cover every eligible collection/weapon and remain independent of the 30 audio themes',()=>{
  const expected=catalog.collections.flatMap(c=>c.weapons.map(w=>`${c.id}/${w}`));
  assert.equal(expected.length,14);assert.deepEqual(Object.keys(index.models).sort(),expected.sort());
  assert.equal(index.counts.weapons,14);
  for(const [key,url]of Object.entries(index.models)){
    assert.match(url,/^\/skin-packs\/models\/[a-z0-9/-]+\.json$/);
    const pack=read(local(url));assert.equal(`${pack.collection}/${pack.weapon}`,key);
    assert.equal(pack.parts.filter(p=>p.role==='body').length,1);assert.equal(pack.parts.filter(p=>p.role==='magazine').length,1);
    if(pack.weapon==='phantom')assert.ok(pack.parts.some(p=>p.role==='silencer'));
    if(pack.weapon==='operator')assert.ok(pack.parts.some(p=>p.role==='sight'));
  }
});

test('all retained model assets match their review hashes; textures are bounded and GLBs are closed offline',()=>{
  const review=read(new URL('skin-packs/audit/weapon-model-sources.json',root));
  assert.equal(review.models.length,14);assert.equal(review.assets.length,index.counts.assets);
  for(const entry of review.assets){
    const b=fs.readFileSync(local(entry.url));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),entry.sha256,entry.url);
    if(entry.url.endsWith('.png')){assert.equal(b.toString('ascii',1,4),'PNG');assert.ok(b.readUInt32BE(16)<=1024&&b.readUInt32BE(20)<=1024);}
    else{const decoded=decodeWeaponGlb(binary(b));for(const p of decoded.primitives){assert.ok(p.position.every(Number.isFinite));assert.ok(p.normal.every(Number.isFinite));assert.ok(p.index.length>0);if(p.weight)for(let i=0;i<p.weight.length;i+=4)assert.ok(Math.abs(p.weight[i]+p.weight[i+1]+p.weight[i+2]+p.weight[i+3]-1)<.002);}}
  }
});

test('skin rigs use the native coordinate frame and provide the sockets for their actual accessories',()=>{
  for(const url of Object.values(index.models)){
    const pack=read(local(url)),body=pack.parts.find(p=>p.role==='body');
    const decoded=decodeWeaponGlb(binary(fs.readFileSync(local(body.url)))),byName=new Map(decoded.bones.map(b=>[b.name,b]));
    assert.ok(byName.has('Root'));assert.ok(byName.has('Muzzle'));
    const q=byName.get('Skeleton').q;assert.ok(Math.abs(q.reduce((n,v)=>n+v*-.5,0))>.999);
    assert.ok(byName.has('Magazine_Main')||byName.has('Mag_Holder'));
    if(pack.parts.some(p=>p.role==='sight'))assert.ok(byName.has('Reflex'));
    if(pack.parts.some(p=>p.role==='silencer'))assert.ok(byName.has('Barrel'));
  }
});

test('loader decodes every delivered model with no external requests and deduplicates its texture slots',async()=>{
  const h=harness();
  for(const key of Object.keys(index.models)){
    h.choose(key);const asset=await h.loader.load(key.split('/')[1]);assert.equal(asset?.key,key);
    const urls=asset.parts.flatMap(p=>p.materials.flatMap(m=>[m.map,m.normalMap,m.ormMap,m.emissiveMap].filter(Boolean)));
    assert.equal(asset.pictures.size,new Set(urls).size);
  }
  assert.ok(h.fetches.every(url=>url.startsWith('/skin-packs/models/')));
});

test('native/default/disabled gun models do no model fetching and saved ORA audio themes do not fork geometry',async()=>{
  const h=harness(null);assert.equal(await h.loader.load('viewmodel'),null);assert.equal(await h.loader.load('melee'),null);assert.equal(h.fetches.length,0);
  const disabled=harness('ayakashi/phantom',{enabled:false});assert.equal(await disabled.loader.load('phantom'),null);assert.equal(disabled.fetches.length,0);
  h.choose('ora-by-onetap/vandal');const a=await h.loader.load('viewmodel'),count=h.fetches.length;
  assert.equal(a.key,'ora-by-onetap/vandal');assert.equal(await h.loader.load('vandal'),a);assert.equal(h.fetches.length,count);
});

test('concurrent scene and selection preloads share one task and cache hits do not reload images',async()=>{
  const h=harness();const [a,b,c]=await Promise.all([h.loader.load('phantom'),h.loader.load('phantom'),h.loader.load('phantom')]);
  assert.equal(a,b);assert.equal(b,c);const before=[h.fetches.length,h.imageLoads];assert.equal(await h.loader.load('phantom'),a);assert.deepEqual([h.fetches.length,h.imageLoads],before);
  assert.equal(h.fetches.filter(u=>u===index.models['ayakashi/phantom']).length,1);
});

test('a missing model falls back to native and can recover on a later preload',()=>warnings(async()=>{
  const h=harness(),url=index.models['ayakashi/phantom'];h.failures.set(url,true);assert.equal(await h.loader.load('phantom'),null);
  h.failures.delete(url);assert.equal((await h.loader.load('phantom')).key,'ayakashi/phantom');
}));

test('unsafe paths and incomplete packages never publish a ready appearance',()=>warnings(async()=>{
  const h=harness(),url=index.models['ayakashi/phantom'],pack=read(local(url));pack.parts[0].url='https://example.com/weapon.glb';h.changes.set(url,JSON.stringify(pack));
  assert.equal(await h.loader.load('phantom'),null);assert.ok(h.fetches.every(u=>!u.startsWith('http')));
  const broken=harness();const incomplete=read(local(url));incomplete.parts=incomplete.parts.filter(p=>p.role!=='magazine');broken.changes.set(url,JSON.stringify(incomplete));assert.equal(await broken.loader.load('phantom'),null);
}));

test('a texture decode deadline cannot publish a late cache and a later explicit preload recovers',()=>warnings(async()=>{
  const decodeGate=deferred(),options={decodeGate,timeoutMs:15},h=harness('ayakashi/phantom',options);
  assert.equal(await h.loader.load('phantom'),null);decodeGate.resolve();await tick();options.decodeGate=null;
  const before=h.imageLoads;assert.equal((await h.loader.load('phantom')).key,'ayakashi/phantom');assert.ok(h.imageLoads>before);
}));

test('GLB decoding rejects truncated or external buffers before they reach the renderer',()=>{
  assert.throws(()=>decodeWeaponGlb(new ArrayBuffer(8)),/Invalid weapon GLB/);
  const url=read(local(index.models['ayakashi/phantom'])).parts[0].url,b=fs.readFileSync(local(url));
  assert.throws(()=>decodeWeaponGlb(binary(b.subarray(0,b.length-4))),/Invalid weapon GLB/);
  const json={asset:{version:'2.0'},buffers:[{byteLength:4,uri:'https://example.com/a.bin'}]};
  const raw=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),glb=Buffer.alloc(12+8+padded.length+8+4);
  glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(padded.length,12);glb.writeUInt32LE(0x4e4f534a,16);padded.copy(glb,20);glb.writeUInt32LE(4,20+padded.length);glb.writeUInt32LE(0x004e4942,24+padded.length);
  assert.throws(()=>decodeWeaponGlb(binary(glb)),/embedded buffers/);
});

test('model toggle migrates old saved selections and persists independently from fire/kill/banner toggles',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const manifest=read(new URL('dist/skin-packs/index.json',root));
  values.set('aim-offline.skin-packs.v2',JSON.stringify({phantom:{collection:'ayakashi',theme:'default',banner:'blue',fireEnabled:false,killEnabled:true,bannerEnabled:false}}));
  const runtime=createSkinPackRuntime({storage,fetcher:async()=>({ok:true,json:async()=>manifest}),makeDecoder:()=>null,makeImage:()=>({set src(value){queueMicrotask(()=>this.onerror?.());}})});
  await runtime.initialize();assert.equal(runtime.selection('phantom').modelEnabled,true);
  await runtime.select('phantom',{modelEnabled:false});const selection=runtime.selection('phantom');assert.equal(selection.modelEnabled,false);assert.equal(selection.fireEnabled,false);assert.equal(selection.banner,'blue');assert.equal(selection.bannerEnabled,false);
  const saved=JSON.parse(values.get('aim-offline.skin-packs.v2'));assert.equal(saved.phantom.modelEnabled,false);
});

test('native viewmodel bridge is version-pinned, reversible and never changes weapon simulation definitions',()=>{
  const name='CFqO0zvx.js',source=fs.readFileSync(new URL('site/js/'+name,root),'utf8'),input={[name]:source,'CymPR-fm.js':'unchanged simulation'};
  const patched=applyWeaponModelsPatch(input);assert.equal(input[name],source);assert.equal(patched['CymPR-fm.js'],input['CymPR-fm.js']);
  assert.match(patched[name],/appearance':await __aimLoadWeaponModel/);assert.match(patched[name],/__aimAppearance\?\.update\(\)/);assert.match(patched[name],/__aimAppearance\?\.dispose\(\)/);
  assert.throws(()=>applyWeaponModelsPatch(patched),/already patched/);assert.throws(()=>applyWeaponModelsPatch({[name]:source.replace("'setGun'","'setGunChanged'")}),/version mismatch/);
});
