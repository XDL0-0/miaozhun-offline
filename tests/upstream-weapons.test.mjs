import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {applyUpstreamWeaponsPatch, UPSTREAM_WEAPON_RUNTIME_FILES, upstreamWeaponRuntimeSource} from '../patches/upstream-weapons.mjs';
import {createWeaponAppearance,createWeaponModelLoader} from '../patches/weapon-models-runtime.mjs';
import {animationState} from '../patches/weapon-motion-runtime.mjs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const base='upstream/aimpro-2026-11-05/';
const names=['BZPA0sSg.js','CBthEhpW.js','CU9F0OR3.js','WaGOTZ1D.js','CHhqVNl3.js','NWEv-78s.js'];
const sources=Object.fromEntries(names.map(name=>[name,read(base+'source/js/'+name)]));
const modules=applyUpstreamWeaponsPatch({...sources,'untouched.js':'native simulation'});
const between=(source,a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0&&end>start,a);return source.slice(start,end);};
const json=value=>JSON.parse(JSON.stringify(value));

test('new client bridges compile, preserve sources, and reject missing, duplicate and changed anchors',()=>{
  for(const name of names){
    assert.equal(sources[name],read(base+'source/js/'+name));
    const check=spawnSync(process.execPath,['--check','--input-type=module'],{input:modules[name],encoding:'utf8'});
    assert.equal(check.status,0,check.stderr);
  }
  assert.equal(modules['untouched.js'],'native simulation');
  assert.throws(()=>applyUpstreamWeaponsPatch({}),/missing/);
  assert.throws(()=>applyUpstreamWeaponsPatch(modules),/already applied/);
  assert.throws(()=>applyUpstreamWeaponsPatch({...sources,'BZPA0sSg.js':sources['BZPA0sSg.js']+sources['BZPA0sSg.js']}),/expected 1 anchor/);
  assert.throws(()=>applyUpstreamWeaponsPatch({...sources,'CBthEhpW.js':sources['CBthEhpW.js'].replace('So=()=>tn?.limitedAmmo===!0','So=()=>changed')}),/expected 1 anchor/);
  assert(!Object.hasOwn(modules,'Do4sYkfr.js'),'the simulation module receives no weapon edits');
});

test('runtime copies preserve one module instance and never add a second Three engine',()=>{
  for(const[name,file]of Object.entries(UPSTREAM_WEAPON_RUNTIME_FILES)){
    const source=upstreamWeaponRuntimeSource(name,read('patches/'+file));
    assert(!/from\s*['"]three/.test(source));
    assert(!source.includes('-runtime.mjs\''));
    assert.equal(spawnSync(process.execPath,['--check','--input-type=module'],{input:source}).status,0);
  }
  assert.match(modules['BZPA0sSg.js'],/fB as __aimPhysical,di as __aimHalf\}from"\.\/CqM6URxy.js"/);
});

// Execute the retained resource decoder with a local-only fetch implementation.
// No test can request the network, including when an asset is missing.
function decoder(){
  const source=read(base+'source/js/ATp_kJvD.js').replace(/export\{[^}]+\};?\s*$/,'');
  const context=vm.createContext({crypto:crypto.webcrypto,TextEncoder,TextDecoder,Response,Blob,DecompressionStream,Uint8Array,ArrayBuffer,DataView,atob,
    location:{hostname:'aimpro.world'},window:{location:{hostname:'aimpro.world'}},
    fetch:async value=>{
      const url=new URL(value,'https://aimpro.world');
      assert.equal(url.origin,'https://aimpro.world');assert.match(url.pathname,/^\/aim-viewmodel\/[\w.-]+$/);
      return new Response(fs.readFileSync(new URL(base+'client'+url.pathname,root)));
    }});
  vm.runInContext(source+';globalThis.decodeJson=we;globalThis.decodeBytes=I;',context,{timeout:2000});
  return context;
}
const codec=decoder(),packs=new Map();
async function pack(stem){
  if(!packs.has(stem))packs.set(stem,Promise.all([codec.decodeJson('/aim-viewmodel/'+stem+'.json','viewmodel'),codec.decodeBytes('/aim-viewmodel/'+stem+'.bin','viewmodel')]).then(([manifest,blob])=>({manifest,blob})));
  return packs.get(stem);
}

