import {applyUpstreamRenderAllocationPatch} from './upstream-render-allocation.mjs';
// Reviewed 2026-11-05 client. Every mutation is pinned to one native anchor.
// Helpers are serialized into the original modules: there is no second Three.
import {createHudFrameQueue, createRenderOptionsGate} from './hud.mjs';
import {publishBotOrder, subscribeBotOrder, offsetBotOrderHead} from './bot-order.mjs';
import {markMuzzleUploadRanges} from './muzzle-upload-performance.mjs';
import {actorWarmCounts, createActorWarmPool} from './actor-prewarm.mjs';
import {applyUpstreamInstancePerformancePatch} from './upstream-performance-instance.mjs';

export function stableLightTopK(lights, limit, score, selected=[], scores=[]) {
  let count=0;
  for (const light of lights) {
    const value=score(light);
    if (!(value>0)||limit===0) continue;
    let at=count;
    if(at===limit){if(value<=scores[at-1])continue;at--;}
    while(at>0&&value>scores[at-1]){selected[at]=selected[at-1];scores[at]=scores[at-1];at--;}
    selected[at]=light;scores[at]=value;if(count<limit)count++;
  }
  selected.length=scores.length=count;return selected;
}

// Presentation entries only. The native effect remains responsible for its
// birth tick, random seed, transform, alpha, and its shared atlas textures.
export function createBoundedPresentationPool(create, destroy, limit=64) {
  const idle=[], all=new Set();let closed=false;
  return {
    take(){if(closed)return null;const value=idle.pop()??create();all.add(value);return value;},
    release(value){if(!all.has(value)||idle.includes(value))return;if(!closed&&idle.length<limit)idle.push(value);else{all.delete(value);destroy(value);}},
    warm(count=16){if(closed)return[];while(all.size<Math.min(count,limit)){const value=create();all.add(value);idle.push(value);}return idle;},
    values:()=>all,
    dispose(){if(closed)return;closed=true;for(const value of all)destroy(value);all.clear();idle.length=0;},
    get closed(){return closed;},
  };
}

export async function waitForStablePresentation({revision,prepare,load,model,current}) {
  while(current()){
    const before=revision();await prepare();if(!current())return false;
    await load();const active=model();await active?.ready?.();if(!current())return false;
    if(before===revision()&&active===model())return true;
  }
  return false;
}

function once(source,before,after,label){
  const count=source.split(before).length-1;
  if(count!==1)throw Error(`Upstream performance version mismatch (${label}): expected 1, found ${count}`);
  return source.replace(before,after);
}
function exact(source,before,after,count,label){
  if(source.split(before).length-1!==count)throw Error(`Upstream performance version mismatch (${label})`);
  return source.replaceAll(before,after);
}
function section(source,start,end,patch){
  if(source.split(start).length!==2)throw Error(`Upstream performance version mismatch (${start})`);
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  if(b<a)throw Error(`Upstream performance missing boundary (${end})`);
  return source.slice(0,a)+patch(source.slice(a,b))+source.slice(b);
}
const serialize=(name,fn)=>`const ${name}=(${fn.toString()});\n`;

function patchHudClocks(source){
  const names=['StageCrosshair','AdsSight','ScopeOverlay','AmmoReadout','VitalsReadout','JettAbilityHud','LockdownHud','WeaponSlotsHud','Minimap'];
  for(const name of names){
    const marker=`__name:"${name}"`,start=source.indexOf(marker),end=source.indexOf('__name:',start+marker.length);
    if(start<0||source.split(marker).length!==2)throw Error(`Upstream HUD missing ${name}`);
    const stop=end<0?source.length:end,body=source.slice(start,stop);
    if(!body.includes('requestAnimationFrame(')||!body.includes('cancelAnimationFrame('))throw Error(`Upstream HUD clock changed: ${name}`);
    source=source.slice(0,start)+body.replaceAll('requestAnimationFrame(','__aimUpstreamHudFrames.request(').replaceAll('cancelAnimationFrame(','__aimUpstreamHudFrames.cancel(')+source.slice(stop);
  }
  return source;
}

