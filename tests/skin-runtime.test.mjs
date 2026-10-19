import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {SKIN_WEAPONS,createSkinPackRuntime,drawCompositeBanner,killIndex} from '../patches/skin-packs-runtime.mjs';
import {applySkinPacksPatch} from '../patches/skin-packs.mjs';
import {applyInterpolationPatch} from '../patches/interpolation.mjs';
import {applyHudPatch} from '../patches/hud.mjs';
import {applyFrameratePatch} from '../patches/framerate.mjs';
import {applyPrewarmPatch} from '../patches/prewarm.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const oraThemes=['base','watch','renegade','raja','ignition'];
function theme(collection,id,weapons){
  const base=`/skin-packs/${collection}/themes/${id}`;
  return {id,label:id,fire:Object.fromEntries(weapons.map(weapon=>[weapon,`${base}/${weapon}-fire.ogg`])),
    kills:Object.fromEntries([1,2,3,4,5].map(count=>[count,`${base}/kill-${count}.ogg`])),
    successive:`${base}/successive.ogg`,banners:[{id:'default',label:'Default',url:`${base}/banner.png`},{id:'alternate',label:'Alternate',url:`${base}/alternate.png`}],missing:[]};
}
function fixture(){
  return {schemaVersion:2,collections:[
    {id:'ora-by-onetap',name:'ORA by OneTap',tier:'Ultra',weapons:[...SKIN_WEAPONS],themes:oraThemes.map(id=>theme('ora-by-onetap',id,SKIN_WEAPONS))},
    {id:'prelude-to-chaos',name:'Prelude to Chaos',tier:'Exclusive',weapons:['vandal'],themes:[theme('prelude-to-chaos','default',['vandal'])]},
    {id:'mystbloom',name:'Mystbloom',tier:'Exclusive',weapons:['phantom'],themes:[theme('mystbloom','default',['phantom'])]},
  ]};
}
function memoryStorage(){
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};
}
function audioContext(time=12){
  const context={state:'running',currentTime:time,destination:{type:'destination'},sources:[],gains:[],resumes:0,
    async resume(){this.resumes++;this.state='running'},async close(){this.state='closed'},
    createBufferSource(){
      const source={buffer:null,connections:[],starts:[],stops:[],disconnects:0,
        connect(node){this.connections.push(node);return node},disconnect(){this.disconnects++},
        start(at){this.starts.push(at)},stop(at){this.stops.push(at)}};
      context.sources.push(source);return source;
    },
    createGain(){
      const events=[];
      const gain={value:1,cancelScheduledValues:at=>events.push(['cancel',at]),
        setValueAtTime(value,at){events.push(['set',value,at]);this.value=value},
        linearRampToValueAtTime:(value,at)=>events.push(['ramp',value,at])};
      const output={gain,events,connections:[],disconnects:0,connect(node){this.connections.push(node);return node},disconnect(){this.disconnects++}};
      context.gains.push(output);return output;
    }};
  return context;
}
function harness(manifest=fixture(),storage=memoryStorage(),options={}){
  const fetches=new Map(),decodes=new Map(),imageLoads=new Map(),fetchFailures=new Map(),decodeFailures=new Set(),imageFailures=new Set(),fetchGates=new Map(),decodeGates=new Map(),bodyGates=new Map(),imageDecodeGates=new Map(),signals=new Map();
  const contexts=[],imageDecodes=new Map();let decoderCreations=0;
  const increment=(map,key)=>map.set(key,(map.get(key)??0)+1);
  const runtime=createSkinPackRuntime({...options,storage,
    async fetcher(url,{signal}={}){
      if(signal)signals.set(url,signal);
      increment(fetches,url);await fetchGates.get(url)?.promise;
      const failure=fetchFailures.get(url);
      if(failure instanceof Error)throw failure;
      if(failure)return {ok:false,status:failure};
      if(url==='/skin-packs/index.json'){
        const value=clone(manifest);return {ok:true,json:async()=>{await bodyGates.get(url)?.promise;return value}};
      }
      return {ok:true,arrayBuffer:async()=>{await bodyGates.get(url)?.promise;return new TextEncoder().encode(url).buffer}};
    },
    makeDecoder(){decoderCreations++;return {async decodeAudioData(bytes){
      const url=new TextDecoder().decode(bytes);increment(decodes,url);await decodeGates.get(url)?.promise;
      if(decodeFailures.has(url))throw Error('synthetic decode error');
      return {url,duration:.4};
    }}},
    makeImage(){return {complete:false,naturalWidth:0,naturalHeight:0,
      set src(url){this.url=url;increment(imageLoads,url);queueMicrotask(()=>{
        if(imageFailures.has(url)){this.onerror?.();return}
        this.complete=true;this.naturalWidth=300;this.naturalHeight=300;void this.onload?.();
      })},
      async decode(){increment(imageDecodes,this.url);await imageDecodeGates.get(this.url)?.promise},
    }},
    makeAudio(){const context=audioContext();contexts.push(context);return context},
  });
  return {runtime,manifest,storage,fetches,decodes,imageLoads,imageDecodes,fetchFailures,decodeFailures,imageFailures,fetchGates,decodeGates,bodyGates,imageDecodeGates,signals,contexts,
    counts:()=>({fetches:[...fetches],decodes:[...decodes],images:[...imageLoads],imageDecodes:[...imageDecodes]}),
    get decoderCreations(){return decoderCreations}};
}
const pick=(runtime,weapon,collection='ora-by-onetap',theme='base',extra={})=>runtime.select(weapon,{collection,theme,...extra});
const selectedTheme=(h,collection='ora-by-onetap',theme='base')=>h.manifest.collections.find(item=>item.id===collection).themes.find(item=>item.id===theme);
const firedUrl=context=>context.sources.at(-1)?.buffer?.url;