// Use the exact Three 185 classes exported by the new client. The slice is the
// complete native core, ending before WebGL-specific renderer declarations.
const world=read(base+'source/js/CqM6URxy.js');
const exportsByName=Object.fromEntries([...world.slice(world.lastIndexOf('export{')).matchAll(/([\w$]+) as ([\w$]+)/g)].map(match=>[match[2],match[1]]));
const threeContext=vm.createContext({console});
const core=between(world,'const ih="185"','function JE(){');
const bindings=[...sources['BZPA0sSg.js'].slice(0,sources['BZPA0sSg.js'].indexOf("from'./CqM6URxy.js'")).matchAll(/([\w$]+) as ([\w$]+)/g)].map(match=>`${match[2]}:typeof ${exportsByName[match[1]]}==='undefined'?undefined:${exportsByName[match[1]]}`);
vm.runInContext(core+';globalThis.types={'+bindings.join(',')+'};globalThis.extra={Physical:d5,half:jt};',threeContext);

function fixtureSkins(initial){
  let selected=initial;const listeners=new Set();
  return {async initialize(){},selection(weapon){const[collection,gun,theme]=(selected??'default/'+weapon).split('/');return{collection:gun===weapon?collection:'default',theme,modelEnabled:true};},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},choose(key){selected=key;for(const fn of listeners)fn();},get listeners(){return listeners.size;}};
}
function loaderFor(skins){return createWeaponModelLoader({skins,
  fetcher:async url=>{assert.match(url,/^\/skin-packs\/models\/[a-z0-9/.-]+$/);return new Response(fs.readFileSync(new URL(url.slice(1),root)));},
  makeImage(){const image={width:1,height:1,decode:async()=>{}};Object.defineProperty(image,'src',{set(){queueMicrotask(()=>image.onload?.());}});return image;},
});}
async function nativeView(key){
  const weapon=key?.split('/')[1]??'vandal',stem=weapon==='vandal'?'viewmodel':weapon==='melee'?'knife':weapon;
  const skins=fixtureSkins(key),loader=loaderFor(skins),asset=await loader.load(stem),calls=[];
  const context={...threeContext.types,console,
    // Only movement interpolation/FOV imports need defaults in this GPU-free
    // fixture; actual native skeleton, geometry, animation and materials run.
    l:{base:{maxSpeed:5},state:{undefined:{maxSpeed:1}}},U:()=>0,W:70,V:()=>60,
    __aimPhysical:threeContext.extra.Physical,__aimHalf:threeContext.extra.half,
    __aimCreateWeaponAppearance(options){const appearance=createWeaponAppearance({...options,skins,loader});calls.push({options,appearance});return appearance;},
  };
  const text=modules['BZPA0sSg.js'].replace(/import[^;]+;/g,'').replace(/export\{[^}]+\};?\s*$/,'');
  const factory=vm.runInNewContext(text+';ba',context);
  const raw=await pack(stem),Texture=threeContext.types.F;
  const model=factory({...raw,stem,appearance:asset,gunTexture:new Texture(),armsTexture:new Texture(),ak47:null});
  return{model,skins,loader,...calls[0]};
}
const frame=(seconds=0,extra={})=>({seconds,speed:0,shots:[],melee:[],adsBlend:0,gait:'walk',hidden:false,reloadSince:null,equipAt:null,...extra});

test('every retained skin constructs, animates and disposes against actual new-client rigs and Three classes',async()=>{
  const index=JSON.parse(read('skin-packs/models/index.json')),keys=Object.keys(index.models);
  assert.equal(keys.length,26);
  for(const key of keys){
    const {model,skins,options,appearance}=await nativeView(key);
    assert.equal(model.skinEffectsKey(),key,key);
    assert.equal(appearance.active,true,key);
    assert.equal(options.types.Physical,threeContext.extra.Physical);
    assert(options.parent.isGroup&&options.baseRig.bones.every(bone=>bone.isBone));
    assert(options.armsRig.index.has('R_WeaponMaster'),'new native 104-bone arms');
    model.setGun('vandal');
    assert(options.originals.filter(Boolean).every(mesh=>mesh.visible===false),key);
    for(const state of [frame(),frame(.2,{shots:[.15]}),frame(1,{melee:[{at:.9,inspect:true}]}),frame(1.2,{reloadSince:.2,reloadDuration:2.5}),frame(3,{hidden:true})])model.update(state);
    assert.equal(appearance.key,key);
    const owned=[];options.parent.traverse(node=>{if(node.name.startsWith('skin:'))owned.push(node);});
    assert(owned.length>0,key+' owns its replacement geometry');
    const disposed=new Set();for(const node of owned)if(node.geometry)node.geometry.addEventListener('dispose',()=>disposed.add(node.geometry));
    model.dispose();model.dispose();
    assert.equal(skins.listeners,0,key+' unsubscribes');
    assert.equal(appearance.active,false,key+' releases appearance');
    assert(disposed.size>0,key+' releases geometry');
  }
});