function patchImpact(source){
  return section(source,'function bw(e,t){','const qw=',body=>{
    body=once(body,'function bw(e,t){let n=null,s=null;','function bw(e,t){const __aimImpactPool=__aimCreatePresentationPool(()=>({star:d(null,1),glow:d(u,us.glowAlpha),zone:"body",roll:0,seed:0,bornTick:0}),entry=>{entry.star.removeFromParent();entry.glow.removeFromParent();entry.star.material.dispose();entry.glow.material.dispose()});let n=null,s=null;','impact pool');
    body=once(body,'p=>{n=p,a();for(const w of i)f(w.star,w.seed)}','p=>{a();if(__aimImpactPool.closed){p.dispose();return}n=p;for(const w of __aimImpactPool.values())f(w.star,w.seed)}','late impact texture');
    body=once(body,'m=p=>{e.remove(p.star),e.remove(p.glow),p.star.material.dispose(),p.glow.material.dispose()}','m=p=>{e.remove(p.star),e.remove(p.glow);p.star.visible=p.glow.visible=false;__aimImpactPool.release(p)}','impact release');
    body=once(body,'warmUp:()=>{const p=d(o()?.[0]??u,1),w=d(u,1);return[p,w]}','warmUp:()=>__aimImpactPool.warm().flatMap(entry=>{f(entry.star,entry.seed);entry.star.visible=entry.glow.visible=true;return[entry.star,entry.glow]})','retained impact warmup');
    body=once(body,'spawn(p,w,g){if(!Fv())return;const b=Aw(g,p),E=d(null,1),y=d(u,us.glowAlpha);','spawn(p,w,g){if(__aimImpactPool.closed||!Fv())return;const b=Aw(g,p),x=__aimImpactPool.take(),E=x.star,y=x.glow;E.visible=y.visible=true;E.frustumCulled=y.frustumCulled=true;','impact acquire');
    body=once(body,'const x={star:E,glow:y,zone:w,roll:rd(b,2)*Math.PI*2,seed:b,bornTick:g};','x.zone=w,x.roll=rd(b,2)*Math.PI*2,x.seed=b,x.bornTick=g;','impact live fields');
    body=once(body,'update(p){i=i.filter(w=>{const g=(p-w.bornTick)*we,b=us.lifeSeconds[w.zone];return g>=b?(m(w),!1):(v(w,g/b),!0)})}','update(p){let count=0;for(const w of i){const g=(p-w.bornTick)*we,b=us.lifeSeconds[w.zone];if(g>=b){m(w);continue}v(w,g/b);i[count++]=w}i.length=count}','impact in-place update');
    body=once(body,'dispose(){for(const p of i)m(p);i=[],c.dispose(),u.dispose();','dispose(){if(__aimImpactPool.closed)return;__aimImpactPool.dispose();i=[],c.dispose(),u.dispose();','impact ownership disposal');
    return body;
  });
}