test('manifest initialization is deduplicated, validates schema and retries after failure',async()=>{
  const h=harness(),gate=deferred();h.fetchGates.set('/skin-packs/index.json',gate);
  const first=h.runtime.initialize(),second=h.runtime.initialize();
  assert.equal(h.fetches.get('/skin-packs/index.json'),1);gate.resolve();
  const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal(a.schemaVersion,2);
  await h.runtime.initialize();assert.equal(h.fetches.get('/skin-packs/index.json'),1);
  const broken=harness();broken.fetchFailures.set('/skin-packs/index.json',503);
  assert.equal(await broken.runtime.initialize(),null);assert.match(broken.runtime.manifestError,/503/);
  const context=audioContext(),master=context.createGain();
  assert.equal(broken.runtime.playFire(context,master,'vandal',1),false);
  assert.equal(broken.runtime.playKill(context,master,'vandal',1,1),null);
  broken.fetchFailures.delete('/skin-packs/index.json');await broken.runtime.prepare();
  assert.equal(broken.runtime.manifestError,'');assert.equal(broken.fetches.get('/skin-packs/index.json'),2);
  const invalid=fixture();invalid.schemaVersion=1;const bad=harness(invalid);
  assert.equal(await bad.runtime.initialize(),null);assert.match(bad.runtime.manifestError,/版本/);
});

test('selections filter weapons and persist each gun, theme, banner and toggles independently',async()=>{
  const storage=memoryStorage(),h=harness(fixture(),storage);await h.runtime.initialize();
  await pick(h.runtime,'vandal','ora-by-onetap','raja',{banner:'alternate',fireEnabled:false,bannerEnabled:false});
  await pick(h.runtime,'phantom','mystbloom','default',{killEnabled:false});
  const savedVandal=h.runtime.selection('vandal'),savedPhantom=h.runtime.selection('phantom');
  assert.equal(savedVandal.theme,'raja');assert.equal(savedVandal.banner,'alternate');assert.equal(savedVandal.fireEnabled,false);
  assert.equal(savedPhantom.collection,'mystbloom');assert.equal(savedPhantom.killEnabled,false);
  assert.equal(h.runtime.selection('sheriff').collection,'default');
  assert.throws(()=>pick(h.runtime,'phantom','prelude-to-chaos','default'),/does not support phantom/);
  assert.throws(()=>pick(h.runtime,'ghost','ora-by-onetap','base'),/Unsupported/);
  assert.deepEqual(h.runtime.selection('phantom'),savedPhantom,'rejected selection must not replace current gun');
  const reloaded=harness(fixture(),storage);await reloaded.runtime.initialize();
  assert.deepEqual(reloaded.runtime.selection('vandal'),savedVandal);assert.deepEqual(reloaded.runtime.selection('phantom'),savedPhantom);
  await h.runtime.select('vandal',{collection:'default'});
  assert.deepEqual(h.runtime.selection('vandal'),{collection:'default',theme:'default',banner:'default',fireEnabled:true,killEnabled:true,bannerEnabled:true});
  assert.deepEqual(h.runtime.selection('phantom'),savedPhantom);
});

test('ready player gunfire switches by gun and selection without fetching, decoding or images on playback',async()=>{
  const h=harness();await h.runtime.initialize();
  await pick(h.runtime,'vandal','prelude-to-chaos','default');await pick(h.runtime,'phantom','mystbloom','default');
  const context=audioContext(),master=context.createGain(),before=h.counts();
  for(let i=0;i<12;i++){
    const weapon=i%2?'phantom':'vandal';
    assert.equal(h.runtime.playFire(context,master,weapon,20+i*.05),true);
    assert.match(firedUrl(context),new RegExp(weapon==='vandal'?'prelude-to-chaos':'mystbloom'));
    assert.equal(context.sources.at(-1).starts[0],20+i*.05);
  }
  assert.equal(h.runtime.playFire(context,master,'sheriff',21),false);
  assert.equal(h.runtime.playFire(context,master,'ghost',21),false);
  assert.deepEqual(h.counts(),before,'playback must perform no asynchronous resource work');
  await h.runtime.select('vandal',{fireEnabled:false});
  assert.equal(h.runtime.playFire(context,master,'vandal',22),false);
  assert.equal(h.runtime.playKill(context,master,'vandal',1,22)?.source.buffer.url,selectedTheme(h,'prelude-to-chaos','default').kills[1]);
  await h.runtime.select('vandal',{collection:'default'});assert.equal(h.runtime.playFire(context,master,'vandal',22),false);
});

test('every ORA theme selects its own fire, five kill clips and banner for all four supported guns',async()=>{
  const h=harness();await h.runtime.initialize();const context=audioContext(),master=context.createGain();
  for(const id of oraThemes)for(const weapon of SKIN_WEAPONS){
    await pick(h.runtime,weapon,'ora-by-onetap',id);
    const data=selectedTheme(h,'ora-by-onetap',id),before=h.counts();
    assert.equal(h.runtime.playFire(context,master,weapon,30),true);assert.equal(firedUrl(context),data.fire[weapon]);
    for(let kill=1;kill<=5;kill++)assert.equal(h.runtime.playKill(context,master,weapon,kill,30+kill)?.source.buffer.url,data.kills[kill]);
    h.runtime.setActiveWeapon(weapon);const kit=h.runtime.bannerKit();assert.equal(kit,'skin:'+data.banners[0].url);
    assert.equal(h.runtime.bannerDefinition(kit)?.composite,data.banners[0].url);
    assert.equal(h.runtime.getImage(data.banners[0].url)?.complete,true);
    assert.deepEqual(h.counts(),before);
  }
  assert.equal(h.decoderCreations,1,'all gun selections can share one decoding context');
});

test('game kill clips loop 1–5 after five kills while the optional sixth clip remains an explicit preview',async()=>{
  const data=fixture();data.collections[0].themes[0].kills[6]='/skin-packs/ora-by-onetap/themes/base/kill-6.ogg';
  const h=harness(data);await h.runtime.initialize();await pick(h.runtime,'vandal');
  const context=audioContext(),master=context.createGain(),expected=[1,2,3,4,5,1,2,3,4,5,1,2],before=h.counts();
  const actual=expected.map((_,i)=>h.runtime.playKill(context,master,'vandal',i+1,40+i)?.source.buffer.url);
  assert.deepEqual(actual,expected.map(kill=>selectedTheme(h).kills[kill]));
  assert.deepEqual(h.counts(),before);
  assert.deepEqual([0,-1,NaN,1.9,5,6,10,11].map(killIndex),[1,1,1,1,5,1,5,1]);
  await h.runtime.audition('vandal','kill',6,{volume:.4});assert.equal(firedUrl(h.contexts[0]),selectedTheme(h).kills[6]);
  await h.runtime.select('vandal',{killEnabled:false});assert.equal(h.runtime.playKill(context,master,'vandal',1,55),null);
});

