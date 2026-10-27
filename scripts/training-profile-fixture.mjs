// Temporary, query-only native-engine fixture. Never used by prepare-offline.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {beginTrainingRenderStats} from './training-render-stats.mjs';
import {beginTrainingRenderPhases} from './training-render-phases.mjs';
const {parse}=createRequire(import.meta.url)('./vendor/acorn.cjs');
const marker='/*__offlineTrainingFixture__*/';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const validate=source=>parse(source,{ecmaVersion:'latest',sourceType:'module'});
export function installTrainingVueDiagnostics(root,restore=false){
 const dist=path.join(root,'dist'),vueMarker='/*__offlineTrainingVueDispatch__*/',manifestFile=path.join(root,'qa-artifacts/training-profile-vue-runtime.json'),backup=path.join(root,'qa-artifacts/training-profile-original-vue-runtime.js');
 const files=fs.readdirSync(path.join(dist,'js')).filter(n=>/^index\..*\.js$/.test(n));
 if(files.length!==1)throw Error('Expected one current application entry module');
 const file=path.join(dist,'js',files[0]);let source=fs.readFileSync(file,'utf8');
 if(source.includes(vueMarker)){
  if(!fs.existsSync(manifestFile)||!fs.existsSync(backup))throw Error('Vue dispatch diagnostic backup is missing');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(manifest.file!==file||manifest.patchedSha256!==sha(source))throw Error('Application entry changed after Vue diagnostics installation; refusing to overwrite it');
  source=fs.readFileSync(backup,'utf8');
  if(restore){fs.writeFileSync(file,source);return {restored:true,file};}
 }else if(restore)return {restored:false,file};
 const clean=source,anchor='function $g(e,t,n,r=!0){';
 if(source.split(anchor).length!==2)throw Error('Vue dispatch version anchor missing or ambiguous');
 source=source.replace(anchor,anchor+vueMarker+'try{if(typeof window!=="undefined"&&new URLSearchParams(location.search).get("__offlineProfile")==="1")window.__offlineTrainingFixtureRegistry?.caught?.(e,{name:t?.type?.__name??t?.type?.name??null,info:n})}catch{}');
 validate(source);
 fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,clean);fs.writeFileSync(file,source);
 const manifest={file,originalSha256:sha(clean),patchedSha256:sha(source),query:'__offlineProfile=1',kind:'Vue dispatch diagnostics before errorCaptured; original behavior preserved'};
 fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export function installTrainingFixture(root,restore=false){
 const dist=path.join(root,'dist'),manifestFile=path.join(root,'qa-artifacts/training-profile-runtime.json'),backup=path.join(root,'qa-artifacts/training-profile-original-runtime.js');
 const files=fs.readdirSync(path.join(dist,'js')).filter(n=>/^CymPR.*\.js$/.test(n));
 if(files.length!==1)throw Error('Expected one current native training module');
 const file=path.join(dist,'js',files[0]);let source=fs.readFileSync(file,'utf8');
 if(source.includes(marker)){
  if(!fs.existsSync(manifestFile)||!fs.existsSync(backup))throw Error('Fixture backup is missing');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(manifest.file!==file||manifest.patchedSha256!==sha(source))throw Error('Native module changed after fixture installation; refusing to overwrite it');
  source=fs.readFileSync(backup,'utf8');
  if(restore){fs.writeFileSync(file,source);return {restored:true,file};}
 }else if(restore)return {restored:false,file};
 const clean=source;
 const replace=(from,to)=>{if(source.split(from).length!==2)throw Error('Fixture version anchor missing or ambiguous: '+from.slice(0,100));source=source.replace(from,to);};
 replace('function yg(e,t,n,o={}){','function yg(e,t,n,o={}){'+marker+fixtureSource());
 replace('te.onLockLost(()=>{ps()||Dt||W||','te.onLockLost(()=>{__aimFixture||ps()||Dt||W||');
 replace('function Lt(){return!S||','function Lt(){return __aimFixture?(F=0,!1):!S||');
 replace('function nr(E){{Ta(nl(uc()));return}}','function nr(E){{Ta(nl(__aimFixture?__aimFixture.seed:uc()));return}}');
 replace('function sr(E){const Q=Qu(E.meta.id);','function sr(E){if(__aimFixture){Ta({...E,meta:{...E.meta,seed:__aimFixture.seed}});return}const Q=Qu(E.meta.id);');
 replace('n.onPhaseChange("running");if(!tn()){','n.onPhaseChange("running");if(__aimFixture)__aimFixtureReady();if(!tn()&&!__aimFixture){');
 replace('function Ta(E,Q=null,le=E){','function Ta(E,Q=null,le=E){if(!__aimFixture)__aimFixtureTainted=false;');
 replace('function ad(E){if(!Zt)return;','function ad(E){if(__aimFixture||__aimFixtureTainted){if(__aimFixture)__aimFixtureStop("native-round-ended:"+E);else{nt=null;n.onPhaseChange("paused");n.onSessionActive(false)}return}if(!Zt)return;');
 replace('function pd(){const E=ps();','function pd(){if(__aimFixture&&__aimFixture.startedAt!==null&&__aimFixture.tick>=Math.round(10/he)){__aimFixtureStop("completed-10s");return}const E=ps();');
 replace('onTick:md,onRender:yd,','onTick:__aimFixtureAllowed?__aimFixtureTick:md,onRender:__aimFixtureAllowed?__aimFixtureRender:yd,');
 replace('n.onPlayerFell?n.onPlayerFell():Ra();return','(__aimFixture?__aimFixtureStop("player-fell"):n.onPlayerFell?n.onPlayerFell():Ra());return');
 replace('const gd={get sceneSource()','if(__aimFixtureAllowed&&window.__offlineTrainingFixtureRegistry)window.__offlineTrainingFixtureRegistry.register({start:__aimFixtureStart,stop:()=>__aimFixtureStop("manual-stop"),snapshot:__aimFixtureSnapshot,graphicsPhase:__aimFixtureGraphicsPhase});const gd={get sceneSource()');
 replace('wd=()=>{__aimWarmGate.cancel','wd=()=>{if(__aimFixture)__aimFixtureStop("disposed");__aimWarmGate.cancel');
 const pdStart=source.indexOf('function pd(){'),pdEnd=source.indexOf('function hd(){',pdStart);
 if(pdStart<0||pdEnd<=pdStart)throw Error('Fixture native tick boundaries are missing');
 let pd=source.slice(pdStart,pdEnd);
 const timeReplace=(from,to)=>{if(pd.split(from).length!==2)throw Error('Fixture timing version anchor missing or ambiguous: '+from);pd=pd.replace(from,to);};
 timeReplace('const je=ke.step(Be);','__aimFixturePhase("simulation");const je=ke.step(Be);__aimFixturePhase("snapshot");');
 timeReplace('cn.capture(Ae);if(N?.observe','cn.capture(Ae);__aimFixturePhase("observers");if(N?.observe');
 timeReplace('l.update(Ae.tick),r.update(Ae.tick);','__aimFixturePhase("effects-update");l.update(Ae.tick),r.update(Ae.tick);');
 timeReplace('d.observe(je,Ae);for(const ve of je){','__aimFixturePhase("event-observer");d.observe(je,Ae);__aimFixturePhase("event-dispatch");for(const ve of je){');
 timeReplace('const Ia=(Ae.player.blindUntil??0)','__aimFixturePhase("state-and-hud");const Ia=(Ae.player.blindUntil??0)');
 for(const [name,expression]of [
  ['audio-fire','ie.playFire(Jn?Ae.player.weapon??qe():null,Ae.player.weapon??qe())'],
  ['audio-kill','ie.playKill?.(io,Ae.player.weapon??qe())'],['audio-hit','ie.playHit(!0)'],['audio-hit','ie.playHit()'],
  ['wall-impact','os(ut,He.direction,Ae.tick)'],['wall-impact','os(He.hitPoint,He.direction,Ae.tick)'],
  ['hit-effects','r.spawn(He.hitPoint,He.hitPart??"body",Ae.tick)'],['hit-effects','r.spawn(ut.point,ut.part,Ae.tick)'],
  ['hud-publish','dd(Ae.player,Be)'],
 ])timeReplace(expression,'__aimFixtureCall('+JSON.stringify(name)+',()=>'+expression+')');
 source=source.slice(0,pdStart)+pd+source.slice(pdEnd);
 const renderStart=source.indexOf('function yd(E){'),renderEnd=source.indexOf('i.setMaxFramesInFlight(',renderStart);
 if(renderStart<0||renderEnd<=renderStart)throw Error('Fixture native render boundaries are missing');
 let render=source.slice(renderStart,renderEnd);
 const renderReplace=(from,to)=>{if(render.split(from).length!==2)throw Error('Fixture render timing version anchor missing or ambiguous: '+from);render=render.replace(from,to);};
 renderReplace('const oe=It(ke);','__aimFixtureRenderPhase("worldUpdate");const oe=It(ke);');
 renderReplace('cn.apply(oe,Ht,le,vd(oe)),Ht=[];','__aimFixtureRenderPhase("actorPose"),cn.apply(oe,Ht,le,vd(oe)),__aimFixtureRenderPhase("worldUpdate"),Ht=[];');
 renderReplace('i.render(),p.render(i.renderer),i.present()',
  '__aimFixtureRenderPhase("sceneRender"),i.render(),__aimFixtureRenderPhase("flashRender"),p.render(i.renderer),__aimFixtureRenderPhase("present"),i.present()');
 source=source.slice(0,renderStart)+render+source.slice(renderEnd);
 validate(source);
 fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,clean);fs.writeFileSync(file,source);
 const manifest={file,originalSha256:sha(clean),patchedSha256:sha(source),query:'__offlineProfile=1',kind:'deterministic fixture; not manual gameplay FPS'};
 fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');return manifest;
}
function fixtureSource(){return `
const __aimFixtureAllowed=typeof location!=="undefined"&&new URLSearchParams(location.search).get("__offlineProfile")==="1";
const __aimFixtureGpuTiming=typeof location==="undefined"||new URLSearchParams(location.search).get("__gpuTiming")!=="0";
let __aimFixture=null,__aimFixtureLast=null,__aimFixtureTainted=false,__aimFixtureTiming=null,__aimFixtureRenderTiming=null,__aimFixtureGraphicsTiming=null;
${beginTrainingRenderStats.toString()}
${beginTrainingRenderPhases.toString()}
function __aimFixtureRenderPhase(name){__aimFixtureRenderTiming?.mark(name)}
function __aimFixtureGraphicsPhase(name){const frame=__aimFixtureGraphicsTiming;if(!frame)return;if(frame.active){frame.timing.mark(name);frame.active=name!==null}else if(name!==null){frame.timing.start(performance.now(),name);frame.active=true}}
function __aimFixtureSnapshot(){const f=__aimFixture??__aimFixtureLast;return f?{kind:"deterministic-fixture",active:!!__aimFixture,seed:f.seed,tick:f.tick,simulationSeconds:f.tick*he,startedAt:f.startedAt,endedAt:f.endedAt??null,reason:f.reason??null,phase:t.phase.current,weapon:qe(),fireHeldTicks:f.shots??0,nativeCpu:f.cpu,gpuBackpressure:{start:f.gpuBackpressureStart??null,end:i.gpuBackpressureStats?.()??null},script:"0-.75 idle; .75-2 fire; 2.5 reload; 4 melee; 4.5-5.5 attack; 6 primary; 6.75 inspect; 8-9.5 fire; 10 stop",pointerLocked:!!document.pointerLockElement,scoreAndReplayDiscarded:true}:null}
function __aimFixturePhase(name){const frame=__aimFixtureTiming;if(!frame)return;const at=performance.now(),f=frame.fixture;if(frame.name!==null){if(f.cpu.phase.length<24000)f.cpu.phase.push({at:frame.at,duration:at-frame.at,tick:f.tick,frameId:frame.id,phase:frame.name});else f.cpu.droppedPhases++}frame.name=name;frame.at=performance.now()}
function __aimFixtureCall(name,callback){const frame=__aimFixtureTiming;if(!frame)return callback();const previous=frame.name;__aimFixturePhase(name);try{return callback()}finally{__aimFixturePhase(previous)}}
function __aimFixtureTick(){const f=__aimFixture;if(!f||f.startedAt===null)return md();const at=performance.now(),frameId=++f.nextFrameId;__aimFixtureTiming={fixture:f,id:frameId,name:"tick-preamble",at};try{return md()}finally{__aimFixturePhase(null);__aimFixtureTiming=null;if(f.cpu.tick.length<2048)f.cpu.tick.push({at,duration:performance.now()-at,tick:f.tick,frameId});else f.cpu.droppedTicks++}}
function __aimFixtureRender(alpha){const f=__aimFixture;if(!f||f.startedAt===null)return yd(alpha);const diagnosticAt=performance.now(),stats=beginTrainingRenderStats(i.renderer,{gpuTiming:__aimFixtureGpuTiming}),timing=beginTrainingRenderPhases(),graphics={timing:beginTrainingRenderPhases(),active:false},previousTiming=__aimFixtureRenderTiming,previousGraphics=__aimFixtureGraphicsTiming,at=performance.now();__aimFixtureRenderTiming=timing;__aimFixtureGraphicsTiming=graphics;timing.start(at);try{return yd(alpha)}finally{const endedAt=performance.now();__aimFixtureRenderTiming=previousTiming;__aimFixtureGraphicsTiming=previousGraphics;const phaseStats=timing.finish(endedAt),graphicsStats=graphics.timing.finish(endedAt),markerMs=phaseStats.instrumentationMs+graphicsStats.instrumentationMs,drawStats=stats.finish(),diagnosticDuration=at-diagnosticAt+performance.now()-endedAt+markerMs;if(phaseStats.phases.sceneRender!==undefined)phaseStats.phases.sceneRender=Math.max(0,phaseStats.phases.sceneRender-graphicsStats.instrumentationMs);if(f.cpu.render.length<4096)f.cpu.render.push({at,duration:Math.max(0,endedAt-at-markerMs),diagnosticDuration,phases:phaseStats.phases,graphicsPhases:graphicsStats.phases,tick:f.tick,drawStats,programs:i.renderer.info.programs?.length??0,textures:i.renderer.info.memory?.textures??0,geometries:i.renderer.info.memory?.geometries??0});else f.cpu.droppedRenders++}}
function __aimFixtureReady(){if(!__aimFixture||__aimFixture.startedAt!==null)return;nt=null;__aimFixture.startedAt=performance.now();__aimFixture.gpuBackpressureStart=i.gpuBackpressureStats?.()??null;window.__offlineTrainingFixtureRegistry?.event("running",__aimFixtureSnapshot())}
function __aimFixtureStop(reason){const f=__aimFixture;if(!f)return;f.reason=reason;f.endedAt=performance.now();beginTrainingRenderStats.dispose?.(i.renderer);nt=null;for(const [key,value]of f.originals)te[key]=value;__aimFixture=null;__aimFixtureLast=f;n.onPhaseChange("paused");n.onSessionActive(false);te.setEnabled(false);te.setLookOnly(false);window.__offlineTrainingFixtureRegistry?.event("stopped",__aimFixtureSnapshot())}
function __aimFixtureStart(){
 if(!__aimFixtureAllowed)return {ok:false,reason:"query-required"};
 if(__aimFixture)return {ok:false,reason:"already-running"};
 if(t.session.current==="calibration"||t.session.current==="blind"||t.autoAim.current||t.rankedTicket?.current)return {ok:false,reason:"requires-unranked-training-without-autoaim"};
 if(document.pointerLockElement)return {ok:false,reason:"release-pointer-lock-first"};
 beginTrainingRenderStats.dispose?.(i.renderer);
 const f={seed:20261020,tick:0,startedAt:null,nextFrameId:0,originals:[],shots:0,cpu:{tick:[],render:[],phase:[],droppedTicks:0,droppedRenders:0,droppedPhases:0}};__aimFixture=f;__aimFixtureTainted=true;
 const wrap=(key,fn)=>{f.originals.push([key,te[key]]);te[key]=fn};
 const neutral=()=>({forward:0,strafe:0,mouseDx:0,mouseDy:0,jump:false,crouch:false,walk:false,fire:false});
 wrap("drainForTick",()=>{if(f.startedAt===null)return neutral();f.tick++;const s=f.tick*he,fire=s>=.75&&s<2||s>=4.5&&s<5.5||s>=8&&s<9.5;if(fire)f.shots++;return {...neutral(),mouseDx:Math.round(2*Math.sin(f.tick/37)),fire}});
 wrap("peekPendingLook",()=>({dx:0,dy:0}));
 const once=(seconds,result)=>{let used=false;return()=>!used&&f.startedAt!==null&&f.tick>=Math.round(seconds/he)?(used=true,result):typeof result==="number"?0:null};
 wrap("takeReloadPresses",once(2.5,1));wrap("takeInspectPresses",once(6.75,1));
 let melee=false,primary=false;wrap("takeEquipPress",()=>{if(f.startedAt===null)return null;if(!melee&&f.tick>=Math.round(4/he)){melee=true;return "melee"}if(!primary&&f.tick>=Math.round(6/he)){primary=true;return "primary"}return null});
 for(const key of ["takeUsePresses","takeSecondaryPresses","takeTailwindPresses"])wrap(key,()=>0);
 wrap("takeCloudburstEdges",()=>({down:false,up:false}));
 window.__offlineTrainingFixtureRegistry?.event("preparing",__aimFixtureSnapshot());
 try{Do();const job=__aimWarmJob;job.then(result=>{if(__aimFixture===f&&result.status!=="ready")__aimFixtureStop("preparation-"+result.status)},()=>{if(__aimFixture===f)__aimFixtureStop("preparation-error")})}catch(error){__aimFixtureStop("start-error");return {ok:false,reason:String(error)}}
 return {ok:true,seed:f.seed};
}
`;}