function patchInterpolation(renderer,training){
  renderer=once(renderer,'function v0(A,g,w,D){const B=new Map;let C=-1,e=null,Q=null;',`function v0(A,g,w,D){const B=new Map;let C=-1,e=null,Q=null;
let __aimCurrent=null,__aimPrevious=null,__aimPreviousActorSource=null;const __aimPreviousActors=new Map;
function __aimCapture(snapshot){if(__aimCurrent!==null&&snapshot.tick===__aimCurrent.tick){__aimCurrent=snapshot;return}__aimPrevious=__aimCurrent!==null&&snapshot.tick===__aimCurrent.tick+1?__aimCurrent:null;__aimCurrent=snapshot;}`,'adjacent tick capture');
  renderer=once(renderer,'return{apply(M,U,d,L){s.length=0;const k=M.tick!==C;',`return{capture:__aimCapture,actorPosition(id){return B.get(id)?.mesh.root.position??null},apply(M,U,d,L){s.length=0;
const __aimCaptured=__aimCurrent===M,__aimPaired=__aimCaptured&&__aimPrevious!==null&&__aimPrevious.tick+1===M.tick;
if(__aimPaired&&__aimPreviousActorSource!==__aimPrevious){__aimPreviousActors.clear();for(const actor of __aimPrevious.actors)__aimPreviousActors.set(actor.id,actor);__aimPreviousActorSource=__aimPrevious;}
const k=M.tick!==C;`,'capture and actor-position API');
  renderer=once(renderer,'B.set(H.id,x)}(H.bornTick!==x.bornTick',`B.set(H.id,x)}if(__aimCaptured){const previous=__aimPaired?__aimPreviousActors.get(H.id):null;x.current=y;
if(previous&&previous.templateId===H.templateId&&previous.bornTick===H.bornTick&&previous.visible&&previous.alive){if(x.__aimPreviousActor!==previous){x.__aimPreviousActor=previous;x.__aimPreviousPose=D8(previous)}x.previous=x.__aimPreviousPose}else x.previous=y;
if(Math.hypot(x.current.x-x.previous.x,x.current.y-x.previous.y,x.current.z-x.previous.z)>Di)x.previous=x.current;}
(H.bornTick!==x.bornTick`,'actor adjacent pose');
  // The native vertical path includes stateful stair smoothing. Retain its
  // previous Y rather than subtracting today's stair offset from yesterday's
  // eye height, which would make the camera dip on an upward step.
  renderer=once(renderer,'Q===null?(e=m,Q=m):(k&&(e=Math.hypot(m.x-Q.x,m.y-Q.y,m.z-Q.z)>ti?m:Q),Q=m);',`Q===null?(e=m,Q=m):(k&&(e=Math.hypot(m.x-Q.x,m.y-Q.y,m.z-Q.z)>ti?m:Q),Q=m);if(__aimCaptured){if(__aimPaired){const previous=__aimPrevious.player,eye=ZA(previous,w);e={x:eye.x,y:e.y,z:eye.z};if(Math.hypot(M.player.position.x-previous.position.x,M.player.position.y-previous.position.y,M.player.position.z-previous.position.z)>ti)e=Q}else e=Q=m;}`,'camera adjacent horizontal pose with native stair smoothing');
  renderer=once(renderer,'B.clear(),C=-1,e=null,t=0,n=null,Q=null','B.clear(),C=-1,e=null,t=0,n=null,Q=null,__aimCurrent=null,__aimPrevious=null,__aimPreviousActorSource=null,__aimPreviousActors.clear()','capture cleanup');
  training=once(training,'va=null,Pm(M),Me&&Fo.length>0','va=null,xn?.capture(Me.snapshot()),Pm(M),Me&&Fo.length>0','initial snapshot');
  training=once(training,'va=null;const ze=is(Me);if(pa.advance','va=null;const ze=is(Me);xn?.capture(ze);if(pa.advance','tick snapshot');
  return [renderer,training];
}