test('continuous audition schedules the five actual clips, fades prior voices and stops when selection changes',async()=>{
  const h=harness();await h.runtime.initialize();await pick(h.runtime,'vandal');
  assert.equal(await h.runtime.audition('vandal','sequence',1,{enabled:true,volume:.6}),true);
  const context=h.contexts[0],voices=context.sources,base=context.currentTime+.02;
  assert.deepEqual(voices.map(source=>source.buffer.url),[1,2,3,4,5].map(kill=>selectedTheme(h).kills[kill]));
  voices.forEach((source,i)=>assert.equal(source.starts[0],base+i*.9));
  for(let i=0;i<4;i++)assert.equal(voices[i].stops[0],base+(i+1)*.9+.03);
  await pick(h.runtime,'vandal','ora-by-onetap','watch');assert(voices.every(source=>source.stops.includes(undefined)));
  await h.runtime.audition('vandal','successive',1,{volume:.6});assert.equal(firedUrl(context),selectedTheme(h,'ora-by-onetap','watch').successive);
  h.runtime.stopAudition();assert(context.sources.at(-1).stops.includes(undefined));
  await assert.rejects(h.runtime.audition('vandal','fire',1,{enabled:false}),/开启/);
  await assert.rejects(h.runtime.audition('vandal','fire',1,{volume:0}),/音量/);
});

test('missing, HTTP, thrown network, decode and image failures fall back and recover with explicit preload retry',async()=>{
  const data=fixture(),theme=data.collections[0].themes[0];theme.fire.sheriff=null;theme.kills[3]=null;
  const h=harness(data);await h.runtime.initialize();
  h.fetchFailures.set(theme.fire.vandal,404);h.fetchFailures.set(theme.kills[2],Error('offline'));
  h.decodeFailures.add(theme.kills[4]);h.imageFailures.add(theme.banners[0].url);
  await pick(h.runtime,'vandal');await pick(h.runtime,'sheriff');h.runtime.setActiveWeapon('vandal');
  const context=audioContext(),master=context.createGain(),before=h.counts();
  assert.equal(h.runtime.playFire(context,master,'vandal',1),false);assert.equal(h.runtime.playFire(context,master,'sheriff',1),false);
  for(const kill of [2,3,4])assert.equal(h.runtime.playKill(context,master,'vandal',kill,1),null);
  assert(h.runtime.playKill(context,master,'vandal',1,1));assert.equal(h.runtime.bannerKit(),null);
  assert.deepEqual(h.runtime.availability('vandal'),{fire:'failed',kills:['ready','failed','missing','failed','ready'],banner:'failed'});
  assert.equal(h.runtime.availability('sheriff').fire,'missing');assert.deepEqual(h.counts(),before);
  h.fetchFailures.clear();h.decodeFailures.clear();h.imageFailures.clear();await h.runtime.prepare();
  assert.equal(h.runtime.playFire(context,master,'vandal',2),true);
  assert(h.runtime.playKill(context,master,'vandal',2,2));assert(h.runtime.playKill(context,master,'vandal',4,2));assert(h.runtime.bannerKit());
  assert.equal(h.runtime.availability('vandal').kills[2],'missing','an absent clip still falls back after a retry');
  assert.equal(h.fetches.get(theme.kills[1]),1,'successful clips stay cached across retries');
});

test('concurrent prepare and selection requests deduplicate in-flight audio and image work',async()=>{
  const h=harness();await h.runtime.initialize();const url=selectedTheme(h).fire.vandal,gate=deferred();h.decodeGates.set(url,gate);
  const selected=pick(h.runtime,'vandal');await turn();assert.equal(h.decodes.get(url),1);
  const again=pick(h.runtime,'vandal'),preparing=h.runtime.prepare();await turn();
  assert.equal(h.fetches.get(url),1);assert.equal(h.decodes.get(url),1);
  gate.resolve();await Promise.all([selected,again,preparing]);
  for(const count of h.fetches.values())assert.equal(count,1);
  for(const count of h.decodes.values())assert.equal(count,1);
  for(const count of h.imageLoads.values())assert.equal(count,1);
});

test('late decoded audio from the old ORA theme never replaces the current selection or plays on the fire path',async()=>{
  const h=harness();await h.runtime.initialize();const old=selectedTheme(h),gate=deferred();h.decodeGates.set(old.fire.vandal,gate);
  const selectingOld=pick(h.runtime,'vandal');await turn();
  const context=audioContext(),master=context.createGain(),before=h.counts();
  assert.equal(h.runtime.playFire(context,master,'vandal',1),false,'in-flight resources fall back synchronously');assert.deepEqual(h.counts(),before);
  await pick(h.runtime,'vandal','ora-by-onetap','watch');assert.equal(h.runtime.playFire(context,master,'vandal',2),true);
  assert.equal(firedUrl(context),selectedTheme(h,'ora-by-onetap','watch').fire.vandal);
  gate.resolve();await selectingOld;assert.equal(h.runtime.selection('vandal').theme,'watch');
  assert.equal(h.runtime.playFire(context,master,'vandal',3),true);assert.equal(firedUrl(context),selectedTheme(h,'ora-by-onetap','watch').fire.vandal);
  assert.equal(h.runtime.playKill(context,master,'vandal',1,3)?.source.buffer.url,selectedTheme(h,'ora-by-onetap','watch').kills[1]);
  h.runtime.setActiveWeapon('vandal');assert.equal(h.runtime.bannerKit(),'skin:'+selectedTheme(h,'ora-by-onetap','watch').banners[0].url);
});

