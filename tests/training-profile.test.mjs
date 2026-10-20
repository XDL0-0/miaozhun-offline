import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {installTrainingFixture,installTrainingVueDiagnostics} from '../scripts/training-profile-fixture.mjs';

const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const repo=fileURLToPath(new URL('../',import.meta.url));
const digest=source=>crypto.createHash('sha256').update(source).digest('hex');
const nativeMarker='/*__offlineTrainingFixture__*/',vueMarker='/*__offlineTrainingVueDispatch__*/';
const syntax=source=>parse(source,{ecmaVersion:'latest',sourceType:'module'});

// The committed delivery works in a fresh checkout. When a developer has the
// temporary probe installed, read its verified exact backup instead.
function cleanModule(pattern,marker,backupName,manifestName){
 const files=fs.readdirSync(path.join(repo,'dist/js')).filter(name=>pattern.test(name));
 assert.equal(files.length,1);
 let source=fs.readFileSync(path.join(repo,'dist/js',files[0]),'utf8');
 if(source.includes(marker)){
  const manifest=JSON.parse(fs.readFileSync(path.join(repo,'qa-artifacts',manifestName),'utf8'));
  assert.equal(digest(source),manifest.patchedSha256,'Existing temporary module must match its manifest');
  source=fs.readFileSync(path.join(repo,'qa-artifacts',backupName),'utf8');
  assert.equal(digest(source),manifest.originalSha256);
 }
 syntax(source);return {name:files[0],source};
}
const native=cleanModule(/^CymPR.*\.js$/,nativeMarker,'training-profile-original-runtime.js','training-profile-runtime.json');
const vue=cleanModule(/^index\..*\.js$/,vueMarker,'training-profile-original-vue-runtime.js','training-profile-vue-runtime.json');

function temporaryRoot(t){
 const base=fs.realpathSync(os.tmpdir()),prefix='aim-training-profile-test-',root=fs.mkdtempSync(path.join(base,prefix));
 fs.mkdirSync(path.join(root,'dist/js'),{recursive:true});
 fs.writeFileSync(path.join(root,'dist/js',native.name),native.source);
 fs.writeFileSync(path.join(root,'dist/js',vue.name),vue.source);
 t.after(()=>{const real=fs.realpathSync(root);assert.equal(path.dirname(real),base);assert.ok(path.basename(real).startsWith(prefix));fs.rmSync(real,{recursive:true,force:true});});
 return root;
}
function readNative(root){return fs.readFileSync(path.join(root,'dist/js',native.name),'utf8');}
function readVue(root){return fs.readFileSync(path.join(root,'dist/js',vue.name),'utf8');}

test('Training diagnostics install and exactly restore the actual native and Vue module anchors',t=>{
 const root=temporaryRoot(t),first=installTrainingFixture(root),vueFirst=installTrainingVueDiagnostics(root);
 syntax(readNative(root));syntax(readVue(root));
 assert.ok(readNative(root).includes('Dt=!0,(__aimFixture?__aimFixtureStop("player-fell"):'));
 for(const phase of ['simulation','snapshot','observers','event-dispatch','audio-fire','wall-impact','hit-effects','hud-publish'])assert.ok(readNative(root).includes(JSON.stringify(phase)),phase+' timing installed');
 assert.equal(installTrainingFixture(root).patchedSha256,first.patchedSha256);
 assert.equal(installTrainingVueDiagnostics(root).patchedSha256,vueFirst.patchedSha256);
 assert.equal(fs.readFileSync(path.join(root,'qa-artifacts/training-profile-original-runtime.js'),'utf8'),native.source);
 assert.equal(fs.readFileSync(path.join(root,'qa-artifacts/training-profile-original-vue-runtime.js'),'utf8'),vue.source);
 assert.equal(installTrainingFixture(root,true).restored,true);
 assert.equal(installTrainingVueDiagnostics(root,true).restored,true);
 assert.equal(readNative(root),native.source);assert.equal(readVue(root),vue.source);
 assert.equal(installTrainingFixture(root,true).restored,false);
 assert.equal(installTrainingVueDiagnostics(root,true).restored,false);
});