test('default selection retains the native gun; toggling a skin off restores native visibility',async()=>{
  const normal=await nativeView(null);
  assert.equal(normal.model.skinEffectsKey(),null);assert.equal(normal.appearance.active,false);
  normal.model.update(frame());normal.model.dispose();
  const skin=await nativeView('kuronami/vandal');
  const native=skin.options.originals.find(mesh=>mesh?.name==='gun:vandal');assert.equal(native.visible,false);
  skin.skins.choose(null);await skin.model.ready();assert.equal(skin.model.skinEffectsKey(),null);assert.equal(native.visible,true);skin.model.dispose();
});

test('new native reload dispatch and simulation preserve one request, weapon/phase guards and infinite ammunition',()=>{
  const game=modules['CBthEhpW.js'],gate=between(game,'So=()=>',',Jl=()=>');
  const dispatch=between(game,'const tt=ke.takeReloadPresses();',',ke.takeUsePresses()');
  const simulation=read(base+'source/js/Do4sYkfr.js');
  const reload=between(simulation,'requestReload(){','},requestUse()').slice('requestReload(){'.length);
  const complete=between(simulation,'_A>=0&&Y-_A>=io&&',',wD.length>0');
  const fire=between(simulation,'pB=(F,h)=>{',',_s=(F,h,O)=>').slice('pB='.length);
  for(const limited of[false,true]){
    const context=vm.createContext({tn:{limitedAmmo:limited},t:{phase:{current:'running'}},De:()=> 'vandal',Tl:weapon=>({canFire:weapon!=='melee'}),ke:{takeReloadPresses:()=>1},OA:()=>false,J:()=>false,ve:()=>false,Jg:()=> 'vandal',r:{},UB:true,uB:limited,kg:20,P:{magazineSize:25},_A:-1,Y:0,io:10,IA:.01,A:{rules:{}},requests:0,records:0,shots:0,qs:()=>{},et:{recordReload(){}},F:[],h:null});
    vm.runInContext(`var ${gate};var Me={requestReload(){requests++;${reload}}};var et={recordReload(){records++}};var pB=${fire};`,context);
    vm.runInContext("{"+dispatch+"}",context);assert.equal(context.requests,1);assert.equal(context.records,1);assert.equal(context._A,0);
    context.Y=4;vm.runInContext("{"+dispatch+"}",context);assert.equal(context._A,0,'repeat cannot restart native reload');
    for(let tick=1;tick<10;tick++){context.Y=tick;vm.runInContext(complete,context);assert.equal(context._A,0);}
    context.Y=10;vm.runInContext(complete,context);assert.equal(context._A,-1);assert.equal(context.kg,25);
    context.De=()=> 'melee';vm.runInContext("{"+dispatch+"}",context);assert.equal(context.requests,2);
    context.De=()=> 'vandal';context.t.phase.current='paused';vm.runInContext("{"+dispatch+"}",context);assert.equal(context.requests,2);
    context.uB=false;context.kg=25;vm.runInContext('pB(F,h);',context);assert.equal(context.kg,25,'unlimited ammunition remains unlimited');
  }
});

test('native inspect event preserves weapon identity and portable animation interrupts on fire, reload, equip and ADS',()=>{
  const code=between(modules['CBthEhpW.js'],'const Un=ke.takeInspectPresses()>0;','if(Wt>0&&');
  const events=[],context={ke:{takeInspectPresses:()=>1},Et:false,Tl:()=>({canFire:true}),t:{phase:{current:'running'}},N:()=>false,ae:()=>false,Me:{tick:9},we:.01,De:()=> 'vandal',ma:event=>events.push(event)};
  vm.runInNewContext(code,context);assert.deepEqual(json(events),[{at:.1,inspect:true,weapon:'vandal'}]);
  const actions={inspect:{arms:{duration:3}},reload:{arms:{duration:2}},fire:{arms:{duration:.3}}};
  const state={seconds:.5,melee:events,shots:[]};assert.equal(animationState(actions,state,'vandal').action,'inspect');
  assert.notEqual(animationState(actions,{...state,shots:[.4]},'vandal')?.action,'inspect');
  assert.equal(animationState(actions,{...state,reloadSince:.2,reloadDuration:4},'vandal').action,'reload');
  assert.notEqual(animationState(actions,{...state,equipAt:.4},'vandal')?.action,'inspect');
  assert.notEqual(animationState(actions,{...state,adsBlend:1},'vandal')?.action,'inspect');
});