test('stalled response bodies, audio decoding and image decoding cannot hold readiness or publish a late ready cache',{timeout:1000},async()=>{
  const h=harness(fixture(),memoryStorage(),{timeoutMs:10});await h.runtime.initialize();
  const theme=selectedTheme(h),body=deferred(),audio=deferred(),image=deferred();
  h.bodyGates.set(theme.fire.vandal,body);h.decodeGates.set(theme.kills[2],audio);h.imageDecodeGates.set(theme.banners[0].url,image);
  await pick(h.runtime,'vandal');h.runtime.setActiveWeapon('vandal');
  assert.equal(h.runtime.availability('vandal').fire,'failed');assert.equal(h.runtime.availability('vandal').kills[1],'failed');assert.equal(h.runtime.availability('vandal').banner,'failed');
  const context=audioContext(),master=context.createGain();
  assert.equal(h.runtime.playFire(context,master,'vandal',1),false);assert.equal(h.runtime.playKill(context,master,'vandal',2,1),null);assert.equal(h.runtime.bannerKit(),null);
  body.resolve();audio.resolve();image.resolve();await turn();await turn();
  assert.equal(h.runtime.playFire(context,master,'vandal',2),false,'timed-out body must not publish into the audio cache later');
  assert.equal(h.runtime.playKill(context,master,'vandal',2,2),null,'timed-out decode must not publish into the audio cache later');
  assert.equal(h.runtime.bannerKit(),null,'late image.decode completion must not publish into the image cache');
  assert.equal(h.runtime.availability('vandal').fire,'failed');assert.equal(h.runtime.availability('vandal').kills[1],'failed');assert.equal(h.runtime.availability('vandal').banner,'failed');
  h.bodyGates.clear();h.decodeGates.clear();h.imageDecodeGates.clear();await h.runtime.prepare();
  assert.equal(h.runtime.playFire(context,master,'vandal',3),true);assert(h.runtime.playKill(context,master,'vandal',2,3));assert(h.runtime.bannerKit());
});

test('manifest fetch and JSON body deadlines fall back and late old responses cannot overwrite a successful retry',{timeout:1000},async()=>{
  for(const stalled of ['headers','json']){
    const h=harness(fixture(),memoryStorage(),{timeoutMs:10}),gate=deferred();
    (stalled==='headers'?h.fetchGates:h.bodyGates).set('/skin-packs/index.json',gate);
    assert.equal(await h.runtime.initialize(),null);assert.equal(h.runtime.manifest,null);assert.match(h.runtime.manifestError,/超时/);
    assert.equal(h.signals.get('/skin-packs/index.json')?.aborted,true);
    h.fetchGates.clear();h.bodyGates.clear();h.manifest.collections[0].name='Updated after retry';
    assert(await h.runtime.initialize());assert.equal(h.runtime.manifest.collections[0].name,'Updated after retry');
    gate.resolve();await turn();await turn();
    assert.equal(h.runtime.manifest.collections[0].name,'Updated after retry');assert.equal(h.runtime.manifestError,'');
    assert.equal(h.fetches.get('/skin-packs/index.json'),2);
  }
});

test('banner switching, reset and unsupported weapons preserve saved selections and decoded cache',async()=>{
  const h=harness();await h.runtime.initialize();await pick(h.runtime,'vandal');await pick(h.runtime,'phantom','mystbloom','default');
  h.runtime.setActiveWeapon('vandal');const old=h.runtime.bannerKit();assert(old);
  await h.runtime.select('vandal',{banner:'alternate'});assert.notEqual(h.runtime.bannerKit(),old);
  h.runtime.setActiveWeapon('phantom');assert.match(h.runtime.bannerKit(),/mystbloom/);
  await h.runtime.select('phantom',{bannerEnabled:false});assert.equal(h.runtime.bannerKit(),null);
  h.runtime.setActiveWeapon('ghost');assert.equal(h.runtime.bannerKit(),null);
  assert.equal(h.runtime.bannerDefinition('skin:https://example.com/banner.png'),null);
  h.runtime.setActiveWeapon('vandal');await h.runtime.audition('vandal','fire',1);
  const selection=h.runtime.selection('vandal'),before=h.counts();h.runtime.reset();
  assert.equal(h.runtime.bannerKit(),null);assert.deepEqual(h.runtime.selection('vandal'),selection);
  assert(h.contexts[0].sources.at(-1).stops.includes(undefined));
  const context=audioContext();assert.equal(h.runtime.playFire(context,context.createGain(),'vandal',1),true);assert.deepEqual(h.counts(),before);
});

test('unsafe media URLs are never fetched or played and invalid saved gun selections revert to default',async()=>{
  const data=fixture(),theme=data.collections[0].themes[0];
  theme.fire.vandal='https://example.com/fire.ogg';theme.kills[1]='/skin-packs/../../escape.ogg';theme.banners[0].url='data:image/png;base64,bad';
  const storage=memoryStorage();storage.setItem('aim-offline.skin-packs.v2',JSON.stringify({phantom:{collection:'prelude-to-chaos',theme:'default'},vandal:{collection:'unknown'}}));
  const h=harness(data,storage);await h.runtime.initialize();
  assert.equal(h.runtime.selection('phantom').collection,'default');assert.equal(h.runtime.selection('vandal').collection,'default');
  await pick(h.runtime,'vandal');const context=audioContext(),master=context.createGain();
  assert.equal(h.runtime.playFire(context,master,'vandal',1),false);assert.equal(h.runtime.playKill(context,master,'vandal',1,1),null);
  assert(!h.fetches.has(theme.fire.vandal));assert(!h.fetches.has(theme.kills[1]));assert(!h.imageLoads.has(theme.banners[0].url));
});

test('composite canvas draws a complete banner, modulo-five pips, headshot feedback and the correct pixel density',()=>{
  const calls=[],context={setTransform:(...args)=>calls.push(['transform',...args]),clearRect:(...args)=>calls.push(['clear',...args]),save:()=>calls.push(['save']),restore:()=>calls.push(['restore']),drawImage:(...args)=>calls.push(['image',...args]),beginPath:()=>{},arc:(...args)=>calls.push(['arc',...args]),fill:()=>calls.push(['fill']),fillText:(...args)=>calls.push(['text',...args])};
  const canvas={clientWidth:150,width:1,height:1},image={complete:true,naturalWidth:300,naturalHeight:300},animation={scale:1,alpha:.8,newPipScale:1.8};
  assert.equal(drawCompositeBanner(canvas,context,image,animation,7,true,2),true);
  assert.equal(canvas.width,300);assert.equal(canvas.height,300);assert.equal(context.globalAlpha,.8);
  assert.equal(calls.filter(call=>call[0]==='image').length,1);assert.equal(calls.find(call=>call[0]==='image')[1],image);
  const pips=calls.filter(call=>call[0]==='arc');assert.equal(pips.length,2);assert.equal(pips[0][1],-pips[1][1]);assert(pips[1][3]>pips[0][3]);
  assert.equal(calls.filter(call=>call[0]==='fill').length,2);assert(calls.some(call=>call[0]==='text'&&call[1]==='HEADSHOT'));
  assert.deepEqual(calls.filter(call=>call[0]==='transform').at(-1),['transform',1,0,0,1,150,150]);
  calls.length=0;drawCompositeBanner(canvas,context,image,animation,10,false,1);assert.equal(calls.filter(call=>call[0]==='arc').length,5);assert(!calls.some(call=>call[0]==='text'));
  calls.length=0;assert.equal(drawCompositeBanner(canvas,context,{complete:false,naturalWidth:0},animation,1,true),false);assert.equal(calls.length,0);
});

