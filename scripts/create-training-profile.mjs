// Query-only, reversible diagnostics and a deterministic native-engine fixture.
// Only generated dist files are patched; no game settings, scores or storage change.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installTrainingFixture,installTrainingVueDiagnostics} from './training-profile-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),dist=path.join(root,'dist');
const indexFile=path.join(dist,'index.html'),moduleFile=path.join(dist,'__training-profile.mjs');
const backup=path.join(root,'qa-artifacts/training-profile-original-index.html');
if(process.argv.includes('--restore')){
 installTrainingFixture(root,true);
 installTrainingVueDiagnostics(root,true);
 if(!fs.existsSync(backup))throw Error('Original index backup is unavailable');
 const current=fs.readFileSync(indexFile,'utf8');
 if(current.includes('/*__offlineTrainingProfile__*/'))fs.writeFileSync(indexFile,fs.readFileSync(backup));
 if(fs.existsSync(moduleFile))fs.unlinkSync(moduleFile);
 console.log('Restored the query-only training diagnostics entry. Backup retained: '+backup);
}else{
 const fixtureManifest=installTrainingFixture(root,process.argv.includes('--profile-only'));
 const vueManifest=installTrainingVueDiagnostics(root);
 let html=fs.readFileSync(indexFile,'utf8');
 if(html.includes('/*__offlineTrainingProfile__*/'))html=fs.readFileSync(backup,'utf8');
 const tags=[...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)];
 if(tags.length!==1)throw Error('Expected exactly one current app entry module');
 fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,html);
 fs.writeFileSync(moduleFile,'('+installTrainingProfile.toString()+')();\n');
 const entry=tags[0][1];
 html=html.replace(tags[0][0],'<script type="module">/*__offlineTrainingProfile__*/if(new URLSearchParams(location.search).get("__offlineProfile")==="1")await import("/__training-profile.mjs");await import('+JSON.stringify(entry)+');</script>');
 fs.writeFileSync(indexFile,html);
 console.log(JSON.stringify({url:'http://127.0.0.1:18746/aim?__offlineProfile=1',backup,fixtureManifest,vueManifest,originalIndexSha256:crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex'),restore:'node scripts/create-training-profile.mjs --restore',measured:false},null,2));
}

function installTrainingProfile(){
 if(new URLSearchParams(location.search).get('__offlineProfile')!=='1'||document.getElementById('offline-training-profile'))return;
 const now=()=>performance.now(),span=20000,installedAt=now();
 class Ring{constructor(capacity){this.items=new Array(capacity);this.next=0;this.length=0;}push(value){this.items[this.next]=value;this.next=(this.next+1)%this.items.length;this.length=Math.min(this.items.length,this.length+1);}clear(){this.next=0;this.length=0;}recent(cutoff){const values=[];for(let i=0;i<this.length;i++){const value=this.items[(this.next-this.length+i+this.items.length)%this.items.length];if(value.startTime>=cutoff)values.push(value);}return values;}}
 const buffers={rafCallbacks:new Ring(16000),rafGaps:new Ring(6000),longTasks:new Ring(200),longAnimationFrames:new Ring(200),resources:new Ring(2000),glInitialization:new Ring(2000),phases:new Ring(100),drawBuckets:new Ring(100),visibility:new Ring(100),errors:new Ring(100)};
 const state={active:true,samplingStarted:installedAt,frozenAt:null,run:1,lastRaf:null,currentRaf:null,phase:null,armed:false,firstRunningAt:null,stopAt:null,insideRafDraws:0,outsideRafDraws:0,lastDrawBucket:installedAt};
 let fixtureBridge=null,fixtureRecord=null;
 window.__offlineTrainingFixtureRegistry={register(bridge){fixtureBridge=bridge;},caught(exception,component){caught('vue-dispatch',exception,component);},event(kind,value){fixtureRecord=value;if(kind==='running'){state.firstRunningAt=now();state.stopAt=null;}updatePhase();if(kind==='stopped')stopSampling('Fixture completed: '+value.reason);else publish();}};
 const contexts=[],wrappedContexts=new WeakSet(),supportedObservers=[],observers=[];
 const urlPath=value=>{try{const u=new URL(value,location.href);return (u.origin===location.origin?'':u.origin)+u.pathname;}catch{return String(value??'').slice(0,160);}};
 const round=n=>Number.isFinite(n)?Math.round(n*1000)/1000:null;
 const stats=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.floor((sorted.length-1)*p)];return {samples:sorted.length,mean:round(sorted.reduce((n,v)=>n+v,0)/sorted.length),p50:round(at(.5)),p95:round(at(.95)),p99:round(at(.99)),max:round(sorted.at(-1))};};
 const error=(kind,message)=>buffers.errors.push({startTime:now(),kind,message:String(message).slice(0,500)});
 let caughtHandler=null;
 function caught(kind,exception,component){
  buffers.errors.push({startTime:now(),kind,message:String(exception?.message??exception??'Unknown error').slice(0,2000),stack:typeof exception?.stack==='string'?exception.stack.slice(0,5000):null,component:component??null});
  if(pre){reason='已捕获原应用内部错误；JSON快照可查看堆栈';publish();}
 }
 function hookCaughtVueErrors(){
  const app=document.querySelector('#app')?.__vue_app__,handler=app?.config?.errorHandler;
  if(!app||typeof handler!=='function'||handler===caughtHandler)return;
  const wrapped=function(exception,instance,info){try{caught('vue-caught',exception,{name:instance?.$options?.__name??instance?.$options?.name??null,info});}catch{}return handler.apply(this,arguments);};
  app.config.errorHandler=wrapped;caughtHandler=wrapped;
 }
 const originalFetch=window.fetch;
 if(typeof originalFetch==='function')window.fetch=function(input,init){
  const requestUrl=typeof input==='string'?input:input?.url;
  if(/\/error-reports(?:[?#]|$)/.test(requestUrl??'')&&typeof init?.body==='string'){
   try{const body=JSON.parse(init.body);caught('client-error-report',{message:body.message,stack:body.stack},{name:body.componentName??null,errorType:body.errorType??null});}catch{}
  }
  return originalFetch.apply(this,arguments);
 };
 const originalRaf=window.requestAnimationFrame;
 window.requestAnimationFrame=function(callback){return originalRaf.call(this,function(timestamp){
  if(!state.active)return callback.call(this,timestamp);
  const started=now(),parent=state.currentRaf,frame={startTime:started,rafTimestamp:timestamp,name:callback.name||'(anonymous)',drawCalls:0,glInitializationCalls:0,glInitializationCpuMs:0,phase:state.phase?.kind??'unknown'};
  if(timestamp!==state.lastRaf){if(state.lastRaf!==null)buffers.rafGaps.push({startTime:started,intervalMs:timestamp-state.lastRaf,phase:frame.phase});state.lastRaf=timestamp;}
  state.currentRaf=frame;
  try{return callback.call(this,timestamp);}finally{frame.duration=now()-started;state.currentRaf=parent;buffers.rafCallbacks.push(frame);}
 });};
 const timedMethods=new Set(['texImage2D','texSubImage2D','texImage3D','texSubImage3D','compressedTexImage2D','compressedTexSubImage2D','compressedTexImage3D','compressedTexSubImage3D','texStorage2D','texStorage3D','generateMipmap','compileShader','linkProgram','getProgramParameter','getShaderParameter','clientWaitSync','finish','readPixels']);
 const drawMethods=new Set(['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']);
 const originalContext=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,...args){const gl=originalContext.call(this,type,...args);if(gl&&/^webgl2?$/.test(type))wrapContext(gl,this,type);return gl;};
 function wrapContext(gl,canvas,type){
  if(wrappedContexts.has(gl))return;wrappedContexts.add(gl);const id=contexts.length+1;
  contexts.push({id,type,createdAt:now(),width:canvas.width,height:canvas.height});
  canvas.addEventListener('webglcontextlost',()=>error('webglcontextlost','Context '+id+' was lost'));
  for(const method of [...timedMethods,...drawMethods]){
   const original=gl[method];if(typeof original!=='function')continue;
   try{gl[method]=function(...args){
    if(!state.active)return original.apply(this,args);
    if(drawMethods.has(method)){if(state.currentRaf){state.currentRaf.drawCalls++;state.insideRafDraws++;}else state.outsideRafDraws++;return original.apply(this,args);}
    const started=now();try{return original.apply(this,args);}finally{
     const duration=now()-started,category=method==='compileShader'||method==='linkProgram'?'compile-link':/^(getProgram|getShader|clientWait|finish|readPixels)/.test(method)?'status-wait':'texture-upload';
     const value={startTime:started,duration,method,category,contextId:id,phase:state.phase?.kind??'unknown',inRaf:!!state.currentRaf};
     buffers.glInitialization.push(value);if(state.currentRaf){state.currentRaf.glInitializationCalls++;state.currentRaf.glInitializationCpuMs+=duration;}
    }
   };}catch(e){error('hook',method+': '+e.message);}
  }
 }
 function observe(type,record){
  if(typeof PerformanceObserver!=='function'||!PerformanceObserver.supportedEntryTypes?.includes(type))return;
  try{const observer=new PerformanceObserver(list=>{if(!state.active)return;for(const entry of list.getEntries())if(entry.startTime>=state.samplingStarted)record(entry);});observer.observe({type,buffered:true});observers.push(observer);supportedObservers.push(type);}catch(e){error('observer',type+': '+e.message);}
 }
 observe('longtask',e=>buffers.longTasks.push({startTime:e.startTime,duration:e.duration,name:e.name}));
 observe('long-animation-frame',e=>buffers.longAnimationFrames.push({startTime:e.startTime,duration:e.duration,renderStart:e.renderStart,styleAndLayoutStart:e.styleAndLayoutStart,scripts:[...(e.scripts??[])].slice(0,6).map(s=>({sourceURL:urlPath(s.sourceURL),duration:s.duration,executionStart:s.executionStart,forcedStyleAndLayoutDuration:s.forcedStyleAndLayoutDuration}))}));
 observe('resource',e=>buffers.resources.push({startTime:e.startTime,duration:e.duration,name:urlPath(e.name),initiatorType:e.initiatorType,fetchStart:e.fetchStart,requestStart:e.requestStart,responseStart:e.responseStart,responseEnd:e.responseEnd,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize}));
 document.addEventListener('visibilitychange',()=>{if(state.active)buffers.visibility.push({startTime:now(),visibility:document.visibilityState});});
 const visible=node=>{if(!node||node.hidden||!node.getClientRects().length)return false;const style=getComputedStyle(node);return style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse';};
 function phaseFromDom(){
  const preparation=document.querySelector('[data-role="scene-preparation"]'),hud=document.querySelector('[data-role="hud-scoreboard"]'),pauses=[...document.querySelectorAll('.al-pause-layer,.al-pause-lite-body h2,.al-pause-id h1')],pause=pauses.find(visible),result=document.querySelector('[data-role="moment-result"]');
  const facts={preparationState:preparation?.dataset.state??null,preparationVisible:visible(preparation),hudVisible:visible(hud),pauseVisible:!!pause,pauseClass:pause?.className??null,pauseHeading:(pause?.querySelector('h1,h2')??pause)?.textContent?.trim().slice(0,120)??null,resultVisible:visible(result),pointerLocked:!!document.pointerLockElement,documentVisible:document.visibilityState==='visible'};
  const fixture=fixtureBridge?.snapshot?.()??fixtureRecord;
  const kind=fixture?.active&&fixture.startedAt!==null?'fixture-running':facts.preparationVisible?'preparing':facts.resultVisible?'result-like':facts.pauseVisible?'paused-like':facts.hudVisible&&facts.pointerLocked?'running-like':facts.hudVisible?'training-unlocked':'menu-or-unknown';
  return {kind,...facts,preparationLabel:facts.preparationVisible?(preparation.querySelector('span')?.textContent??'').slice(0,160):null};
 }
 function updatePhase(){
  const value=phaseFromDom(),changed=JSON.stringify(value)!==JSON.stringify(state.phase);state.phase=value;
  if(state.active&&changed)buffers.phases.push({startTime:now(),...value});
  if(state.active&&state.armed&&state.firstRunningAt===null&&value.kind==='running-like'){state.firstRunningAt=now();state.stopAt=state.firstRunningAt+10000;}
  if(state.active&&state.stopAt!==null&&now()>=state.stopAt)stopSampling('训练开始后已采满10秒');
 }
 function flushDraws(){const time=now();if(state.active)buffers.drawBuckets.push({startTime:time,duration:time-state.lastDrawBucket,insideRafDraws:state.insideRafDraws,outsideRafDraws:state.outsideRafDraws});state.insideRafDraws=0;state.outsideRafDraws=0;state.lastDrawBucket=time;}
 function nativeSlowFrames(cutoff,end){try{return typeof window.__aimSlowFrames==='function'?window.__aimSlowFrames().filter(f=>f.at>=cutoff&&f.at<=end).slice(-60):[];}catch{return[];}}
 function report(full=false){
  const time=state.frozenAt??now(),cutoff=Math.max(state.samplingStarted,time-span),data=Object.fromEntries(Object.entries(buffers).map(([key,buffer])=>[key,buffer.recent(cutoff)])),callbacks=data.rafCallbacks,gaps=data.rafGaps,methods={};
  for(const event of data.glInitialization){const m=methods[event.method]??={calls:0,synchronousCpuMs:0,maxSynchronousCpuMs:0};m.calls++;m.synchronousCpuMs+=event.duration;m.maxSynchronousCpuMs=Math.max(m.maxSynchronousCpuMs,event.duration);}
  for(const m of Object.values(methods)){m.synchronousCpuMs=round(m.synchronousCpuMs);m.maxSynchronousCpuMs=round(m.maxSynchronousCpuMs);}
  const native=full?nativeSlowFrames(cutoff,time):[],typical=stats(gaps.map(f=>f.intervalMs))?.p50??16.667,first=state.firstRunningAt;
  const fixture=fixtureBridge?.snapshot?.()??fixtureRecord;if(fixture?.nativeCpu){const cpu=fixture.nativeCpu,phaseEvents=cpu.phase??[],groups={};
   for(const event of phaseEvents){const group=groups[event.phase]??={durations:[],total:0,worst:null};group.durations.push(event.duration);group.total+=event.duration;if(!group.worst||event.duration>group.worst.duration)group.worst=event;}
   const phase=Object.fromEntries(Object.entries(groups).map(([name,group])=>[name,{...stats(group.durations),totalMs:round(group.total),worstTick:group.worst.tick,worstFrameId:group.worst.frameId??null,worstAtMs:round(group.worst.at)}]));
   const samples=cpu.tick.map((event,index)=>({...event,sampleIndex:index})),slowest=[...samples].sort((a,b)=>b.duration-a.duration),firstFire=slowest.find(event=>event.tick===96)??{tick:96,frameId:null,sampleIndex:-1,at:null,duration:null};
   const selectedFrames=[firstFire,...slowest.slice(0,3)].filter((event,index,all)=>all.findIndex(other=>other.sampleIndex===event.sampleIndex)===index);
   const phaseTicks=selectedFrames.map(frame=>{const events=phaseEvents.filter(event=>frame.frameId!=null?event.frameId===frame.frameId:event.frameId==null&&frame.at!==null&&event.tick===frame.tick&&event.at>=frame.at&&event.at+event.duration<=frame.at+frame.duration+.0001),byName={};for(const event of events)byName[event.phase]=(byName[event.phase]??0)+event.duration;const total=frame.duration,accounted=events.reduce((sum,event)=>sum+event.duration,0);return {tick:frame.tick,frameId:frame.frameId??null,atMs:round(frame.at),totalCpuMs:round(total),accountedMs:round(accounted),instrumentationAndUnattributedMs:round(total===null?null:total-accounted),phaseMs:Object.fromEntries(Object.entries(byName).map(([name,duration])=>[name,round(duration)]))};});
   const drawStats=Object.fromEntries(['calls','triangles','points','lines','renderPasses','counterResets'].map(name=>[name,stats(cpu.render.map(e=>e.drawStats?.[name]).filter(Number.isFinite))]));
   fixture.nativeCpu={tickCpuMs:stats(cpu.tick.map(e=>e.duration)),renderSubmitCpuMs:stats(cpu.render.map(e=>e.duration)),drawStats,droppedTicks:cpu.droppedTicks,droppedRenders:cpu.droppedRenders,droppedPhases:cpu.droppedPhases??0,phase,phaseTicks,lastRender:cpu.render.at(-1)??null,...(full?{slowestTicks:[...cpu.tick].sort((a,b)=>b.duration-a.duration).slice(0,20),slowestRenders:[...cpu.render].sort((a,b)=>b.duration-a.duration).slice(0,20),events:cpu}:{})};}
  return {schemaVersion:1,scope:'Actual application; rolling 20-second bounded diagnostics',fixture,full,active:state.active,run:state.run,recordedAt:new Date().toISOString(),window:{fromMs:round(cutoff),toMs:round(time),durationMs:round(time-cutoff),firstRunningObservedAtMs:round(first),autoStopAtMs:round(state.stopAt)},phase:state.phase,method:{raf:'Intervals of unique observed browser RAF timestamps and individual callback synchronous CPU. Multiple HUD/game callbacks can share one timestamp.',gl:'Counts texture uploads, shader compile/link/status calls and their synchronous JS/driver time. Draw calls are counted without per-draw timers. No gl.finish is introduced.',native:'Existing __aimSlowFrames is read when available. Its tick/render breakdown only exists if the user already enabled the built-in performance HUD; no setting is changed.',phase:'Visible DOM inference, not authoritative internal game phase. running-like requires HUD plus pointer lock and no visible preparation/pause/result.',limitations:['RAF callbacks combine simulation, rendering and other callback work; this module cannot split closure-private tick/render functions.','Unlimited MessageChannel rendering can occur outside RAF; outsideRafDraws and any existing native slow-frame data identify this limitation.','GPU execution time and exact resident memory are not measured.','Diagnostic hooks and the live panel add overhead; compare equivalent instrumented runs.','Resource byte sizes describe transfers/encoded responses, not decoded texture allocations.']},supportedObservers,contexts,summary:{rafGapMs:stats(gaps.map(f=>f.intervalMs)),rafCallbackCpuMs:stats(callbacks.map(f=>f.duration)),rafCallbacks:callbacks.length,uniqueRafIntervals:gaps.length,longTasks:data.longTasks.length,longAnimationFrames:data.longAnimationFrames.length,resourceRequests:data.resources.length,transferBytes:data.resources.reduce((n,r)=>n+r.transferSize,0),longRafGaps:gaps.filter(f=>f.intervalMs>Math.max(25,typical*1.5)).length,gapsOver33ms:gaps.filter(f=>f.intervalMs>33.333).length,gapsOver50ms:gaps.filter(f=>f.intervalMs>50).length,glMethods:methods,insideRafDraws:data.drawBuckets.reduce((n,b)=>n+b.insideRafDraws,0),outsideRafDraws:data.drawBuckets.reduce((n,b)=>n+b.outsideRafDraws,0),firstRunning10sRafGapMs:first===null?null:stats(gaps.filter(f=>f.startTime>=first&&f.startTime<first+10000).map(f=>f.intervalMs))},nativeSlowFrames:native,...(full?{events:data}:{recent:{errorCount:data.errors.length,errors:data.errors.slice(-6).map(e=>({startTime:e.startTime,kind:e.kind,message:e.message.slice(0,600),component:e.component??null}))}})};
 }
 let host,status,pre,fullText,reason='采样中';
 function publish(){if(!pre)return;const value=report(false);pre.textContent=JSON.stringify({schemaVersion:value.schemaVersion,scope:value.scope,active:value.active,run:value.run,window:value.window,phase:value.phase,fixture:value.fixture,summary:value.summary,contexts:value.contexts.slice(0,8),errors:value.recent.errors,errorCount:value.recent.errorCount},null,2);status.textContent=(state.active?'采样中':'已停止')+' · '+(state.phase?.kind??'unknown')+' · '+reason;host.dataset.active=String(state.active);}
 function clearSampling(){Object.values(buffers).forEach(b=>b.clear());state.samplingStarted=now();state.lastRaf=null;state.frozenAt=null;state.firstRunningAt=null;state.stopAt=null;state.lastDrawBucket=now();state.insideRafDraws=0;state.outsideRafDraws=0;state.run++;if(fullText)fullText.value='';if(host)host.dataset.fullSnapshotReady='false';}
 function startSampling(armed=false){clearSampling();state.active=true;state.armed=armed;reason=armed?'等待训练HUD和鼠标锁定，再自动采10秒':'滚动保留最近20秒';updatePhase();publish();}
 function stopSampling(message='手动停止'){if(!state.active)return;flushDraws();state.active=false;state.frozenAt=now();reason=message;publish();if(typeof queueMicrotask==='function')queueMicrotask(()=>{if(!state.active)publish();});}
 function mount(){
  host=document.createElement('section');host.id='offline-training-profile';host.dataset.role='training-performance-diagnostics';Object.assign(host.style,{position:'fixed',right:'10px',bottom:'10px',width:'390px',maxWidth:'95vw',zIndex:'2147483647',background:'#10171ff2',color:'#e8eff7',font:'11px system-ui',border:'1px solid #506880',padding:'8px',borderRadius:'6px',boxSizing:'border-box'});
  const title=document.createElement('strong');title.textContent='实际训练性能诊断 · 仅此查询页';status=document.createElement('p');Object.assign(status.style,{margin:'5px 0',color:'#89e4c3'});const controls=document.createElement('div');
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.margin='2px';b.addEventListener('click',fn);controls.append(b);};
  button('自动测试训练',()=>{if(!fixtureBridge){reason='Native fixture is not ready';publish();return;}startSampling();const result=fixtureBridge.start();if(!result.ok){reason='Fixture: '+result.reason;publish();}});button('停止自动测试',()=>fixtureBridge?.stop());
  button('开始',()=>startSampling());button('训练后采10秒',()=>startSampling(true));button('停止',()=>stopSampling());button('清除',()=>{const active=state.active;clearSampling();state.active=active;reason='诊断缓冲已清除';publish();});button('JSON快照',()=>{fullText.value=JSON.stringify(report(true),null,2);host.dataset.fullSnapshotReady='true';reason='完整JSON快照已保存到隐藏文本区，可下载查看';publish();});button('下载JSON',()=>{const data=JSON.stringify(report(true),null,2),a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.href=url;a.download='training-performance-10s.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const note=document.createElement('p');note.textContent='自动测试是固定输入的 deterministic fixture，非正常手动试玩FPS；不写成绩/回放，不更改设置。JSON单列 fixture。';note.style.margin='5px 0';pre=document.createElement('pre');pre.id='training-profile-json';pre.setAttribute('data-role','training-profile-json');Object.assign(pre.style,{font:'10px monospace',maxHeight:'230px',overflow:'auto',margin:0,whiteSpace:'pre-wrap',overflowWrap:'anywhere'});fullText=document.createElement('textarea');fullText.id='training-profile-full-json';fullText.setAttribute('data-role','training-profile-full-json');fullText.hidden=true;fullText.readOnly=true;fullText.setAttribute('aria-hidden','true');host.append(title,status,controls,note,pre,fullText);document.body.append(host);updatePhase();publish();
 }
 if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
 document.addEventListener('pointerlockchange',()=>{if(state.active){updatePhase();publish();}});
 setInterval(()=>{if(!state.active)return;hookCaughtVueErrors();updatePhase();if(!state.active)return;flushDraws();publish();},750);
 window.addEventListener('error',e=>{if(state.active)error('window-error',e.message);});
 window.addEventListener('unhandledrejection',e=>{if(state.active)error('unhandledrejection',e.reason?.message??e.reason);});
}