test('actual new audio class falls back to native sound and stops owned kill voices on disposal',()=>{
  const source=between(modules['CBthEhpW.js'],'class ug{','const dg=32.5');let fire=0,resets=0,stops=0,ends=0,disconnects=0;
  const context={fs:{enabled:true,volume:1},lg:()=>({clear(){}}),__aimSkins:{setActiveWeapon(){},playFire:()=>false,playKill:()=>null,reset(){resets++;}},$1(){stops++;},vr:()=>true,K1:()=>null};
  const Class=vm.runInNewContext(source+';ug',context),audio=new Class();audio.ensure=()=>({context:{currentTime:5},master:{}});audio.fire=()=>fire++;
  audio.playFire('vandal');assert.equal(fire,1);
  context.__aimSkins.playFire=()=>true;audio.playFire('vandal');assert.equal(fire,1);
  const voice={source:{onended(){ends++;}},gain:{disconnect(){disconnects++;}}};context.__aimSkins.playKill=()=>voice;
  assert.equal(audio.playKill(1,'vandal'),true);voice.source.onended();assert.equal(ends,1);assert.equal(disconnects,1);assert.equal(audio.killVoice,null);
  audio.playKill(2,'vandal');audio.dispose();assert.equal(stops,1);assert.equal(resets,1);
});

test('new settings host mounts once and releases the portable panel on removal',()=>{
  const setup=between(modules['CU9F0OR3.js'],'let __aimSkinHost=null,','function d7(dH)');
  const mounts=[],disposed=[],current={enabled:true,volume:.5};
  const mount=vm.runInNewContext(setup+';__aimMountSkinHost',{d6:{value:current},__aimMountSkins(host,audio){mounts.push([host,audio()]);return()=>disposed.push(host);}});
  const first={},second={};mount(first);mount(first);assert.equal(mounts.length,1);assert.equal(mounts[0][1],current);
  mount(second);assert.deepEqual(disposed,[first]);mount(null);assert.deepEqual(disposed,[first,second]);
});

test('new banner selects a ready skin and preserves the native display toggle and fallback',()=>{
  const definition=between(modules['WaGOTZ1D.js'],'function la(cC,','const Ut=');
  const skins={bannerDefinition:key=>key==='skin:ready'?{composite:'decoded'}:null,bannerKit:()=> 'skin:ready'};
  const define=vm.runInNewContext(definition+';la',{__aimSkins:skins,rl:{},dl:null,ul:{native:{dir:'native',radius:60,headshot:[0,0]}},na:[]});
  assert.deepEqual(json(define('skin:ready')),{composite:'decoded'});assert.equal(define('missing'),null);assert.equal(define('native').pipRadius,30);
  const selected=between(modules['WaGOTZ1D.js'],'const cT=bz(()=>{__aimSkinRevision.value;','),cU=ae(')+')';
  const state={displaySettings:{value:{killBanners:true}},audioSettings:{value:{killKit:'native'}}};
  const choose=vm.runInNewContext(selected+';cT',{__aimSkinRevision:{value:0},__aimSkins:skins,cD:state,M:key=>key==='native',la:define,bz:fn=>fn});
  assert.equal(choose(),'skin:ready');skins.bannerKit=()=>null;assert.equal(choose(),'native');state.displaySettings.value.killBanners=false;assert.equal(choose(),null);
  const dispose=modules['NWEv-78s.js'].match(/'dispose'\(\)\{([^}]+)\}/)?.[1];assert(dispose);
  const released=[];vm.runInNewContext(dispose,{o:{dispose(){released.push('model');}},q:{dispose(){released.push('effects');}},m:{dispose(){released.push('renderer');},forceContextLoss(){released.push('context');}}});
  assert.deepEqual(released,['model','effects','renderer','context']);
});