const moduleNames=['CymPR-fm.js','DCKWp-_u.js','DVK7uRSu.js','aQOfOAp-.js','tmIeW3Ig.js'];
const originals=Object.fromEntries(moduleNames.map(name=>[name,fs.readFileSync(new URL('../site/js/'+name,import.meta.url),'utf8')]));
const prepared=applyPrewarmPatch(applyFrameratePatch(applyHudPatch(applyInterpolationPatch(originals))));
const patched=applySkinPacksPatch(prepared);
function nativeFade(){
  const source=originals['DCKWp-_u.js'],start=source.indexOf('function Bm(e,t){'),end=source.indexOf('const zd=',start);
  return vm.runInNewContext('('+source.slice(start,end)+')');
}
function audioBridge(source,runtime,{enabled=true,volume=.7,killSound=true,killKit='skinGaia',weapons=null}={}){
  const context=audioContext(),events=[],settings={enabled,volume,killSound,killKit,fireKit:'gunVandal',hitSound:true,hitKit:'ding'};
  const createNativeKill=(ctx,master,kit,kills,at)=>{
    events.push(['native-kill',kit,kills]);const voice={source:ctx.createBufferSource(),gain:ctx.createGain()};
    voice.source.buffer={url:'native:'+kit+'/'+kills};voice.source.connect(voice.gain).connect(master);voice.source.start(at);return voice;
  };
  const globals={__aimSkins:runtime,on:settings,ch:'/jam.ogg',C0:()=>null,lh:()=>({clear(){}}),
    Audio:class{addEventListener(){}pause(){}play(){return Promise.resolve()}},AudioContext:function(){return context},
    Oa:weapon=>events.push(['warm-weapon',weapon]),Na:kit=>['skinGaia','skinChaos','skinChampions21'].includes(kit),Dr:()=>{},Or:()=>false,Ff:()=>{},fl:()=>{},
    Df:(ctx,master,weapon,at)=>{events.push(['native-fire',weapon,at]);return true},Nr:(ctx,master,kit,at)=>events.push(['synthetic-fire',kit,at]),Of:()=> 'heavy',Nf:()=>false,
    Bf:createNativeKill,Vf:nativeFade(),Hf:()=>{},Uf:()=>{},pl:()=>{},fh:()=>1,window:{setTimeout(){}},
  };
  const start=source.indexOf('class $i{'),end=source.indexOf('const ph=',start);assert(start>=0&&end>start);
  const AudioClass=vm.runInNewContext('('+source.slice(start,end)+')',globals),audio=new AudioClass({current:settings});
  audio.weaponSounds=weapons;return {audio,context,events,settings};
}

test('actual injected audio class preserves native defaults and uses ready skin fire only for the actual player weapon',async()=>{
  const h=harness();await h.runtime.initialize();
  const before=audioBridge(originals['CymPR-fm.js'],h.runtime),after=audioBridge(patched['CymPR-fm.js'],h.runtime);
  before.audio.playFire(null);after.audio.playFire(null,'vandal');assert.deepEqual(after.events,before.events);
  assert.equal(after.audio.playKill(1,'vandal'),before.audio.playKill(1));assert.equal(after.context.sources.length,0);
  await pick(h.runtime,'vandal');const counts=h.counts();
  after.events.length=0;after.audio.playFire(null,'vandal');assert.equal(firedUrl(after.context),selectedTheme(h).fire.vandal);assert.equal(after.events.length,0);
  after.audio.playFire('phantom','phantom');assert(after.events.some(event=>event[0]==='native-fire'&&event[1]==='phantom'));
  assert.equal(after.audio.playKill(1,'vandal'),true);assert.equal(firedUrl(after.context),selectedTheme(h).kills[1]);assert.deepEqual(h.counts(),counts);
});

test('actual injected audio class honors master mute and kill toggle and preserves native missing-media fallbacks',async()=>{
  const data=fixture(),theme=data.collections[0].themes[0];theme.fire.vandal=null;theme.kills[1]=null;
  const h=harness(data);await h.runtime.initialize();await pick(h.runtime,'vandal');
  for(const options of [{enabled:false},{volume:0}]){
    const bridge=audioBridge(patched['CymPR-fm.js'],h.runtime,options);bridge.audio.playFire('vandal','vandal');
    assert.equal(bridge.audio.playKill(1,'vandal'),false);assert.equal(bridge.context.sources.length,0);assert.equal(bridge.events.length,0);assert.equal(bridge.audio.context,null);
  }
  const mutedKill=audioBridge(patched['CymPR-fm.js'],h.runtime,{killSound:false,weapons:['vandal']});
  assert.equal(mutedKill.audio.playKill(2,'vandal'),false);assert.equal(mutedKill.audio.context,null);
  const bridge=audioBridge(patched['CymPR-fm.js'],h.runtime,{weapons:['vandal']});bridge.audio.playFire('vandal','vandal');
  assert(bridge.events.some(event=>event[0]==='native-fire'&&event[1]==='vandal'));
  assert.equal(bridge.audio.playKill(1,'vandal'),true);assert.equal(firedUrl(bridge.context),'native:skinGaia/1');
  const none=audioBridge(patched['CymPR-fm.js'],h.runtime,{killKit:'none',weapons:['vandal']});assert.equal(none.audio.playKill(1,'vandal'),false);
});