function patchBotOrder(source){
  source=once(source,'Vt.write(t.botOrder.current,{camera:l.camera,snapshot:Q,seconds:pe})','Vt.write(t.botOrder.current,{camera:l.camera,snapshot:Q,seconds:pe,actorPosition:xn.actorPosition})','label rendered positions');
  source=once(source,'const V=Qo(P,U,zs(S.seconds,P.id));V.y+=vb;','const V=__aimOffsetBotOrderHead(Qo(P,U,zs(S.seconds,P.id)),P,S.actorPosition?.(P.id));V.y+=vb;','label interpolation');
  source=once(source,'const C=Qo(R,L,zs(S.seconds,R.id)),z=Wo(S.camera,C);','const C=__aimOffsetBotOrderHead(Qo(R,L,zs(S.seconds,R.id)),R,S.actorPosition?.(R.id)),z=Wo(S.camera,C);','aim-line interpolation');
  source=once(source,'Wt.aimLine||(t.botOrder.current.aim.shown=!1)):Zd(t.botOrder.current));const ze=','Wt.aimLine||(t.botOrder.current.aim.shown=!1)):Zd(t.botOrder.current),__aimPublishBotOrder(t.botOrder));const ze=','synchronous projected labels');
  source=section(source,'const If=12,d5=4,f5=Ge({__name:"BotOrderOverlay"',',yI=Xe(f5,',body=>{
    body=once(body,'l[x]!==""&&(T.classList.remove("is-shown"),l[x]="");','l[x]!==""&&(T.style.visibility="hidden",T.style.transform="",T.classList.remove("is-shown","is-next"),l[x]="",c[x]=!1);','clear hidden label');
    body=once(body,'const R=String(A.order);','T.style.visibility="visible";const R=String(A.order);','show current label');
    body=once(body,'let r=0,m=0,f=0,d=null;','let r=null,m=0,f=0,d=null;','label subscription');
    body=once(body,'function b(){g(n.view.current),r=requestAnimationFrame(b)}','function b(view){g(view)}','label callback');
    body=once(body,'r=requestAnimationFrame(b)','r=__aimSubscribeBotOrder(n.view,b)','mount label subscription');
    body=once(body,'r&&cancelAnimationFrame(r),r=0,','r?.(),r=null,','unmount label subscription');
    return body;
  });
  return source;
}

function patchActorWarmup(renderer,training){
  renderer=once(renderer,'function ya(A,g){const w=A.actorTemplates.get(g);return w?w.spawn():null}','function ya(A,g){const w=A.actorTemplates.get(g);return w?__aimActorWarmPool.take(A,g)??w.spawn():null}','consume retained actors');
  renderer=once(renderer,'return{root:D,blocks:B,actorTemplates:Q,fog:E,dispose(){D.clear(),B.clear(),Q.clear(),w.dispose(),o?.dispose()}}','return{root:D,blocks:B,actorTemplates:Q,fog:E,dispose(){__aimActorWarmPool.release(this);D.clear(),B.clear(),Q.clear(),w.dispose(),o?.dispose()}}','warm pool scene lifetime');
  renderer=once(renderer,'P=M=>{for(const U of M.mesh.parts)','P=M=>{M.mesh.skin?.skeleton?.dispose();for(const U of M.mesh.parts)','active actor skeleton ownership');
  renderer=once(renderer,'clear(){for(const M of B.values())P(M);B.clear(),C=-1','clear(){for(const M of B.values())P(M);__aimActorWarmPool.release(A);B.clear(),C=-1','renderer warm cleanup');
  renderer=serialize('__aimActorWarmCounts',actorWarmCounts)+serialize('__aimCreateActorWarmPool',createActorWarmPool)+'const __aimActorWarmPool=__aimCreateActorWarmPool(__aimActorWarmCounts);export const __aimReserveActorWarmPool=(scene,doc)=>__aimActorWarmPool.reserve(scene,doc);\n'+renderer;
  training=once(training,'const Te=[];for(const[Oe,Ye]of le.actorTemplates)try{Te.push(Ye.spawn().root);for(const Ze of pe.get(Oe)??[]){const _e=Ye.spawnHolding?.(Ze,!1);_e&&Te.push(_e.root)}}catch{}Te.push(...c.warmUp?.()??[],...i.warmUp?.()??[]),await l.prewarm(()=>t.phase.current!=="running"&&j===Za,Te)',`let reservation=null;try{reservation=__aimReserveActorWarmPool(le,M)}catch{}const Te=[...reservation?.roots??[]],temporary=[],decalWarm=[];
try{for(const[Oe,Ye]of le.actorTemplates)try{if(!reservation){const copy=Ye.spawn();temporary.push(copy);Te.push(copy.root)}for(const Ze of pe.get(Oe)??[]){const copy=Ye.spawnHolding?.(Ze,!1);if(copy){temporary.push(copy);Te.push(copy.root)}}}catch{}
for(const root of Te)root.traverse?.(node=>{if(node.isMesh)node.frustumCulled=false});
decalWarm.push(...c.warmUp?.()??[]);Te.push(...decalWarm,...i.warmUp?.()??[]);await l.prewarm(()=>t.phase.current!=="running"&&j===Za,Te);
if(j===Za&&fn===le&&t.phase.current!=="running")reservation?.commit();
}finally{reservation?.dispose();for(const copy of temporary){copy.root.removeFromParent();copy.skin?.skeleton?.dispose()}for(const root of decalWarm){root.removeFromParent();root.material?.dispose()}}`,'retained first-wave prewarm');
  training='import{__aimReserveActorWarmPool}from"./Do4sYkfr.js";\n'+training;
  return [renderer,training];
}