test('Full generated-module parsing rejects invalid modules before any backup or runtime write',t=>{
 const root=temporaryRoot(t),badNative=native.source+'\nconst =;',badVue=vue.source+'\nconst =;';
 fs.writeFileSync(path.join(root,'dist/js',native.name),badNative);
 fs.writeFileSync(path.join(root,'dist/js',vue.name),badVue);
 assert.throws(()=>installTrainingFixture(root),SyntaxError);
 assert.throws(()=>installTrainingVueDiagnostics(root),SyntaxError);
 assert.equal(readNative(root),badNative);assert.equal(readVue(root),badVue);
 assert.equal(fs.existsSync(path.join(root,'qa-artifacts')),false,'Parse failure must precede backup creation');
});

function nativeFixtureContext(patched,enabled){
 const start=patched.indexOf(nativeMarker)+nativeMarker.length,end=patched.indexOf('const a=o.buildViewport',start);
 assert.ok(start>=nativeMarker.length&&end>start);
 const helpers=patched.slice(start,end),adStart=patched.indexOf('function ad(E){'),adEnd=patched.indexOf('function id(',adStart);
 assert.ok(adStart>0&&adEnd>adStart);
 const inputs={},originals={},events=[],phases=[];let restartCalls=0,rounds=0,tickCalls=0,renderCalls=0;
 for(const method of ['drainForTick','peekPendingLook','takeReloadPresses','takeInspectPresses','takeEquipPress','takeUsePresses','takeSecondaryPresses','takeTailwindPresses','takeCloudburstEdges'])inputs[method]=originals[method]=()=>method;
 inputs.setEnabled=()=>{};inputs.setLookOnly=()=>{};
 const context={URLSearchParams,location:{search:enabled?'?__offlineProfile=1':''},document:{pointerLockElement:null},performance:{now:()=>100},he:1/128,te:inputs,nt:{replay:true},t:{phase:{current:'idle'},session:{current:'standalone'},autoAim:{current:false},rankedTicket:{current:null}},n:{onPhaseChange(value){context.t.phase.current=value;phases.push(value);},onSessionActive(){},onRoundComplete(){rounds++;}},qe:()=> 'vandal',md(){tickCalls++;return 7;},yd(alpha){renderCalls++;assert.equal(alpha,.5);return 8;},i:{renderer:{info:{programs:[],memory:{textures:2,geometries:3}}}},__aimWarmJob:Promise.resolve({status:'ready'}),Zt:{result:()=>({hits:0})},ke:null,N:null,dn:null,io:0,ds:15,Zo:100,go:null,jn:null,wo:null,Mo:false};
 context.window={__offlineTrainingFixtureRegistry:{event(kind,value){events.push({kind,value});}}};
 context.Do=()=>{restartCalls++;context.api.ready();};
 vm.runInNewContext(helpers+patched.slice(adStart,adEnd)+';globalThis.api={start:__aimFixtureStart,stop:__aimFixtureStop,ready:__aimFixtureReady,snapshot:__aimFixtureSnapshot,tick:__aimFixtureTick,render:__aimFixtureRender,finish:ad,phase:__aimFixturePhase,call:__aimFixtureCall};',context);
 return {context,inputs,originals,phases,events,counters:()=>({restartCalls,rounds,tickCalls,renderCalls})};
}