test('actual injected kill bridge fades previous voices, retains newer ownership and releases native and skin voices',async()=>{
  const h=harness();await h.runtime.initialize();await pick(h.runtime,'vandal');
  const bridge=audioBridge(patched['CymPR-fm.js'],h.runtime,{weapons:['vandal']});
  assert.equal(bridge.audio.playKill(1,'vandal'),true);const first=bridge.audio.killVoice;
  bridge.context.currentTime=13;assert.equal(bridge.audio.playKill(2,'vandal'),true);const second=bridge.audio.killVoice;
  assert.notEqual(first,second);assert.equal(first.source.stops.at(-1),13.03);assert(first.gain.events.some(event=>event[0]==='ramp'&&event[1]===0&&event[2]===13.03));
  first.source.onended();assert.equal(bridge.audio.killVoice,second);assert(first.source.disconnects>0);assert(first.gain.disconnects>0);
  second.source.onended();assert.equal(bridge.audio.killVoice,null);
  await h.runtime.select('vandal',{collection:'default'});assert.equal(bridge.audio.playKill(3,'vandal'),true);
  const native=bridge.audio.killVoice;native.source.onended();assert.equal(bridge.audio.killVoice,null);assert(native.gain.disconnects>0);
  await pick(h.runtime,'vandal');assert.equal(bridge.audio.playKill(1,'vandal'),true);const final=bridge.audio.killVoice;
  h.runtime.setActiveWeapon('vandal');bridge.audio.dispose();assert.equal(bridge.context.state,'closed');assert.equal(bridge.audio.killVoice,null);assert(final.source.stops.length>0);assert.equal(h.runtime.bannerKit(),null);
});

test('actual settings injection mounts once per host, reads current master settings and cleans up on ref removal and unmount',()=>{
  const source=patched['DCKWp-_u.js'],start=source.indexOf('const zd=J({__name:"AudioPanel"'),end=source.indexOf(',Wd=J(',start);
  assert(start>=0&&end>start);
  const audioSettings={value:{enabled:false,volume:.7}},mounts=[],disposed=[];let unmount;
  const vnode=(type,props,children)=>({type,props,children}),key={},previewKey={};
  const component=vm.runInNewContext(source.slice(start+'const zd='.length,end),{
    J:value=>value,De:key,So:previewKey,ke:lookup=>lookup===key?{audio:{audioSettings}}:null,
    O:get=>({get value(){return get()}}),Me:callback=>{unmount=callback},
    tt:[],Pe:[],bt:[],Bd:()=>false,Vl:{id:'none'},on:()=>false,
    h(){},b:vnode,u:vnode,P:vnode,Q:value=>value,K:'fragment',ee:'toggle',F:()=>null,
    __aimMountSkins(host,getSettings){mounts.push({host,getSettings});return()=>disposed.push(host)},
  });
  const render=component.setup({}),root=render({},[]),hostNode=root.children.find(child=>child?.props?.['data-role']==='skin-settings-host');
  assert(hostNode);const first={},second={};hostNode.props.ref(first);hostNode.props.ref(first);
  assert.equal(mounts.length,1);assert.equal(mounts[0].getSettings(),audioSettings.value);
  audioSettings.value={enabled:true,volume:.25};assert.equal(mounts[0].getSettings().volume,.25);
  hostNode.props.ref(second);assert.equal(mounts.length,2);assert.deepEqual(disposed,[first]);
  hostNode.props.ref(null);assert.deepEqual(disposed,[first,second]);unmount();assert.equal(disposed.length,2);
  hostNode.props.ref(first);unmount();assert.deepEqual(disposed,[first,second,first]);
});

test('actual banner adapter uses the decoded custom composite and leaves native layer definitions intact',async()=>{
  const h=harness();await h.runtime.initialize();await pick(h.runtime,'vandal');h.runtime.setActiveWeapon('vandal');
  const definition=source=>{
    const start=source.indexOf('function Dt(cA,cB=ll,cC=il){'),end=source.indexOf('const wt=',start);
    return vm.runInNewContext('('+source.slice(start,end)+')',{
      __aimSkins:h.runtime,nl:{native:{dir:'built-in',radius:100,headshot:[0,0]}},Pt:['frame','ring','emblem','pip'],
      ll:Object.fromEntries(['frame','ring','emblem','pip'].map(layer=>['./killbanners/built-in/'+layer+'.png',layer+'.png'])),il:'headshot.png',
    });
  };
  const originalDefinition=definition(originals['DVK7uRSu.js']),patchedDefinition=definition(patched['DVK7uRSu.js']);
  assert.deepEqual(clone(patchedDefinition('native')),clone(originalDefinition('native')));assert.equal(patchedDefinition('unknown'),null);
  const kit=h.runtime.bannerKit(),custom=patchedDefinition(kit);assert.equal(custom.composite,selectedTheme(h).banners[0].url);
  const drawing=[],canvas={clientWidth:150,width:150,height:150,getContext:()=>context},context={
    setTransform(){},clearRect(){},save(){},restore(){},drawImage(image){drawing.push(['image',image])},
    beginPath(){},arc(){drawing.push(['pip'])},fill(){},fillText(text){drawing.push(['text',text])},
  };
  const source=patched['DVK7uRSu.js'],start=source.indexOf('function cR(cU){',source.indexOf("'__name':'KillBannerHud'")),end=source.indexOf('function cS(){',start);
  const draw=vm.runInNewContext('('+source.slice(start,end)+')',{cD:{value:canvas},cE:custom,cF:{composite:h.runtime.getImage(custom.composite)},cI:7,cJ:true,__aimDrawSkinBanner:drawCompositeBanner});
  draw({scale:1,alpha:1,newPipScale:1});assert.equal(drawing.find(call=>call[0]==='image')[1],h.runtime.getImage(custom.composite));
  assert.equal(drawing.filter(call=>call[0]==='pip').length,2);assert(drawing.some(call=>call[0]==='text'&&call[1]==='HEADSHOT'));
});