function patchStartReadiness(training){
  // as() remains callable without awaiting; callers which start a round can
  // additionally await the current load, including its existing stale-key guard.
  training=once(training,'if(qs===j)return;qs=j;','if(qs===j)return __aimViewModelPending;qs=j;','pending model readiness');
  training=once(training,'wv(M,le).then(Q=>{if(qs!==j','return __aimViewModelPending=wv(M,le).then(Q=>{if(qs!==j','await native model load');
  training=once(training,'function Cm(M){uc();const j=M.environment.map,le=++Za;if(!j){dc(M,le);return}Promise.all([ah(j),lh(j)]).then(([Q])=>{le===Za&&(nr=Q,l.setMapVisual(Q),dc(M,le))}).catch(Q=>{})}',`let __aimViewModelPending=null,__aimStartGeneration=0,__aimPreparation=Promise.resolve();
async function __aimReadyPresentation(current){return __aimWaitForStablePresentation({revision:()=>typeof __aimSkins==="undefined"?0:__aimSkins.selectionRevision,prepare:()=>typeof __aimSkins==="undefined"?undefined:__aimSkins.prepare(),load:()=>as(),model:()=>Ue,current})}
function Cm(M){uc();const j=M.environment.map,le=++Za;return __aimPreparation=(j?Promise.all([ah(j),lh(j)]).then(async([Q])=>{if(le===Za){nr=Q;l.setMapVisual(Q);await dc(M,le)}}):dc(M,le)).catch(Q=>{console.warn("Map preparation failed",Q)})}`,'tracked scene preparation');
  training=once(training,'async function dc(M,j){if(!l.prewarm)return;const le=fn,Q=[],pe=new Map;','async function dc(M,j){if(!l.prewarm)return;const le=fn;if(!await __aimReadyPresentation(()=>j===Za&&!Ys&&fn===le))return;const Q=[],pe=new Map;','skin audio and current model before GPU warmup');
  training=once(training,'function kc(){ya(!1),gc(),n.onLastResult(null),n.onSessionActive(!0),n.onPhaseChange("running"),Nn()||_o()}',`async function kc(){const request=++__aimStartGeneration;ya(!1);n.onPhaseChange("idle");gc();const generation=Za,built=fn,current=()=>request===__aimStartGeneration&&!Ys&&fn===built&&generation===Za&&t.phase.current==="idle";try{await __aimPreparation;if(!current()||!await __aimReadyPresentation(current))return;n.onLastResult(null),n.onSessionActive(!0),n.onPhaseChange("running"),Nn()||_o()}catch(error){if(current())console.warn("Presentation preparation failed",error)}}`,'await stable presentation before simulation start');
  return training;
}