test('Query-off and query-on inactive native diagnostics preserve input, scheduler and normal result callbacks',t=>{
 const root=temporaryRoot(t);installTrainingFixture(root);const patched=readNative(root);
 for(const enabled of [false,true]){
  const probe=nativeFixtureContext(patched,enabled);
  assert.equal(probe.context.api.snapshot(),null);
  assert.equal(probe.context.api.tick(),7);assert.equal(probe.context.api.render(.5),8);
  probe.context.api.finish('normal-round');assert.equal(probe.counters().rounds,1);
  for(const [method,original]of Object.entries(probe.originals))assert.equal(probe.inputs[method],original);
  assert.equal(probe.counters().restartCalls,0);
  if(!enabled){assert.equal(probe.context.api.start().ok,false);assert.equal(probe.counters().restartCalls,0);}
 }
 assert.ok(patched.includes('onTick:__aimFixtureAllowed?__aimFixtureTick:md,onRender:__aimFixtureAllowed?__aimFixtureRender:yd,'));
});

test('Deterministic native input queues restore on stop and tainted fixture scenes cannot save results',t=>{
 const root=temporaryRoot(t);installTrainingFixture(root);const probe=nativeFixtureContext(readNative(root),true);
 assert.equal(probe.context.api.start().ok,true);assert.equal(probe.counters().restartCalls,1);
 assert.equal(probe.context.api.snapshot().seed,20261020);assert.equal(probe.context.nt,null);
 for(let tick=1;tick<=1280;tick++){
  const input=probe.inputs.drainForTick();
  if(tick===96)assert.equal(input.fire,true);
  if(tick===320){assert.equal(probe.inputs.takeReloadPresses(),1);assert.equal(probe.inputs.takeReloadPresses(),0);}
  if(tick===512)assert.equal(probe.inputs.takeEquipPress(),'melee');
  if(tick===768)assert.equal(probe.inputs.takeEquipPress(),'primary');
  if(tick===864){assert.equal(probe.inputs.takeInspectPresses(),1);assert.equal(probe.inputs.takeInspectPresses(),0);}
 }
 probe.context.api.stop('test-stop');assert.equal(probe.context.api.snapshot().active,false);
 assert.equal(probe.phases.at(-1),'paused');assert.equal(probe.context.nt,null);
 for(const [method,original]of Object.entries(probe.originals))assert.equal(probe.inputs[method],original,method+' must restore');
 probe.context.api.finish('resumed-tainted-round');assert.equal(probe.counters().rounds,0,'Stopped fixture results must remain blocked');
 assert.equal(probe.phases.at(-1),'paused');
 const active=nativeFixtureContext(readNative(root),true);active.context.api.start();active.context.api.finish('early-native-end');
 assert.equal(active.context.api.snapshot().active,false);assert.equal(active.counters().rounds,0);
 assert.equal(active.context.api.snapshot().reason,'native-round-ended:early-native-end');
});

test('Native tick phase timings remain exclusive across nested calls and preserve returns and thrown errors',t=>{
 const root=temporaryRoot(t);installTrainingFixture(root);const probe=nativeFixtureContext(readNative(root),true),api=probe.context.api;
 assert.equal(api.call('inactive',()=>42),42);assert.equal(api.snapshot(),null);
 api.start();for(let tick=0;tick<96;tick++)probe.inputs.drainForTick();let clock=100;
 probe.context.performance.now=()=>++clock;
 probe.context.md=()=>{api.phase('simulation');const value=api.call('audio-fire',()=>{clock+=40;return 88;});assert.equal(value,88);api.phase('state-and-hud');return 7;};
 assert.equal(api.tick(),7);
 const phases=api.snapshot().nativeCpu.phase;
 assert.deepEqual(Array.from(phases,event=>event.phase),['tick-preamble','simulation','audio-fire','simulation','state-and-hud']);
 assert.ok(phases.every(event=>event.tick===96&&event.duration>=0));assert.ok(phases.find(event=>event.phase==='audio-fire').duration>=40);
 assert.ok(phases.every(event=>event.frameId===1));assert.equal(api.snapshot().nativeCpu.tick[0].frameId,1);
 const total=api.snapshot().nativeCpu.tick[0].duration;assert.ok(phases.reduce((sum,event)=>sum+event.duration,0)<=total,'Exclusive phases must not double count nested audio time');
 const originalError=new Error('native error');probe.context.md=()=>api.call('audio-fire',()=>{throw originalError;});
 assert.throws(()=>api.tick(),error=>error===originalError);
 assert.equal(api.snapshot().nativeCpu.tick[1].frameId,2,'Repeated native ticks need distinct sample identities');
 assert.equal(api.call('outside-tick',()=>11),11,'A thrown native call must clear the phase timing context');
});