test('readiness activates the selected banner before first fire even with native killKit none, and reset removes it',async()=>{
  const h=harness();await h.runtime.initialize();await pick(h.runtime,'vandal');h.runtime.reset();assert.equal(h.runtime.bannerKit(),null);
  const game=patched['CymPR-fm.js'],start=game.indexOf('function __aimBeginWarm(doc,retry=false){'),end=game.indexOf('let Sa=null,Vs=0;',start);
  assert(start>=0&&end>start);
  const noop=()=>{},ready=async()=>{},context={phase:noop,check:noop},built={};
  const begin=vm.runInNewContext('('+game.slice(start,end).trim()+')',{
    __aimSkins:h.runtime,__aimWarmGate:{run:work=>work(context)},Nt:built,Vs:0,__aimMapReady:Promise.resolve(),
    __aimSceneAssetsReady:ready,_n:ready,d:{ready},h:null,t:{viewModel:{current:false}},
    i:{renderer:{},camera:{}},ju:ready,__aimGpuFence:ready,qe:()=> 'vandal',
  });
  await begin({props:[]});assert(h.runtime.bannerKit(),'scene readiness must establish the gun before any fire event');
  const banner=patched['DVK7uRSu.js'],gateStart=banner.indexOf('cG=e(()=>{__aimSkinRevision.value;'),gateEnd=banner.indexOf('),cH=aS(',gateStart);
  assert(gateStart>=0&&gateEnd>gateStart);
  const gate=vm.runInNewContext(banner.slice(gateStart+'cG='.length,gateEnd+1),{
    __aimSkins:h.runtime,__aimSkinRevision:{value:0},e:get=>({get value(){return get()}}),
    cC:{audioSettings:{value:{killKit:'none'}},sceneSource:{value:'custom'}},av:()=>false,
  });
  assert.equal(gate.value,h.runtime.bannerKit());h.runtime.reset();assert.equal(gate.value,null);
});

test('a layered banner waits for every decoded part, falls back on failure and retries without using a first-kill composite',async()=>{
  const data=fixture(),banner=data.collections[0].themes[0].banners[0];
  banner.layers=Object.fromEntries(['frame','ring','emblem','pip'].map(layer=>[layer,`/skin-packs/test/${layer}.png`]));
  banner.headshot='/skin-packs/test/headshot.png';banner.pipRadius=72.5;banner.headshotOffset=[0,-25];
  const h=harness(data),gate=deferred();h.imageDecodeGates.set(banner.layers.pip,gate);
  await h.runtime.initialize();h.runtime.setActiveWeapon('vandal');
  const loading=pick(h.runtime,'vandal');await turn();
  assert.equal(h.runtime.bannerKit(),null);
  assert.equal(h.runtime.availability('vandal').banner,'loading');
  gate.resolve();await loading;
  const kit=h.runtime.bannerKit(),definition=h.runtime.bannerDefinition(kit),before=h.counts();
  assert.deepEqual(definition.layers,banner.layers);assert.equal(definition.composite,undefined);
  for(let i=0;i<20;i++)assert.deepEqual(h.runtime.bannerDefinition(kit),definition);
  assert.deepEqual(h.counts(),before,'HUD definition and drawing must read decoded caches only');
  const failed=harness(data);failed.imageFailures.add(banner.layers.ring);await failed.runtime.initialize();await pick(failed.runtime,'vandal');failed.runtime.setActiveWeapon('vandal');
  assert.equal(failed.runtime.getImage(banner.url)?.complete,true,'a ready preview must not hide a broken gameplay layer');
  assert.equal(failed.runtime.bannerKit(),null);assert.equal(failed.runtime.bannerDefinition('skin:'+banner.url),null);
  assert.equal(failed.runtime.availability('vandal').banner,'failed');
  failed.imageFailures.clear();await failed.runtime.prepare();assert(failed.runtime.bannerKit());
});

test('all 37 delivered skin variants draw changing radial artwork through the actual HUD for kills 1–5 and repeated cycles',async()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../dist/skin-packs/index.json',import.meta.url),'utf8'));
  const h=harness(manifest);await h.runtime.initialize();
  const source=patched['DVK7uRSu.js'],start=source.indexOf("const dl=c({'__name':'KillBannerHud'"),end=source.indexOf(',cl=w(',start);
  const radialStart=source.indexOf('function ol('),radialEnd=source.indexOf('const rl=',radialStart);
  const positions=vm.runInNewContext('('+source.slice(radialStart,radialEnd)+')');
  let variants=0;
  for(const collection of manifest.collections)for(const theme of collection.themes)for(const banner of theme.banners){
    assert(banner.layers,collection.id+'/'+banner.id+' must not draw a static first-kill composite');
    const weapon=collection.weapons[0];await h.runtime.select(weapon,{collection:collection.id,theme:theme.id,banner:banner.id});h.runtime.setActiveWeapon(weapon);
    const calls=[],stack=[];let translation=[0,0],exposed;
    const context={setTransform(){},clearRect(){calls.length=0},save(){stack.push([...translation])},restore(){translation=stack.pop()},
      translate(x,y){translation=[translation[0]+x,translation[1]+y]},rotate(){},scale(){},drawImage(image){calls.push({url:image.url,at:[...translation]})}};
    const canvas={clientWidth:150,width:300,height:300,getContext:()=>context},view={seq:0,kills:0,headshot:false,at:10,now:10.4};
    const component=vm.runInNewContext(source.slice(start+'const dl='.length,end),{
      c:value=>value,x:value=>({value:value===null?canvas:value}),A:(get,callback)=>callback(get()),D(){},E(){},
      Dt:key=>h.runtime.bannerDefinition(key),__aimSkins:h.runtime,Pt:['frame','ring','emblem','pip'],
      __aimDrawSkinPip(ctx,x,y){assert.equal(banner.pipFallback,'generic-chevron');calls.push({url:banner.layers.pip,at:[x,y],fallback:true})},
      Image:class{constructor(){assert.fail('gameplay must reuse decoded layers')}},
      ul:()=>({scale:1,alpha:1,ringRotation:0,ringGlow:0,newPipAlpha:1,newPipScale:1,headshotScale:1}),wt:killIndex,ol:positions,
      window:{devicePixelRatio:2},al:300,
    });
    component.setup({view:{current:view},kit:h.runtime.bannerKit()},{expose:api=>{exposed=api}});
    const pipBytes=fs.readFileSync(new URL('../dist'+banner.layers.pip,import.meta.url));
    if(pipBytes.readUInt32BE(16)===1||pipBytes.readUInt32BE(20)===1)assert.equal(banner.pipFallback,'generic-chevron','invisible source pips must have a visible radial fallback');
    const before=h.counts(),patterns=[];
    for(const kill of [1,2,3,4,5,6,7,10]){
      Object.assign(view,{seq:view.seq+1,kills:kill,headshot:kill===5});exposed.tick();
      const pips=calls.filter(call=>call.url===banner.layers.pip),count=killIndex(kill);
      assert.equal(pips.length,count,collection.id+'/'+banner.id+' kill '+kill);
      for(const pip of pips)assert(Math.abs(Math.hypot(...pip.at)-banner.pipRadius)<1e-8,'pips must be on the main emblem ring');
      if(kill===2){assert(Math.abs(pips[0].at[1])<1e-8);assert(Math.abs(pips[1].at[1])<1e-8);assert(pips[0].at[0]*pips[1].at[0]<0,'two kills occupy opposite sides');}
      for(const part of ['frame','ring','emblem'])assert(calls.some(call=>call.url===banner.layers[part]));
      assert.equal(calls.some(call=>call.url===banner.headshot),kill===5);
      assert(!calls.some(call=>call.url===banner.url),'preview composite must never be drawn in layered gameplay');
      patterns.push(JSON.stringify(pips.map(pip=>pip.at)));
    }
    assert.equal(new Set(patterns.slice(0,5)).size,5,'all five main-art states must differ');
    assert.equal(patterns[0],patterns[5]);assert.equal(patterns[1],patterns[6]);assert.equal(patterns[4],patterns[7]);
    assert.deepEqual(h.counts(),before);variants++;
  }
  assert.equal(variants,37);
});