export function applyUpstreamPerformancePatch(modules,{renderAllocations=true}={}){
  let world=modules['CqM6URxy.js'],training=modules['CBthEhpW.js'],renderer=modules['Do4sYkfr.js'];
  if([world,training,renderer].some(value=>typeof value!=='string'))throw Error('Upstream performance missing world/training/actor source');
  if(training.includes('__aimUpstreamPerformance'))throw Error('Upstream performance already applied');
  world=once(world,'function l(A,u,f,h){const d=u.map(m=>({light:m,score:gP(m,f)})).filter(m=>m.score>0).sort((m,g)=>g.score-m.score).slice(0,A.length);','const __aimLightSelected=[],__aimLightScores=[];function l(A,u,f,h){const d=__aimStableLightTopK(u,A.length,light=>gP(light,f),__aimLightSelected,__aimLightScores);','stable Top-K lights');
  world=once(world,'const{light:E}=p;if(g.position.copy(E.position)','const E=p;if(g.position.copy(E.position)','selected light source');
  // A second reservation must not be committed after awaiting an unrelated
  // warm pass. Queue it and recheck the caller's generation before attaching.
  world=once(world,'function T(D,U){if(_)return _;','function T(D,U){if(_)return _.then(()=>{if(!v&&D())return T(D,U)});','serialize warm reservations');
  world=serialize('__aimStableLightTopK',stableLightTopK)+world;
  training=exact(training,'maxFps:nt?t.maxFps?.current??0:0','maxFps:t.maxFps?.current??0',2,'browser numeric FPS cap');
  training=once(training,'const R=n.now();if(R>=p)return!0;const L=Math.floor(p-R-Zw-g);','const R=n.deferFrame?n.now():I;if(R>=p||!n.deferFrame&&p-R<.25)return!0;const L=Math.floor(p-R-Zw-g);','RAF display clock and tolerance');
  training=once(training,'function x(){const I=E();if(I===0)return;const R=n.now();','function x(frameTime){const I=E();if(I===0)return;const R=n.deferFrame?n.now():frameTime;','RAF next deadline');
  training=once(training,'if(v++,x(),!L)','if(v++,x(I),!L)','pass display timestamp');
  training=once(training,'function ep(M){','const __aimRenderOptionsChanged=__aimCreateRenderOptionsGate();function ep(M){','settings gate');
  training=once(training,'if(tl.setOptions({renderEveryNthFrame:nt?1:t.renderEveryNthFrame.current,','if(__aimRenderOptionsChanged(t.renderEveryNthFrame.current,t.maxFps?.current??0,t.showPerformance.current)&&tl.setOptions({renderEveryNthFrame:nt?1:t.renderEveryNthFrame.current,','unchanged render options');
  training=once(training,'pointerEvents:"none"}),e.appendChild(t);const n=t.getContext("2d");let s=!1;','pointerEvents:"none",display:"none"}),e.appendChild(t);const n=t.getContext("2d");let s=!1;','idle effect canvas');
  training=once(training,'i=()=>{!s||!n||(n.clearRect(0,0,t.width,t.height),s=!1)};','i=()=>{!s||!n||(n.clearRect(0,0,t.width,t.height),s=!1);t.style.display!=="none"&&(t.style.display="none")};','hide cleared effect');
  training=once(training,'if(n.clearRect(0,0,w,g),s=!0,p&&d)','if(s||(t.style.display="block"),n.clearRect(0,0,w,g),s=!0,p&&d)','show active effect');
  training=once(training,'function q0(e,t,n,s){let o=0;','function q0(e,t,n,s){if(e.length===0)return 0;let o=0;','empty particle generator');
  training=once(training,'xe.mesh.visible=!0,Ee===_.lightScene?A.light=!0:A.flash=!0,fe=xe','xe.mesh.visible=!0,fe=xe','defer layer participation');
  training=once(training,'ve.mesh.geometry.setDrawRange(0,ie);for(const be of ve.attrs)be.needsUpdate=!0;ve.mesh.material.userData.dyn===!0&&(ve.dynAttr.needsUpdate=!0),S(ve.sink,ie,D),ie===0&&(ve.mesh.visible=!1),fe=null','ve.mesh.geometry.setDrawRange(0,ie);__aimMuzzleUploadRanges(ve,ie),S(ve.sink,ie,D),ie>0?(ve.scene===_.lightScene?A.light=!0:A.flash=!0):(ve.mesh.visible=!1),fe=null','nonempty layers and prefix uploads');
  // New tracers already use a bounded shared geometry/material batch. Preserve
  // their new weapon-dependent visuals; fix the late bitmap ownership branch.
  training=once(training,'if(o){for(const m of r)m.dispose();return}e=r','if(o){for(const m of r){m.dispose();m.userData.assetBitmap?.close()}return}e=r','late tracer image cleanup');
  training=patchImpact(training);
  training=patchHudClocks(training);
  [renderer,training]=patchInterpolation(renderer,training);
  training=patchBotOrder(training);
  [renderer,training]=patchActorWarmup(renderer,training);
  training=patchStartReadiness(training);
  training='/*__aimUpstreamPerformance:2026-11-05__*/\n'+serialize('__aimWaitForStablePresentation',waitForStablePresentation)+serialize('__aimCreatePresentationPool',createBoundedPresentationPool)+serialize('__aimMuzzleUploadRanges',markMuzzleUploadRanges)+serialize('__aimCreateHudFrameQueue',createHudFrameQueue)+serialize('__aimCreateRenderOptionsGate',createRenderOptionsGate)+serialize('__aimPublishBotOrder',publishBotOrder)+serialize('__aimSubscribeBotOrder',subscribeBotOrder)+serialize('__aimOffsetBotOrderHead',offsetBotOrderHead)+'const __aimUpstreamHudFrames=__aimCreateHudFrameQueue(callback=>requestAnimationFrame(callback),id=>cancelAnimationFrame(id));\n'+training;
  const output=applyUpstreamInstancePerformancePatch({...modules,'CqM6URxy.js':world,'CBthEhpW.js':training,'Do4sYkfr.js':renderer});
  // The opt-out supports isolated A/B and differential tests; builds default on.
  return renderAllocations?applyUpstreamRenderAllocationPatch(output):output;
}