test('Vue dispatch diagnostics observe errors before a swallowing parent and preserve the original error path',t=>{
 const root=temporaryRoot(t);installTrainingVueDiagnostics(root);const patched=readVue(root);
 const node=syntax(patched).body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='$g');assert.ok(node);
 const dispatchSource=patched.slice(node.start,node.end);
 for(const enabled of [false,true]){
  const calls=[],originalError=new Error('parent swallows this error'),context={URLSearchParams,location:{search:enabled?'?__offlineProfile=1':''},window:{__offlineTrainingFixtureRegistry:{caught(error,component){calls.push({kind:'diagnostic',error,component});}}}};
  vm.runInNewContext(dispatchSource+';globalThis.dispatch=$g;',context);
  const component={type:{__name:'Child'},proxy:{},appContext:{config:{}},parent:{parent:null,ec:[error=>{calls.push({kind:'parent',error});return false;}]}};
  assert.equal(context.dispatch(originalError,component,15),undefined);
  assert.equal(calls.length,enabled?2:1);assert.equal(calls.at(-1).kind,'parent');assert.equal(calls.at(-1).error,originalError);
  if(enabled){assert.equal(calls[0].kind,'diagnostic');assert.equal(calls[0].error,originalError);assert.equal(calls[0].component.name,'Child');assert.equal(calls[0].component.info,15);}
 }
});

