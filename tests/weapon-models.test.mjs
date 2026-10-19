import {weaponMaterialTextures} from '../patches/weapon-body-materials-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeWeaponMotion,animationState,createWeaponMotionPlayer} from '../patches/weapon-motion-runtime.mjs';
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
  const skins={async initialize(){},selection(weapon){const [collection,gun,theme]=(selected??'default/'+weapon).split('/');return {collection:gun===weapon?collection:'default',theme,modelEnabled:options.enabled!==false};}};
  const loader=createWeaponModelLoader({skins,timeoutMs:options.timeoutMs??1000,cacheBytes:options.cacheBytes,
    async fetcher(url,{signal}){
      fetches.push(url);await gate.get(url)?.promise;
      if(failures.get(url))return new Response('',{status:404});
      const data=changes.get(url)??fs.readFileSync(local(url));
      return new Response(data,{status:200});
    },
    makeImage(){
      imageLoads++;const image={width:options.imageWidth??0,height:options.imageHeight??0,async decode(){await options.decodeGate?.promise;}};
      Object.defineProperty(image,'src',{set(value){queueMicrotask(()=>options.imageFailure?image.onerror?.():image.onload?.());}});return image;
    }});
  return {loader,skins,fetches,gate,failures,changes,choose(key){selected=key;},get imageLoads(){return imageLoads;}};
}
function deferred(){let resolve;const promise=new Promise(a=>resolve=a);return {promise,resolve};}

test('real models cover every eligible collection/weapon including all six Champions melees',()=>{
  const expected=catalog.collections.flatMap(c=>c.weapons.map(w=>`${c.id}/${w}`));
  assert.equal(expected.length,26);assert.deepEqual(Object.keys(index.models).sort(),expected.sort());
  assert.equal(index.counts.weapons,26);
  for(const [key,url]of Object.entries(index.models)){
    assert.match(url,/^\/skin-packs\/models\/[a-z0-9/-]+\.json$/);
    const pack=read(local(url));assert.equal(`${pack.collection}/${pack.weapon}`,key);
    assert.equal(pack.parts.filter(p=>p.role==='body').length,1);assert.equal(pack.parts.filter(p=>p.role==='magazine').length,pack.weapon==='melee'?0:1);
    if(pack.weapon==='phantom')assert.ok(pack.parts.some(p=>p.role==='silencer'));
    if(pack.weapon==='operator')assert.ok(pack.parts.some(p=>p.role==='sight'));
  }
});

test('all retained model assets match their review hashes; textures are bounded and GLBs are closed offline',()=>{
  const review=read(new URL('skin-packs/audit/weapon-model-sources.json',root));
  assert.equal(review.models.length,new Set([...Object.values(index.models),...Object.values(index.variants??{}).flatMap(Object.values)]).size);assert.equal(review.assets.length,index.counts.assets);
  for(const entry of review.assets){
    const b=fs.readFileSync(local(entry.url));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),entry.sha256,entry.url);
    if(entry.url.endsWith('.png')){assert.equal(b.toString('ascii',1,4),'PNG');assert.equal(b.readUInt32BE(16),entry.source.width);assert.equal(b.readUInt32BE(20),entry.source.height);assert.equal(entry.source.resolution,'original');assert.ok(entry.source.width<=4096&&entry.source.height<=4096);}
    else if(entry.url.endsWith('.glb')){const decoded=decodeWeaponGlb(binary(b));for(const p of decoded.primitives){assert.ok(p.position.every(Number.isFinite));assert.ok(p.normal.every(Number.isFinite));assert.ok(p.index.length>0);if(p.weight)for(let i=0;i<p.weight.length;i+=4)assert.ok(Math.abs(p.weight[i]+p.weight[i+1]+p.weight[i+2]+p.weight[i+3]-1)<.002);}}
    else{assert.ok(entry.url.endsWith('.bin.gz'));assert.equal(crypto.createHash('sha256').update(gunzipSync(b)).digest('hex'),entry.source.sha256);}
  }
});