test('actual HUD consumes the first recent skin kill on mount, preserves native mount behavior and rejects expired events',()=>{
  function hud(source,{seq=1,kills=1,headshot=true,at=10,now=10.02,kit='skin:/skin-packs/test/banner.png'}={}){
    const timingStart=source.indexOf('const rl=0.16,'),timingEnd=source.indexOf('const dl=',timingStart);
    const animate=vm.runInNewContext('(function(){'+source.slice(timingStart,timingEnd)+';return ul;})()');
    const countStart=source.indexOf('const wt='),countEnd=source.indexOf('function ol(',countStart);
    const count=vm.runInNewContext('(function(){'+source.slice(countStart,countEnd)+';return wt;})()',{ap:5});
    const start=source.indexOf("const dl=c({'__name':'KillBannerHud'"),end=source.indexOf(',cl=w(',start);assert(start>=0&&end>start);
    let exposed;const props={view:{current:{seq,kills,headshot,at,now}},kit};
    const component=vm.runInNewContext(source.slice(start+'const dl='.length,end),{
      c:value=>value,x:value=>({value}),A:(get,callback)=>callback(get()),D(){},E(){},
      Dt:key=>key.startsWith('skin:')?{composite:key.slice(5)}:{layers:Object.fromEntries(['frame','ring','emblem','pip'].map(layer=>[layer,layer+'.png']))},
      __aimSkins:{getImage:()=>({complete:true,naturalWidth:300})},Pt:['frame','ring','emblem','pip'],
      Image:class{complete=true;naturalWidth=300},ul:animate,wt:count,
    });
    component.setup(props,{expose:api=>{exposed=api}});return {...exposed,view:props.view.current};
  }
  const first=hud(patched['DVK7uRSu.js']);first.tick();assert.equal(first.state().showing,true);assert.equal(first.state().pips,1);assert.equal(first.state().headshot,true);
  const waiting=hud(patched['DVK7uRSu.js'],{seq:0,kills:0,headshot:false,at:-1,now:0});waiting.tick();assert.equal(waiting.state().showing,false);
  Object.assign(waiting.view,{seq:1,kills:1,headshot:true,at:10,now:10});waiting.tick();assert.equal(waiting.state().showing,true);
  waiting.tick();assert.equal(waiting.state().showing,true,'unchanged game time keeps paused kill feedback at the same age');
  waiting.view.now=12.31;waiting.tick();assert.equal(waiting.state().showing,false);
  const expired=hud(patched['DVK7uRSu.js'],{at:1,now:10});expired.tick();assert.equal(expired.state().showing,false);
  const nativeBefore=hud(originals['DVK7uRSu.js'],{kit:'skinGaia'}),nativeAfter=hud(patched['DVK7uRSu.js'],{kit:'skinGaia'});
  nativeBefore.tick();nativeAfter.tick();assert.equal(nativeBefore.state().showing,false);assert.equal(nativeAfter.state().showing,false);
});

test('strict skin patch composes after all performance transforms, preserves inputs and every emitted module parses',()=>{
  const input={...prepared,'unrelated.js':'unchanged'},output=applySkinPacksPatch(input);
  assert.notEqual(output,input);assert.equal(output['unrelated.js'],'unchanged');assert.equal(input['CymPR-fm.js'],prepared['CymPR-fm.js']);
  for(const name of moduleNames){
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:output[name],encoding:'utf8',windowsHide:true});assert.equal(result.status,0,name+' '+result.stderr);
    assert(!originals[name].includes('__aimSkins'));
  }
  assert.match(output['CymPR-fm.js'],/ie\.playFire\(Jn\?Ae\.player\.weapon\?\?qe\(\):null,Ae\.player\.weapon\?\?qe\(\)\)/);
  assert.match(output['CymPR-fm.js'],/ie\.playKill\?\.\(io,Ae\.player\.weapon\?\?qe\(\)\)/);
  assert.match(output['CymPR-fm.js'],/await __aimSkins\.prepare\(\);ctx\.check\(\)/);
  assert.match(output['CymPR-fm.js'],/io=0,ds=\(__aimSkins\.reset\(\),q1\(E\)\)/);
  assert.throws(()=>applySkinPacksPatch(output),/already applied/);assert.throws(()=>applySkinPacksPatch(originals),/preload/);
  for(const name of ['CymPR-fm.js','DCKWp-_u.js','DVK7uRSu.js']){
    const missing={...prepared};delete missing[name];assert.throws(()=>applySkinPacksPatch(missing),/missing module/);
  }
  for(const [name,before,after] of [['CymPR-fm.js','playFire(t=null){','playFireChanged(t=null){'],['DCKWp-_u.js','__name:"AudioPanel"','__name:"ChangedAudioPanel"'],['DVK7uRSu.js','function Dt(cA,cB=ll,cC=il){','function ChangedDt(cA,cB=ll,cC=il){']]){
    assert.throws(()=>applySkinPacksPatch({...prepared,[name]:prepared[name].replace(before,after)}),/version mismatch/);
    assert.throws(()=>applySkinPacksPatch({...prepared,[name]:prepared[name]+prepared[name]}),/version mismatch/);
  }
});