test('Live diagnostics keep a small summary, stop all interval publishing, and create full text only on explicit snapshot',()=>{
 const source=fs.readFileSync(new URL('../scripts/create-training-profile.mjs',import.meta.url),'utf8');
 const node=syntax(source).body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='installTrainingProfile');assert.ok(node);
 const elements=[],intervals=[],microtasks=[];let time=100,textWrites=0;
 function element(tag){const listeners={},entry={tagName:tag.toUpperCase(),style:{},dataset:{},children:[],hidden:false,value:'',append(...children){this.children.push(...children);},setAttribute(key,value){this[key]=value;},addEventListener(key,callback){listeners[key]=callback;},querySelector(){return null;},getClientRects(){return[];},click(){listeners.click?.();}};let text='';Object.defineProperty(entry,'textContent',{get:()=>text,set(value){text=String(value);if(entry.id==='training-profile-json')textWrites++;}});elements.push(entry);return entry;}
 class Canvas{getContext(){return null;}}
 const document={body:element('body'),visibilityState:'visible',pointerLockElement:null,getElementById:id=>elements.find(e=>e.id===id)??null,createElement:element,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
 const context={URL,URLSearchParams,document,HTMLCanvasElement:Canvas,performance:{now:()=>++time},location:{search:'?__offlineProfile=1',href:'http://127.0.0.1:18746/aim'},getComputedStyle:()=>({display:'block',visibility:'visible'}),requestAnimationFrame:()=>1,setInterval(callback){intervals.push(callback);},queueMicrotask(callback){microtasks.push(callback);},setTimeout(){},addEventListener(){}};
 context.window=context;vm.runInNewContext('('+source.slice(node.start,node.end)+')();',context);
 const raw={kind:'deterministic-fixture',active:true,seed:20261020,tick:1280,simulationSeconds:10,startedAt:100,endedAt:null,reason:null,nativeCpu:{tick:Array.from({length:1280},(_,i)=>({at:101+i,duration:.6,tick:i,frameId:i+1})),render:Array.from({length:4096},(_,i)=>({at:101+i,duration:1,tick:i,programs:12,textures:40,geometries:20})),phase:Array.from({length:1280*8},(_,i)=>({at:101+Math.floor(i/8)+(i%8)*.05,duration:.05,tick:Math.floor(i/8),frameId:Math.floor(i/8)+1,phase:['simulation','snapshot','observers','effects-update','event-observer','event-dispatch','audio-fire','state-and-hud'][i%8]})),droppedTicks:0,droppedRenders:0,droppedPhases:0}};
 // The final simulation tick and the stop-only md() can share tick=1280.
 // Summing their phases against the first .9ms sample previously produced -7.1ms.
 raw.nativeCpu.tick.push({at:20000,duration:.9,tick:1280,frameId:2001},{at:20010,duration:7.1,tick:1280,frameId:2002},{at:21000,duration:39.2,tick:96,frameId:2003},{at:21100,duration:.2,tick:96,frameId:2004});
 raw.nativeCpu.phase.push({at:20000,duration:.9,tick:1280,frameId:2001,phase:'simulation'},{at:20010,duration:7.1,tick:1280,frameId:2002,phase:'tick-preamble'},{at:21000,duration:1.8,tick:96,frameId:2003,phase:'simulation'},{at:21001.8,duration:35.9,tick:96,frameId:2003,phase:'audio-fire'},{at:21037.7,duration:1.5,tick:96,frameId:2003,phase:'state-and-hud'},{at:21100,duration:.2,tick:96,frameId:2004,phase:'tick-preamble'});
 const snapshot=()=>({...raw,nativeCpu:{...raw.nativeCpu}});
 context.__offlineTrainingFixtureRegistry.register({snapshot});context.__offlineTrainingFixtureRegistry.event('running',snapshot());
 for(const callback of intervals)callback();
 const summary=document.getElementById('training-profile-json'),full=document.getElementById('training-profile-full-json');
 assert.ok(summary.textContent.length<12000,'The accessible live JSON must stay small with full-size native buffers');
 assert.ok(JSON.parse(summary.textContent).fixture.nativeCpu.phase['audio-fire']);
 const grouped=JSON.parse(summary.textContent).fixture.nativeCpu.phaseTicks;
 assert.equal(grouped[0].tick,96);assert.equal(grouped[0].frameId,2003);assert.equal(grouped[0].totalCpuMs,39.2);assert.equal(grouped[0].accountedMs,39.2);
 assert.ok(grouped.every(frame=>frame.instrumentationAndUnattributedMs>=0),'Same-tick samples must not create negative unaccounted CPU');
 const finalTick=grouped.find(frame=>frame.frameId===2002);assert.equal(finalTick.accountedMs,7.1);assert.equal(finalTick.totalCpuMs,7.1);assert.equal(finalTick.instrumentationAndUnattributedMs,0);
 assert.equal(JSON.parse(summary.textContent).fixture.nativeCpu.events,undefined);assert.equal(full.value,'');assert.equal(full.hidden,true);
 raw.active=false;raw.endedAt=10100;raw.reason='completed-10s';context.__offlineTrainingFixtureRegistry.event('stopped',snapshot());
 while(microtasks.length)microtasks.shift()();
 const frozenWrites=textWrites,frozenText=summary.textContent;
 for(let i=0;i<20;i++)for(const callback of intervals)callback();
 assert.equal(textWrites,frozenWrites,'Stopped intervals must not stringify or rewrite the DOM');assert.equal(summary.textContent,frozenText);assert.equal(full.value,'');
 elements.find(e=>e.tagName==='BUTTON'&&e.textContent==='JSON快照').click();
 assert.ok(full.value.length>100000);assert.equal(JSON.parse(full.value).fixture.nativeCpu.events.render.length,4096);
 assert.ok(summary.textContent.length<12000);assert.equal(JSON.parse(summary.textContent).fixture.nativeCpu.events,undefined);
});