test('skin rigs use the native coordinate frame and provide the sockets for their actual accessories',()=>{
  for(const url of Object.values(index.models)){
    const pack=read(local(url)),body=pack.parts.find(p=>p.role==='body');
    const decoded=decodeWeaponGlb(binary(fs.readFileSync(local(body.url)))),byName=new Map(decoded.bones.map(b=>[b.name,b]));
    assert.ok(byName.has('Root'));if(pack.weapon!=='melee')assert.ok(byName.has('Muzzle'));
    const q=byName.get('Skeleton').q;
    const expected=pack.collection==='champions-2026'&&pack.weapon==='melee'?[0,0,-Math.SQRT1_2,-Math.SQRT1_2]:[-.5,-.5,-.5,-.5];
    assert.ok(Math.abs(q.reduce((n,v,i)=>n+v*expected[i],0))>.999,pack.collection+'/'+pack.weapon+' retains its original rig frame');
    if(pack.weapon!=='melee')assert.ok(byName.has('Magazine_Main')||byName.has('Mag_Holder'));
    if(pack.parts.some(p=>p.role==='sight'))assert.ok(byName.has('Reflex'));
    if(pack.parts.some(p=>p.role==='silencer'))assert.ok(byName.has('Barrel'));
  }
});

test('loader decodes every delivered model with no external requests and deduplicates its texture slots',async()=>{
  const h=harness();
  for(const key of Object.keys(index.models)){
    h.choose(key);const asset=await h.loader.load(key.split('/')[1]);assert.equal(asset?.key,key);
    const pack=read(local(index.models[key]));
    const urls=[...asset.parts.flatMap(p=>p.materials.flatMap(weaponMaterialTextures)),...pack.effects.textures];
    assert.equal(asset.pictures.size,new Set(urls).size);
  }
  assert.ok(h.fetches.every(url=>url.startsWith('/skin-packs/models/')));
});