export const upstreamPerformanceCoverage=Object.freeze({
  framerate:'Ported numeric browser cap, RAF timestamp, deadline tolerance; settings UI is integrated separately.',
  hud:'Ported shared display-clock queue and unchanged render-option gate. Native status widgets retained; old field-specific gates are not applied to new ability schemas.',
  botOrder:'Ported same-frame publish/subscribe and rendered actor offset for labels and aim lines; existing badge CSS patch is required.',
  world:'Ported stable light Top-K and inactive screen canvas hiding. Optional spatial regrouping/fence polling remains disabled.',
  renderAllocation:'Reuse renderer-local actor-ID scratch storage and write actor/camera scalar interpolation directly; retain snapshot, simulation, RNG and replay semantics.',
  instances:'Ported separate instance visibility compaction transform and active-viewport map resource leases.',
  muzzleLayer:'Ported visibility based on emitted geometry, preserving mask/order.',
  muzzleUpload:'Ported prefix update ranges and empty generator exit.',
  impactTracer:'Ported bounded impact Mesh/Material pool and retained warm entries; native shared atlas retained. Native new tracers already batch bounded geometry and upload active prefixes; old tracer visuals intentionally not restored.',
  interpolation:'Ported adjacent simulation snapshots for actors and camera XZ; native vertical stair smoothing and new held-weapon/ability state preserved.',
  prewarm:'Await tracked scene preparation, stable skin selection/audio and current model readiness before simulation starts. Native shader/map shadow warmup retained; first-wave actors retained and temporary skeletons released. Old loading UI/coordinator is not transplanted into new ability lifecycles.',
  actorPrewarm:'Ported reservation/commit/dispose pool without advancing simulation or RNG.',
  trainingHall:'Existing trainingHallVisibilityCss remains compatible; append in build.',
});