test('Champions 2026 switches both gun and fan between genuine attacking and defending packages',async()=>{
  for(const weapon of ['phantom','melee']){
    const base='champions-2026/'+weapon;
    assert.deepEqual(Object.keys(index.variants[base]).sort(),['attacking','defending']);
    const h=harness(base+'/attacking');
    const attack=await h.loader.load(weapon==='melee'?'knife':weapon);
    assert.equal(attack?.key,base+'/attacking');
    h.choose(base+'/defending');const defend=await h.loader.load(weapon);
    assert.equal(defend?.key,base+'/defending');
    assert.notDeepEqual(attack.parts[0].materials,defend.parts[0].materials,'both factions retain their source surfaces');
    assert.ok(h.fetches.every(url=>url.startsWith('/skin-packs/models/')));
  }
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

test('decoded asset budget evicts old packs without resizing source textures or invalidating live assets',async()=>{
  const h=harness('ayakashi/phantom',{cacheBytes:96*1024*1024,imageWidth:2048,imageHeight:2048});
  const a=await h.loader.load('phantom');assert.ok(a.byteLength>96*1024*1024);
  assert.equal(await h.loader.load('phantom'),a,'current large pack remains reusable');
  h.choose('kuronami/phantom');await h.loader.load('phantom');
  const before=h.fetches.length;h.choose('ayakashi/phantom');const again=await h.loader.load('phantom');
  assert.notEqual(again,a);assert.ok(h.fetches.length>before,'old raw assets no longer remain pinned by the cache');
  assert.ok(a.parts[0].data.primitives[0].position.length>0,'an active controller can still use its evicted assets');
  for(const image of again.pictures.values()){assert.equal(image.width,2048);assert.equal(image.height,2048);}
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

test('normal mapping retains the exported tangent frame and mirrored-UV handedness through coordinate conversion',()=>{
  const pack=read(local(index.models['kuronami/phantom'])),bytes=fs.readFileSync(local(pack.parts[0].url)),buffer=binary(bytes),view=new DataView(buffer);
  const jsonLength=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)).trim()),binAt=20+jsonLength+8;
  const primitive=json.meshes[0].primitives[0],accessor=json.accessors[primitive.attributes.TANGENT],slice=json.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType,5126);assert.equal(accessor.type,'VEC4');
  const offset=binAt+(slice.byteOffset??0)+(accessor.byteOffset??0),decoded=decodeWeaponGlb(buffer),tangent=decoded.primitives[0].tangent;
  assert.ok(tangent.length>=accessor.count*4);assert.equal(decoded.primitives[0].position.length/3,tangent.length/4);
  for(let i=0;i<accessor.count;i++){
    const at=offset+i*(slice.byteStride??16),x=view.getFloat32(at,true),y=view.getFloat32(at+4,true),z=view.getFloat32(at+8,true),w=view.getFloat32(at+12,true);
    assert.ok(tangent[i*4]*x-tangent[i*4+1]*z+tangent[i*4+2]*y>.998,'retain original tangent direction while orthogonalizing');
    assert.ok(Math.abs(Math.hypot(...tangent.subarray(i*4,i*4+3))-1)<.002);
    assert.ok(Math.abs(tangent[i*4+3])===1);assert.equal(w,1,'exported w is missing its mirrored-island sign');
  }
  const signs=new Set(Array.from(tangent).filter((_,i)=>i%4===3));assert.deepEqual(signs,new Set([1,-1]),'mirrored UV islands regain a distinct handedness');
  const p=decoded.primitives[0];let checked=0;
  for(let k=0;k<p.index.length;k+=3){
    const [a,b,c]=p.index.subarray(k,k+3),du1=p.uv[b*2]-p.uv[a*2],dv1=p.uv[b*2+1]-p.uv[a*2+1],du2=p.uv[c*2]-p.uv[a*2],dv2=p.uv[c*2+1]-p.uv[a*2+1],det=du1*dv2-du2*dv1;
    if(Math.abs(det)<1e-12)continue;
    const B=[0,1,2].map(axis=>((p.position[c*3+axis]-p.position[a*3+axis])*du1-(p.position[b*3+axis]-p.position[a*3+axis])*du2)/det);
    for(const v of [a,b,c]){
      const [nx,ny,nz]=p.normal.subarray(v*3,v*3+3),[tx,ty,tz,w]=p.tangent.subarray(v*4,v*4+4);
      const orientation=((ny*tz-nz*ty)*B[0]+(nz*tx-nx*tz)*B[1]+(nx*ty-ny*tx)*B[2])*w;
      assert.ok(orientation>=-1e-10,'each side of a mirrored seam must reconstruct the UV bitangent');checked++;
    }
  }
  assert.ok(checked>1000);
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
  const name='CFqO0zvx.js',source=fs.readFileSync(new URL('site/js/'+name,root),'utf8'),game=fs.readFileSync(new URL('site/js/CymPR-fm.js',root),'utf8'),input={[name]:source,'CymPR-fm.js':game};
  const patched=applyWeaponModelsPatch(input);assert.equal(input[name],source);assert.equal(input['CymPR-fm.js'],game);
  assert.match(patched[name],/appearance':await __aimLoadWeaponModel/);assert.match(patched[name],/__aimAppearance\?\.update\(bf,/);assert.match(patched[name],/__aimAppearance\?\.dispose\(\)/);
  assert.match(patched[name],/linearSrgb:'srgb-linear'/);assert.ok(!patched[name].includes('__aimWeaponLinearSrgb'));
  assert.match(patched['CymPR-fm.js'],/_t.push\(\{at:\(ke.tick\+1\)\*he,inspect:true,weapon:qe\(\)\}/);
  assert.equal(patched['CymPR-fm.js'].split('ke.step(Be)').length,game.split('ke.step(Be)').length);
  assert.throws(()=>applyWeaponModelsPatch(patched),/already patched/);assert.throws(()=>applyWeaponModelsPatch({[name]:source.replace("'setGun'","'setGunChanged'")}),/version mismatch/);
});

test('all skin reload/inspect/fire montages decode original retargeted offline tracks',()=>{
  const sources=read(new URL('skin-packs/audit/weapon-model-sources.json',root)),unique=new Set();
  for(const url of Object.values(index.models)){
    const pack=read(local(url));
    assert.ok(pack.parts.find(p=>p.role==='body').materials.some(m=>sources.assets.some(a=>a.url===m.map&&a.source.width>=1024)),'each weapon retains its original high-resolution body albedo');
    for(const action of pack.weapon==='melee'?['inspect','idle','attack1']:['reload','inspect','fire'])assert.ok(pack.motions.actions[action]?.arms,pack.collection+' '+action);
    for(const [id,clip]of Object.entries(pack.motions.clips)){
      unique.add(id);const bytes=gunzipSync(fs.readFileSync(local(clip.data))),data=decodeWeaponMotion(clip,binary(bytes));assert.ok(data.values.length>0);
      assert.equal(data.names.length,data.rest.length);
    }
    for(const action of Object.values(pack.motions.actions))for(const track of Object.values(action))for(const segment of track.segments){assert.ok(pack.motions.clips[segment.clip]);assert.ok(segment.to>segment.from);assert.ok(segment.rate>0);}
  }
  assert.ok(unique.size>71,'original Champions clips extend the existing 71 clips');
});

test('inspect yields to reload, firing, ADS and a new equip; reload follows the actual game duration',()=>{
  const actions={reload:{arms:{duration:3}},inspect:{arms:{duration:6}},fire:{arms:{duration:.3}}};
  const state={seconds:3,shots:[],melee:[{at:1,inspect:true,weapon:'phantom'}],equipAt:0,reloadSince:null,adsBlend:0};
  assert.equal(animationState(actions,state,'phantom').action,'inspect');assert.equal(animationState(actions,state,'vandal'),null);
  assert.equal(animationState(actions,{...state,reloadSince:1,reloadDuration:2},'phantom').time,1.5);
  assert.equal(animationState(actions,{...state,shots:[2.9]},'phantom').action,'fire');
  assert.equal(animationState(actions,{...state,adsBlend:1},'phantom'),null);
  assert.equal(animationState(actions,{...state,equipAt:2},'phantom'),null);
  assert.equal(animationState(actions,{...state,seconds:8},'phantom'),null);
  assert.equal(state.melee.length,1,'visual animation never mutates recorded input');
});

test('skin muzzle effects retain original emitters, bone attachments, curves and local texture closure',()=>{
  const fx=read(new URL('fire-effects.json',source));
  assert.ok(Object.keys(fx.guns).length>=20);assert.ok(Object.keys(fx.systems).length>40);
  for(const [key,gun]of Object.entries(fx.guns))for(const rule of [...gun.hip,...gun.ads]){
    const system=fx.systems[rule.sys];assert.ok(system,key+' has its source particle system');
    assert.ok(system.emitters.length||system.suppressed&&system.reason,'an omitted subsystem must explain why');
    for(const e of system.emitters){assert.ok(fx.materials[e.mat]);if(e.mesh)assert.ok(fx.meshes[e.mesh.name]);for(const m of e.mods)for(const v of Object.values(m))if(v?.v)assert.ok(v.v.every(Number.isFinite));}
  }
  for(const [key,gun]of Object.entries(fx.guns))assert.ok(gun.hip.some(r=>fx.systems[r.sys].emitters.length),key+' retains visible source muzzle particles');
  for(const t of Object.values(fx.textures))assert.ok(fs.existsSync(local(t.file)));
  assert.ok(fx.guns['ayakashi/phantom'].hip.some(x=>x.attach==='Face_Brow'));
  assert.ok(fx.guns['kuronami/vandal'].hip.some(x=>x.attach==='Charging_Handle'));
});

test('skin hand scales return to native values after inspect end, interruption and disposal',()=>{
  const vector=()=>({x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});return this;}});
  class Quaternion{set(x,y,z,w){Object.assign(this,{x,y,z,w});return this;}normalize(){return this;}slerp(q){return this.set(q.x,q.y,q.z,q.w);}}
  const bone={name:'MasterWeapon',position:vector(),scale:vector().set(1,1,1),quaternion:new Quaternion().set(0,0,0,1)};
  const meta={names:['MasterWeapon'],rest:[[0,0,0,0,0,0,1,1,1,1]],frames:2,duration:2,sampleRate:.5};
  const values=new Float32Array([1,0,0,0,0,0,1,.5,.5,.5,3,0,0,0,0,0,1,.5,.5,.5]);
  const clip=decodeWeaponMotion(meta,values.buffer),track={duration:2,segments:[{clip:'original',start:0,from:0,to:2,rate:1,loops:1}]};
  const player=createWeaponMotionPlayer({motions:{clips:{original:clip},actions:{inspect:{arms:track}}},armsRig:{index:new Map([['MasterWeapon',0]]),bones:[bone]},armsScales:[[1,1,1]],gunBones:[],baseRig:{index:new Map()},Quaternion,weapon:'phantom'});
  const inspect=(at,seconds)=>({seconds,melee:[{at,inspect:true,weapon:'phantom'}],shots:[]});
  player.update(inspect(.1,.112));assert.ok(Math.abs(bone.scale.x-.95)<1e-5,'hand scale blends into inspection without a size jump');
  assert.equal(player.update(inspect(.1,1)).action,'inspect');assert.equal(bone.scale.x,.5);assert.ok(Math.abs(bone.position.x-1.9)<1e-5);
  assert.equal(player.update(inspect(.1,4)),null);assert.equal(bone.scale.x,1);
  player.update(inspect(4.1,5));assert.equal(bone.scale.x,.5);
  assert.equal(player.update(inspect(4.1,5.1),true),null);assert.equal(bone.scale.x,1);
  assert.equal(player.update(inspect(4.1,5.2)),null,'an interrupted inspection does not resume');
  player.update(inspect(6.1,7));assert.equal(bone.scale.x,.5);player.dispose();assert.equal(bone.scale.x,1);
});
