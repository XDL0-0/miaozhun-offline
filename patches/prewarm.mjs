// Version-pinned transforms. This module never writes site/dist or starts a world.
function replaceOne(text, before, after, label) {
  if (text.split(before).length !== 2) throw new Error(`Prewarm patch version mismatch: ${label}`);
  return text.replace(before, after);
}

function editSection(text, start, end, edit, label) {
  if (text.split(start).length !== 2 || text.split(end).length !== 2) throw new Error(`Prewarm patch version mismatch: ${label}`);
  const a = text.indexOf(start), b = text.indexOf(end, a);
  if (b < a) throw new Error(`Prewarm patch invalid section: ${label}`);
  return text.slice(0, a) + edit(text.slice(a, b)) + text.slice(b);
}

// Kept dependency-free so race/error/timeout behavior can be tested without WebGL.
export function createSceneReadyGate({onState = () => {}, timeoutMs = 60000, timers = globalThis} = {}) {
  let serial = 0, active = null, state = {status: 'idle', generation: 0};
  const publish = value => { state = value; onState(value); };
  function cancel(reason = 'scene changed') {
    if (!active) {
      if (state.status !== 'idle' && state.status !== 'cancelled') publish({status: 'cancelled', generation: state.generation, reason});
      return;
    }
    const job = active;
    job.finish({status: 'cancelled', generation: job.id, reason});
    job.controller.abort(reason);
  }
  function run(work) {
    cancel();
    const controller = new AbortController(), id = ++serial;
    let timer, settled = false, resolve;
    const promise = new Promise(done => { resolve = done; });
    const job = {id, controller, promise, finish(value) {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      if (active === job) { active = null; publish(value); }
      resolve(value);
    }};
    active = job;
    const check = () => {
      if (settled || active !== job || controller.signal.aborted) throw new Error('Preparation cancelled');
    };
    publish({status: 'loading', generation: id});
    timer = timers.setTimeout(() => {
      if (settled) return;
      job.finish({status: 'failed', generation: id, error: new Error('资源准备超过 60 秒，请重试。')});
      controller.abort('timeout');
    }, timeoutMs);
    Promise.resolve().then(() => work({signal: controller.signal, generation: id, check,
      phase(label) { check(); publish({status: 'loading', generation: id, label}); }
    })).then(() => { check(); job.finish({status: 'ready', generation: id}); }, error => {
      if (!settled && active === job) job.finish({status: 'failed', generation: id, error});
    }).catch(() => {});
    return promise;
  }
  return {run, cancel, get state() { return state; }, get ready() { return state.status === 'ready'; }};
}

// A decoded model can still be replaced by a selection made during GPU work.
// Repeat the small loadout until both its identity and every visual revision settle.
export async function prepareStableVisuals({load, warm, check = () => {}, identity = () => ''}) {
  for (;;) {
    check();const selected = identity(), entries = await load();check();
    const revisions = [];
    for (const entry of entries) {await entry.model.ready?.();check();revisions.push(entry.model.visualRevision?.() ?? 0);}
    const stable = () => selected === identity() && entries.every((entry, index) => (entry.model.visualRevision?.() ?? 0) === revisions[index]);
    try {await warm(entries);} catch(error) {check();if(stable())throw error;continue;}check();
    if (stable()) return entries;
  }
}

// Lv starts one batch for each nonempty emitter in every surviving system.
// Bound those windows at the weapon's fastest (including burst) shot interval;
// sampling age bins also covers switching between hip fire and ADS mid-spray.
export function planMuzzleBatches(manifest, weapon, {intervalSeconds, maxUpdateSeconds = .1, hasMaterial = () => true} = {}) {
  const gun=manifest.guns[weapon];if(!gun)return {emitters:[],maxWindowSeconds:0};
  const variants=rules=>rules.flatMap(rule=>(manifest.systems[rule.sys]?.emitters??[]).filter(e=>e.enabled&&e.mat&&hasMaterial(e.mat)));
  const hip=variants(gun.hip),ads=variants(gun.ads),single=hip.length>=ads.length?hip:ads;
  if(!['LeavePrevious','DeactivatePrevious'].includes(gun.prev))return {emitters:single,maxWindowSeconds:0};
  if(!(intervalSeconds>0&&Number.isFinite(intervalSeconds)))throw Error('Missing weapon interval for particle preparation');
  function upper(d){
    if(!d)return 0;if(Number.isFinite(d.c))return d.c;
    if(d.curve){const values=[];for(let i=0;i<d.curve.length;i++){const a=d.curve[i];values.push(a[1]);const b=d.curve[i+1];if(b&&a[2]!=='CIM_Constant'&&a[2]!=='CIM_Linear'){const span=b[0]-a[0];values.push(a[1]+span*(a[4]??0)/3,b[1]-span*(b[3]??0)/3)}}return Math.max(0,...values)}
    return Math.max(0,...(d.v??[]));
  }
  function window(emitter){
    const life=upper(emitter.mods?.filter(m=>m.t==='life').at(-1)?.d);if(!(life>0&&Number.isFinite(life)))throw Error('Unbounded particle lifetime: '+emitter.name);
    const burst=(emitter.burst??[]).filter(b=>b[0]>0).map(b=>b[2]*emitter.duration),rate=upper(emitter.rate),delay=Math.max(0,emitter.delay??0);
    const start=delay+(rate>0?0:Math.min(...burst)),last=Math.max(rate>0?(emitter.loops>0?emitter.duration*emitter.loops:3):-Infinity,...burst);
    return {emitter,start,end:delay+last+life+maxUpdateSeconds};
  }
  const hipWindows=hip.map(window),adsWindows=ads.map(window),maxWindowSeconds=Math.max(0,...[...hipWindows,...adsWindows].map(w=>w.end)),emitters=[];
  for(let bin=0;bin<=Math.ceil(maxWindowSeconds/intervalSeconds);bin++){
    const from=bin*intervalSeconds,to=from+intervalSeconds,intersects=w=>w.start<=to&&w.end>=from;
    const h=hipWindows.filter(intersects),a=adsWindows.filter(intersects);
    emitters.push(...(h.length>=a.length?h:a).map(w=>w.emitter));
  }
  return {emitters,maxWindowSeconds};
}

const warmVisual = `async function __aimWarmVisual(renderer,scene,camera,check=()=>{}){
 check();await renderer.compileAsync(scene,camera);check();
 const target=renderer.getRenderTarget(),viewport=renderer.getViewport(new On),scissor=renderer.getScissorTest(),auto=renderer.autoClear;
 const scratch=new Uc(1,1,{depthBuffer:true,stencilBuffer:false});
 try{renderer.setRenderTarget(scratch);renderer.setScissorTest(false);renderer.autoClear=true;renderer.render(scene,camera)}
 finally{renderer.setRenderTarget(target);renderer.setViewport(viewport);renderer.setScissorTest(scissor);renderer.autoClear=auto;scratch.dispose()}
 check();
}
async function __aimWarmOutputPass(renderer,scene,camera,target,viewport,check=()=>{}){
 const previousTarget=renderer.getRenderTarget(),previousViewport=renderer.getViewport(new On),scissor=renderer.getScissor(new On),scissorTest=renderer.getScissorTest(),auto=renderer.autoClear,color=renderer.getClearColor(new ht),alpha=renderer.getClearAlpha();
 const output=()=>{renderer.setRenderTarget(target);renderer.setViewport(viewport);renderer.setScissor(viewport.x,viewport.y,1,1);renderer.setScissorTest(true);renderer.autoClear=false};
 try{check();output();await renderer.compileAsync(scene,camera);check();output();renderer.render(scene,camera);check()}
 finally{renderer.setRenderTarget(previousTarget);renderer.setViewport(previousViewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.autoClear=auto;renderer.setClearColor(color,alpha)}
}
async function __aimGpuFence(renderer,check){
 check();const gl=renderer.getContext();if(gl.isContextLost())throw Error("图形上下文已丢失，请重试。");
 if(!gl.fenceSync){await new Promise(r=>setTimeout(r,0));check();return}
 const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!fence)throw Error("无法确认图形预热完成。");gl.flush();
 try{for(;;){check();if(gl.isContextLost())throw Error("图形上下文已丢失，请重试。");const status=gl.clientWaitSync(fence,0,0);if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)return;if(status===gl.WAIT_FAILED)throw Error("图形预热失败。");await new Promise(r=>setTimeout(r,8))}}
 finally{gl.deleteSync(fence)}
}`;

const gateIntegration = `let __aimMapReady=Promise.resolve(),__aimModelReady=Promise.resolve(),__aimWarmDoc=null,__aimWarmJob=Promise.resolve({status:"idle"}),__aimWarmRestart=0,__aimPreparedSelection=null;
 const __aimWarmIdentity=()=>[qe(),ao(),t.viewModel.current,t.viewModelGun.current,t.botOrderWanted?.current,JSON.stringify(t.audio?.current),JSON.stringify(t.botOrderParts?.current)].join("|");
 const __aimWarmSelection=()=>__aimWarmIdentity()+"|"+[...Ut].map(([key,value])=>key+":"+(value.model.visualRevision?.()??0)).join("|");
 const __aimWarmNotice=document.createElement("div");__aimWarmNotice.dataset.role="scene-preparation";__aimWarmNotice.setAttribute("role","status");
 Object.assign(__aimWarmNotice.style,{position:"absolute",left:"50%",top:"18px",transform:"translateX(-50%)",zIndex:"80",padding:"10px 14px",borderRadius:"8px",background:"#17202bea",color:"#fff",font:"14px system-ui",pointerEvents:"auto",maxWidth:"80%"});
 const __aimWarmText=document.createElement("span"),__aimWarmRetry=document.createElement("button");__aimWarmRetry.type="button";__aimWarmRetry.textContent="重试";__aimWarmRetry.style.marginLeft="12px";__aimWarmNotice.append(__aimWarmText,__aimWarmRetry);e.appendChild(__aimWarmNotice);
 const __aimWarmGate=__aimCreateReadyGate({onState(value){
   if(Ro)return;if(value.status==="ready")__aimPreparedSelection=__aimWarmSelection();n.onPreparationChange?.(value);__aimWarmNotice.dataset.state=value.status;__aimWarmNotice.hidden=value.status==="ready"||value.status==="cancelled";
   __aimWarmText.textContent=value.status==="failed"?"准备失败："+(value.error?.message??"未知错误"):value.label??"正在准备本场景资源…";
   __aimWarmRetry.hidden=value.status!=="failed";
 }});
 __aimWarmRetry.onclick=()=>{if(__aimWarmDoc&&!Ro)__aimBeginWarm(__aimWarmDoc,true)};
 function __aimCanStart(){if(t.session.current==="calibration")return true;if(__aimWarmGate.ready){if(__aimPreparedSelection===__aimWarmSelection())return true;if(__aimWarmDoc)__aimBeginWarm(__aimWarmDoc)}__aimWarmNotice.hidden=false;return false}
 function __aimBeginWarm(doc,retry=false){
  if(retry){Xu(doc);Yu(doc);d.prepare(doc)}
  __aimWarmDoc=doc;const built=Nt;
  __aimWarmJob=__aimWarmGate.run(async ctx=>{
   ctx.phase("正在加载地图与当前角色…");await __aimMapReady;ctx.check();
   await __aimSceneAssetsReady(doc,i.renderer,ctx.check);ctx.check();
   ctx.phase("正在准备本场景技能与枪械…");await d.ready(i.renderer,i.camera,ctx.check);ctx.check();
   await h?.prepare(i.renderer,i.camera,ctx.check);ctx.check();
   if(doc.props?.some(p=>p.kind==="lockdown"))await M.ready();ctx.check();
   if(Nt!==built)throw Error("场景已经切换。");
   await __aimPrepareStableVisuals({check:ctx.check,identity:__aimWarmIdentity,load:async()=>{await __aimPrepareAuxiliary(ctx);return __aimPrepareLoadout(ctx)},warm:async entries=>{
    ctx.phase("正在编译与预绘画面…");
    for(const entry of entries){ctx.check();const layer=entry.model.fxLayer?.();if(layer)await __aimWarmVisual(i.renderer,layer.scene,layer.camera,ctx.check);if(Xc(entry.weapon).canFire){const profile=Gs(entry.weapon),rate=Math.max(profile.firingRatePerSecond,profile.firingRatePerSecond*(profile.ads.fireRateMultiplier??1),profile.ads.burst?.internalRatePerSecond??0);await f.prepare(entry.weapon,i.renderer,entry.model,ctx.check,{intervalSeconds:1/rate})}}
    await ju(doc,Vs,ctx);ctx.check();await __aimGpuFence(i.renderer,ctx.check);
   }});
  });return __aimWarmJob;
 }
 async function __aimPrepareLoadout(ctx){
  await ie.prepare?.(ctx.check);ctx.check();await _n();ctx.check();if(!t.viewModel.current)return[];
  const weapons=[qe(),ao(),...(Qn?["melee"]:[])],entries=[],stems=new Set;
  for(const weapon of weapons){const stem=wn(weapon).stem;if(stems.has(stem))continue;stems.add(stem);const cacheKey=Lo(stem);let cached=Ut.get(cacheKey);
   if(!cached){const assets=await D0(stem,{...us(),knife:stem===wn("melee").stem});ctx.check();if(!assets)throw Error("枪械模型未能加载："+stem);cached={model:O0(assets),stem};Ut.set(cacheKey,cached)}
   const model=cached.model;model.setFovHorizontal(t.viewModelFov.current);model.setHand(t.viewModelHand.current);model.setGun(ua(weapon,t.viewModelGun.current));await model.ready?.();ctx.check();
   if(Qn&&model.setEquip){let equip=is.get(stem);if(!equip){equip=N0(stem);is.set(stem,equip)}const clip=await equip;ctx.check();if(!clip&&stem!=="outlaw")throw Error("切枪动画未能加载："+stem);if(clip)model.setEquip(clip)}
   entries.push({weapon,model});
  }return entries;
 }
 async function __aimPrepareAuxiliary(ctx){
  if(!t.botOrderWanted?.current||!vt)return;const collision=qn();if(!collision)return;
  Se??=ig(vt,collision,la(vt.environment.map));ctx.phase("正在准备辅助预瞄…");
  while(!Se.prepared()){ctx.check();Se.advance(6);await new Promise(resolve=>setTimeout(resolve,0))}
  ctx.check();if(t.botOrderParts?.current?.headLines){const lines=Se.headLines();if(lines&&Ke?.source!==lines){Ke?.dispose();Ke=Kh(lines);i.scene.add(Ke.object)}}
 }
 `;

function patchCharacterAssets(text) {
  text = editSection(text, 'function rg(A){', 'const EC={', body => {
    body = replaceOne(body, 'const g=YQ.get(A);if(g)return g;', 'const g=YQ.get(A);if(g){if(!g.userData.__aimReadyFailed)return g;YQ.delete(A);g.dispose()}', 'actor failed cache retry');
    body = replaceOne(body, 'typeof createImageBitmap=="function"&&D.load()', 'w.userData.__aimReady=typeof createImageBitmap==="function"?D.load()', 'actor texture promise');
    return replaceOne(body, 'w.needsUpdate=!0},B=>{}),w}', 'w.needsUpdate=!0;return w},B=>{w.userData.__aimReadyFailed=true;throw B}):Promise.reject(Error("浏览器无法解码角色贴图。")),w.userData.__aimReady.catch(()=>{}),w}', 'actor texture completion');
  }, 'actor textures');
  text = editSection(text, 'function vf(A){', 'function df(A,g,D){', body => {
    body = replaceOne(body, 'const g=hQ.get(A);if(g)return g;', 'const g=hQ.get(A);if(g){if(!g.userData.__aimReadyFailed)return g;hQ.delete(A);g.dispose()}', 'weapon failed cache retry');
    body = replaceOne(body, 'typeof document<"u"&&Ee(', 'w.userData.__aimReady=typeof document<"u"?Ee(', 'weapon texture promise');
    return replaceOne(body, 'w.needsUpdate=!0},Q=>{throw C(),Q})).catch(B=>{}),w}', 'w.needsUpdate=!0;return w},Q=>{throw C(),Q})).catch(error=>{w.userData.__aimReadyFailed=true;throw error}):Promise.reject(Error("无法解码枪械贴图。")),w.userData.__aimReady.catch(()=>{}),w}', 'weapon texture completion');
  }, 'weapon textures');
  text = editSection(text, 'function us(A,g){', 'const wB=Math.PI*2', body => {
    body = replaceOne(body, 'let D=null,w=null,B=!1,C=!1;', 'let D=null,w=null,B=!1,C=!1,__aimReady=null;', 'lockdown ready state');
    const before = 'E=()=>{w||B||(B=!0,hn().then(e=>{if(e){if(C){e.geometry.dispose(),e.df.dispose(),e.mask.dispose();return}w=e,D&&I(D,e),g?.()}}))}';
    const after = 'E=()=>{if(w)return Promise.resolve(w);if(__aimReady)return __aimReady;B=!0;__aimReady=hn().then(e=>{if(!e)throw Error("奇乐装置资源未能加载。");if(C){e.geometry.dispose(),e.df.dispose(),e.mask.dispose();throw Error("Preparation cancelled")}w=e,D&&I(D,e),g?.();return e}).catch(error=>{B=!1;__aimReady=null;throw error});__aimReady.catch(()=>{});return __aimReady}';
    body = replaceOne(body, before, after, 'lockdown promise');
    return replaceOne(body, 'return{apply(e,P){', 'return{async ready(){await E();if(C)throw Error("Preparation cancelled");D||(D=Q(),I(D,w));return w},warmUp(){return D?Object.values(D.slots[0]).filter(v=>v?.isMesh).map(v=>{const copy=v.clone();copy.visible=true;return copy}):[]},apply(e,P){', 'lockdown prewarm API');
  }, 'lockdown loader');
  text = editSection(text, 'function xs(A,g){', 'const Es=.04;', body => {
    body = replaceOne(body, 'd=async(a,k)=>{', 'd=async(a,k,check)=>{', 'smoke cancellation argument');
    body = replaceOne(body, 'c.map(async i=>{const[l,u]', 'c.map(async i=>{if(s.has(i))return;const[l,u]', 'smoke decoded pack reuse');
    body = replaceOne(body, 's.set(i,N)}catch{}})),!U){', 's.set(i,N)}catch{}})),c.some(key=>!s.has(key)))throw Error("烟雾资源未能加载。");check();if(U)throw Error("Preparation cancelled");if(!U){', 'smoke asset validation');
    body = replaceOne(body, 'Q.encode.value=H?1:0,n=D.flatMap', 'Q.encode.value=H?1:0;if(!n.length){n=D.flatMap', 'smoke retry avoids duplicate draws');
    body = replaceOne(body, '(l.translucent?B:w).add(l.mesh);for(const i of s.values())', '(l.translucent?B:w).add(l.mesh)}for(const i of s.values())', 'smoke retry draw scope');
    body = replaceOne(body, 'try{await Promise.all([a.compileAsync(w,k),a.compileAsync(B,k)])}catch{}U||(v(a,k),h=!U)', 'await Promise.all([a.compileAsync(w,k),a.compileAsync(B,k)]);check();if(U)throw Error("Preparation cancelled");v(a,k),h=!U', 'smoke compile and stale draw checks');
    body = replaceOne(body, 'a.render(w,k),a.render(B,k)}catch{}finally{', 'a.render(w,k),a.render(B,k)}finally{', 'smoke draw failure propagation');
    return replaceOne(body, 'prepare(a,k){return G??=(async()=>{try{await d(a,k)}catch{}})(),G}', `prepare(a,k,check=()=>{}){const start=()=>{if(G)return G.then(()=>check());const pending=d(a,k,check).catch(error=>{if(G===pending)G=null;throw error});G=pending;return pending};return G?G.then(()=>check(),error=>{check();return start()}):start()}`, 'smoke preparation propagation and cancellation retry');
  }, 'smoke readiness');
  text += `\nexport async function __aimPrewarmSceneAssets(doc,renderer,check=()=>{}){
 check();
 const textures=new Set;
 for(const actor of doc.actors??[]){if(actor.body?.shape==="sphere")continue;const look=IC(actor.body?.look);if(vw(look)){const mesh=await Hf(look);check();if(!mesh)throw Error("角色网格未能加载："+look)}
  for(const key of Object.values(pB(look)))textures.add(rg(key));
  const weapon=ED(actor.body?.weapon);if(weapon&&weapon!=="vandal"){const pack=await HE(weapon);check();if(!pack)throw Error("角色武器未能加载："+weapon);for(const part of pack.parts)if(part.texture&&"file"in part.texture)textures.add(vf(part.texture.file))}
 }
 await Promise.all([...textures].map(texture=>texture.userData.__aimReady));check();for(const texture of textures)renderer.initTexture(texture);
}\n`;
  return text;
}

function patchFlash(text) {
  text = replaceOne(text, 't=Vm(e),Tl.set(e,t)', 't=Vm(e).then(texture=>{if(!texture)Tl.delete(e);return texture}),Tl.set(e,t)', 'flash texture retry after decode failure');
  text = replaceOne(text, 'l&&(s[i]=l)})),{key:e,systems:o,meshes:n.meshes??{},textures:s}', 'l&&(s[i]=l)})),Object.keys(s).length!==a.size?Promise.reject(Error("闪光贴图未能加载。")):{key:e,systems:o,meshes:n.meshes??{},textures:s}', 'flash texture validation');
  text = replaceOne(text, 'function uv(){const e={}', 'function uv(){const __aimWarmMaterials=new Map;const e={}', 'flash prewarm material ownership');
  text = replaceOne(text, 'return{addPack(I){o.has(I.key)', `return{async prewarm(renderer,camera,check){
   check();for(const texture of Object.values(n))renderer.initTexture(texture);
   const scene=new ho,variants=new Set;
   try{for(const system of Object.values(e))for(const emitter of system.emitters??[]){const material=Ai[emitter.mat];if(!material)continue;const sprite=!emitter.mesh,key=emitter.mat+"|"+sprite;if(variants.has(key))continue;variants.add(key);let compiled=__aimWarmMaterials.get(key);if(!compiled){compiled=h(material,sprite);if(!compiled)throw Error("闪光材质无法创建。");__aimWarmMaterials.set(key,compiled)}const mesh=new yt(l,compiled);mesh.frustumCulled=false;scene.add(mesh)}
    await __aimWarmVisual(renderer,scene,camera,check);for(const pass of [g,_,O,k])await __aimWarmVisual(renderer,pass.scene,A,check)
   }finally{scene.clear()}
  },addPack(I){o.has(I.key)`, 'flash GPU preparation');
  text = replaceOne(text, 'a.clear(),l.dispose(),s.dispose();for(const I of[f,m,x,w,b])', 'a.clear();for(const material of __aimWarmMaterials.values())material.dispose();__aimWarmMaterials.clear();l.dispose(),s.dispose();for(const I of[f,m,x,w,b])', 'flash prewarm material disposal');
  text = replaceOne(text, 'active(){return s>0},amount(){return s}', 'async prewarm(renderer,check){await __aimWarmVisual(renderer,e,t,check)},active(){return s>0},amount(){return s}', 'nearsight preparation');
  text = replaceOne(text, 'function yv(){let e=null,t=null;', 'function yv(){let e=null,t=null,__aimReady=Promise.resolve();', 'flash ready state');
  text = replaceOne(text, 'const c=e;if(c)for(const p of r)c.hasPack(p)||Gm(p).then(d=>c.addPack(d),()=>{})},observe(l,u){', 'const c=e;__aimReady=Promise.all([...r].map(p=>c.hasPack(p)?null:Gm(p).then(pack=>c.addPack(pack))));__aimReady.catch(()=>{});return __aimReady},async ready(renderer,camera,check){await __aimReady;check();if(e)await e.prewarm(renderer,camera,check);if(t)await t.prewarm(renderer,check)},observe(l,u){', 'flash ready promise');
  return text;
}

function patchMuzzle(text) {
  return editSection(text, 'function qv(e){', 'function Zv(e,t,n,o,a){', body => {
    body = replaceOne(body, 'const i=[];let l=null', 'const i=[],__aimTextureTasks=new Map;let l=null', 'muzzle tasks');
    body = replaceOne(body, 'if(!t||m.has(S)||x.has(S))return;', 'if(m.has(S))return Promise.resolve();if(__aimTextureTasks.has(S))return __aimTextureTasks.get(S);if(!t)return Promise.reject(Error("枪焰清单未就绪。"));', 'muzzle texture dedupe');
    body = replaceOne(body, 'const F=b.has(S);P0(', 'const F=b.has(S);const __task=P0(', 'muzzle texture promise');
    body = replaceOne(body, '.catch(V=>{x.delete(S)})}function _(S)', '.catch(V=>{x.delete(S);__aimTextureTasks.delete(S);throw V});__aimTextureTasks.set(S,__task);__task.catch(()=>{});return __task}function _(S)', 'muzzle texture errors');
    const old = 'let me=!1;function te(){me=!0,(e.load??bv)().then(S=>{if(!(a||!S)){t=S;for(const K of Object.values(S.materials))K.kind==="mf"&&K.lut&&b.add(K.lut),K.kind==="fakelight"&&b.add(K.lut);if(n=Rv(S,y,{detail:o,hasMaterial:K=>_(K)!==null}),s)for(const K of Il(S,s.weapon))g(K)}})}';
    const replacement = 'let me=!1,__aimManifest=null;function te(){if(__aimManifest)return __aimManifest;me=!0;__aimManifest=Promise.resolve().then(()=> (e.load??bv)()).then(S=>{if(a)throw Error("Preparation cancelled");if(!S)throw Error("枪焰清单未能加载。");t=S;for(const K of Object.values(S.materials))K.kind==="mf"&&K.lut&&b.add(K.lut),K.kind==="fakelight"&&b.add(K.lut);n=Rv(S,y,{detail:o,hasMaterial:K=>_(K)!==null});if(s)for(const K of Il(S,s.weapon))g(K);return S}).catch(error=>{me=!1;__aimManifest=null;throw error});__aimManifest.catch(()=>{});return __aimManifest}';
    body = replaceOne(body, old, replacement, 'muzzle manifest ready');
    body = replaceOne(body, 'const k=[];let C=null;', 'const k=[];let C=null,__aimPreparing=0,__aimParticleWarm=Promise.resolve();', 'muzzle preparation ownership');
    body = replaceOne(body, 'render(S,K){if(a||!s)return;', 'render(S,K){if(a||!s||__aimPreparing)return;', 'muzzle draws cannot reset batches during preparation');
    return replaceOne(body, 'return{frame(S){', `return{async prepare(weapon,renderer,model,check=()=>{}){
     const previous=__aimParticleWarm;let release;__aimParticleWarm=new Promise(resolve=>release=resolve);await previous;__aimPreparing++;try{check();
     await te();check();if(!t.guns[weapon])return;await Promise.all(Il(t,weapon).map(g));check();
     for(const trigger of [...t.guns[weapon].hip,...t.guns[weapon].ads])for(const emitter of t.systems[trigger.sys]?.emitters??[])if(emitter.enabled&&emitter.mat&&!_(emitter.mat))throw Error("枪焰材质未能准备。");
     for(const texture of w.splice(0))renderer.initTexture(texture);
     const layer=model.fxLayer?.();if(!layer)throw Error("枪械画面未能准备。");
     const target=renderer.getRenderTarget(),viewport=renderer.getViewport(new On),scissor=renderer.getScissorTest(),scissorRect=renderer.getScissor(new On),auto=renderer.autoClear,color=renderer.getClearColor(new ht),alpha=renderer.getClearAlpha();
     try{const q=C??=jv(z);H(q,renderer,P(renderer),layer.scene,layer.camera);v=false;
      for(const pass of [q.lightPass,q.tonePass])await __aimWarmOutputPass(renderer,pass.scene,q.quadCam,target,viewport,check);
      const {emitters}=__aimPlanMuzzleBatches(t,weapon,{intervalSeconds:arguments[4]?.intervalSeconds,maxUpdateSeconds:Xv,hasMaterial:id=>!!_(id)});
      while(k.length<emitters.length)k.push(L());q.warmScene.clear();
      try{for(let index=0;index<emitters.length;index++){const batch=k[index];batch.mesh.material=_(emitters[index].mat);batch.scene?.remove(batch.mesh);batch.scene=null;batch.mesh.visible=true;
       batch.sink.pos.set([-.001,-.001,-1,.001,-.001,-1,0,.001,-1]);batch.sink.uv.set([0,0,1,0,.5,1]);batch.sink.col.fill(1,0,12);batch.sink.dyn.fill(0,0,12);batch.mesh.geometry.setDrawRange(0,3);
       for(const attr of [...batch.attrs,batch.dynAttr])attr.needsUpdate=true;q.warmScene.add(batch.mesh)}
       await __aimWarmVisual(renderer,q.warmScene,q.fxCam,check);
      }finally{q.warmScene.clear();for(const batch of k){batch.mesh.visible=false;batch.mesh.geometry.setDrawRange(0,0)}}
     }
     finally{renderer.setRenderTarget(target);renderer.setViewport(viewport);renderer.setScissor(scissorRect);renderer.setScissorTest(scissor);renderer.autoClear=auto;renderer.setClearColor(color,alpha)}
     }finally{__aimPreparing--;release()}
    },frame(S){`, 'muzzle public prepare');
  }, 'muzzle renderer');
}

function patchViewport(text) {
  text = replaceOne(text, '.then(i=>(wo.set(n,i),i))', '.then(i=>(i?wo.set(n,i):wo.delete(n),i))', 'PVS failed cache retry');
  text = replaceOne(text, 'let x=!1,b=null;const C={}', 'let x=!1,b=null,__aimPrewarmScope=null;const C={}', 'viewport scope state');
  text = replaceOne(text, 'function T(I,R){if(b)return b;', 'function T(I,R,scope){if(b&&__aimPrewarmScope===scope)return b;__aimPrewarmScope=scope;', 'viewport distinct generations');
  text = replaceOne(text, 'N.name="al-prewarm",N.visible=!1;for(const L of R)N.add(L);', 'N.name="al-prewarm",N.visible=!0;for(const L of R){N.add(L);L.traverse?.(mesh=>{if(mesh.isMesh)mesh.frustumCulled=false})}', 'temporary actors included in compilation and draw');
  text = replaceOne(text, 'try{await c.compileAsync(r.scene,r.camera)}catch{return}', 'try{await c.compileAsync(r.scene,r.camera)}catch(error){throw Error("画面编译失败："+(error?.message??error))}N.visible=!1;', 'viewport compile errors');
  text = replaceOne(text, 'R.length&&r.scene.remove(N),b=null});return b=B,B}', 'R.length&&r.scene.remove(N),b===B&&(b=null,__aimPrewarmScope=null)});return b=B,B}', 'viewport generation finalizer');
  return replaceOne(text, 'prewarm(I,R){return T(I,R??[])}', 'prewarm(I,R,scope){return T(I,R??[],scope)}', 'viewport scope argument');
}

function patchAudioResources(text) {
  if(text.includes('export async function __aimPrepareNativeAudio'))throw Error('Prewarm patch already applied: native audio');
  for(const anchor of [
    'function Wl(e){const t=Gn.get(e);if(t)return t;',
    'function Pt(e,t){const n=xt.get(t);if(n!==void 0)return Promise.resolve(n);const a=ln.get(t);if(a)return a;',
    'function Hm(e,t){ko(e,t)}',
    'function Dm(e,t){if(!wo(e))return;const n=_o(t);n&&Pt(n,We[e])}',
    'function Vm(e,t){const n=Ut(e),a=_o(t);if(!(!n||!a))for(const o of n)Pt(a,o)'
  ])if(text.split(anchor).length!==2)throw Error('Prewarm patch version mismatch: native audio caches');
  // Wl fills a reusable PCM buffer with its own deterministic LCG. It never
  // starts a voice or touches Math.random/the simulation's random stream.
  return text+`\nexport async function __aimPrepareNativeAudio(context,weapons,settings,check=()=>{}){
 check();if(!context||!settings.enabled||settings.volume<=0)return;
 Wl(context);
 if(weapons){for(const weapon of weapons)Dm(weapon,context);if(settings.killSound!==false&&Bd(settings.killKit))Vm(settings.killKit,context)}
 else if(on(settings.fireKit))Hm(context,settings.fireKit);
 // Scene flash sounds use the same decode cache. Include their in-flight work;
 // failed recordings keep the native cached-null/synth fallback behavior.
 while(ln.size){check();await Promise.all([...ln.values()])}check();
}\n`;
}

function patchTraining(text) {
  text = 'import{__aimPrewarmSceneAssets as __aimSceneAssetsReady}from"./tmIeW3Ig.js";import{f1 as __aimMapAssets}from"./aQOfOAp-.js";import{__aimPrepareNativeAudio}from"./DCKWp-_u.js";\n' + warmVisual + '\nconst __aimCreateReadyGate=' + createSceneReadyGate.toString() + ';\nconst __aimPrepareStableVisuals=' + prepareStableVisuals.toString() + ';\nconst __aimPlanMuzzleBatches=' + planMuzzleBatches.toString() + ';\n' + text;
  text = replaceOne(text, 'ensure(){const t=this.settings.current??on;if(!t.enabled||t.volume<=0)return null;if(this.context||(this.context=new AudioContext,this.master=this.context.createGain(),this.master.connect(this.context.destination)),this.context.state==="suspended"&&this.context.resume(),this.weaponSounds){',
    'prepareContext(){const t=this.settings.current??on;if(!t.enabled||t.volume<=0)return null;return this.context||(this.context=new AudioContext,this.master=this.context.createGain(),this.master.connect(this.context.destination)),{context:this.context,master:this.master}}async prepare(check=()=>{}){check();const audio=this.prepareContext();if(!audio)return;fl(audio.context);await Promise.all([__aimPrepareNativeAudio(audio.context,this.weaponSounds,this.settings.current??on,check),ul]);check()}unlock(){const t=this.settings.current??on;if(t.enabled&&t.volume>0&&this.context?.state==="suspended")this.context.resume().catch(()=>{})}ensure(){const t=this.settings.current??on;if(!this.prepareContext())return null;this.unlock();if(this.weaponSounds){',
    'silent audio context preparation and gesture unlock');
  text = replaceOne(text, 'plan:()=>u,numberOf:g=>r.get(g)??0,headLines:()=>o.headLines,', 'prepared:()=>!a||(!l&&(u===null||!a.grid()||o.headLines!==null)),plan:()=>u,numberOf:g=>r.get(g)??0,headLines:()=>o.headLines,', 'auxiliary planner completion');
  text = replaceOne(text, 'const re=X(!1),W=X(e.displaySettings.value.renderScale)', 'const __aimPreparation=X({status:"loading"}),re=X(!1),W=X(e.displaySettings.value.renderScale)', 'reactive preparation status');
  text = replaceOne(text, 'io={onPhaseChange(N){a.value=N}', 'io={onPreparationChange(N){__aimPreparation.value=N},onPhaseChange(N){a.value=N}', 'preparation state callback');
  text = replaceOne(text, 'loadScene:ee,mapLoading:re,', 'loadScene:ee,mapLoading:re,preparation:__aimPreparation,', 'preparation state exposed to entry UI');
  text = replaceOne(text, 'let Sa=null,Vs=0;', gateIntegration + 'let Sa=null,Vs=0;', 'training gate integration');
  text = editSection(text, 'function _n(){', 'const us=()=>', body => {
    body = replaceOne(body, 'i.setViewModel(null);return}', 'i.setViewModel(null);return Promise.resolve()}', 'disabled model ready');
    body = replaceOne(body, 'i.setViewModel(Ne),Po();return}', 'i.setViewModel(Ne),Po();return Promise.resolve(Ne)}', 'cached model ready');
    body = replaceOne(body, 'if(_o===Q)return;', 'if(_o===Q)return __aimModelReady;', 'pending model ready');
    body = replaceOne(body, 'D0(E,le).then(oe=>{if(_o!==Q||(_o=null,!oe||Ro))return;', '__aimModelReady=D0(E,le).then(oe=>{if(_o!==Q||Ro)return null;_o=null;if(!oe)throw Error("枪械模型未能加载："+E);', 'model failure propagation');
    return replaceOne(body, 'i.setViewModel(Ne),Po()})}', 'i.setViewModel(Ne),Po();return Te});__aimModelReady.catch(()=>{});return __aimModelReady}', 'model ready return');
  }, 'view model ready');
  text = editSection(text, 'function Xu(E){', 'function Yu(E){', () => `function Xu(E){er();const Q=E.environment.map,le=++Vs;__aimMapReady=Q?Promise.all([sf(Q),af(Q),__aimMapAssets.loadMapLighting(Q)]).then(([map,pvs])=>{if(le!==Vs||Ro)return;if(!map)throw Error("地图画面未能加载。");if(!pvs)throw Error("地图可见性资源未能加载。");Sa=map;i.applyEnvironment(E.environment);i.setMapVisual(map)}):Promise.resolve();__aimMapReady.catch(()=>{});return __aimMapReady}
async function ju(E,Q,ctx){ctx.check();if(!i.prewarm)throw Error("当前画面不支持预热。");const built=Nt,roots=[],skeletons=[];
 try{for(const template of built.actorTemplates.values()){const copy=template.spawn();roots.push(copy.root);if(copy.skin?.skeleton)skeletons.push(copy.skin.skeleton)}
 roots.push(...u.warmUp?.()??[],...l.warmUp?.()??[],...r.warmUp?.()??[]);
 if(Ke?.object?.visible)roots.push(Ke.object.clone(true));
 if(E.props?.some(p=>p.kind==="lockdown"))roots.push(...M.warmUp());
 await i.prewarm(()=>{try{ctx.check();return !Ro&&Nt===built&&Q===Vs}catch{return false}},roots,ctx.generation);ctx.check();
 }finally{for(const skeleton of skeletons)skeleton.dispose()}
}

`, 'scene map and GPU readiness');
  text = replaceOne(text, ',h?.prepare(i.renderer,i.camera)}function tr()', '}function tr()', 'smoke starts only inside current gate');
  text = replaceOne(text, 'function Ta(E,Q=null,le=E){if(', 'function Ta(E,Q=null,le=E){__aimWarmGate.cancel();if(', 'scene cancellation before build');
  text = replaceOne(text, 'te.setLookOnly(pt!==null&&t.phase.current!=="running"),qu()}function Zu(E)', 'te.setLookOnly(pt!==null&&t.phase.current!=="running"),qu(),__aimBeginWarm(E)}function Zu(E)', 'start readiness after stable scene build');
  text = replaceOne(text, 'async function td(){ee=!1,fs(!1),await Ie(', 'async function td(){if(!__aimCanStart())return;ie.unlock?.();ee=!1,fs(!1),await Ie(', 'gesture-safe start gate');
  text = replaceOne(text, 'start:td,restart:Do,', 'start:td,canStart:__aimCanStart,retryPreparation(){return __aimWarmDoc?__aimBeginWarm(__aimWarmDoc,true):null},restart:Do,', 'preparation actions for countdown entry');
  const restart = 'Ea(),n.onLastResult(null),n.onSessionActive(!0),n.onPhaseChange("running"),tn()||ro()}function nd()';
  text = replaceOne(text, restart, 'const attempt=++__aimWarmRestart;Ea();n.onSessionActive(!1);n.onPhaseChange("idle");const job=__aimWarmJob;job.then(result=>{if(Ro||attempt!==__aimWarmRestart||job!==__aimWarmJob||result.status!=="ready")return;n.onLastResult(null),n.onSessionActive(!0),n.onPhaseChange("running");if(!tn()){n.onPhaseChange("paused");__aimWarmNotice.hidden=false;__aimWarmText.textContent="资源已准备，点击开始继续。"}})}function nd()', 'restart after readiness');
  text = replaceOne(text, 'function md(){it(),D(),sd(),!Lt()&&', 'function md(){it(),D(),sd();if(t.phase.current==="idle"&&__aimWarmGate.ready&&__aimWarmDoc&&__aimPreparedSelection!==__aimWarmSelection())__aimBeginWarm(__aimWarmDoc);if(t.session.current!=="calibration"&&!__aimWarmGate.ready){te.setEnabled(false);te.setLookOnly(false);return}!Lt()&&', 'no physics while preparing');
  return replaceOne(text, 'wd=()=>{Ro=!0;', 'wd=()=>{__aimWarmGate.cancel("disposed");__aimWarmNotice.remove();Ro=!0;', 'gate disposal');
}

function patchEntry(text) {
  text=replaceOne(text,"cJ=e(()=>cC['mapLoading']['value']?'地图还在加载':cH['blocking']['value']?'解说还在加载':'点击任意位置开始')", "__aimEntryWaiting=e(()=>cC['session']['value']!=='calibration'&&cC['preparation']?.['value']?.['status']!=='ready'),cJ=e(()=>__aimEntryWaiting['value']?(cC['preparation']?.['value']?.['status']==='failed'?'训练资源准备失败，请重试':cC['preparation']?.['value']?.['label']??'正在准备训练资源…'):cC['mapLoading']['value']?'地图还在加载':cH['blocking']['value']?'解说还在加载':'点击任意位置开始')",'entry preparation message');
  text=replaceOne(text,"dL=()=>{cC['mapLoading']['value']||cH['blocking']['value']||", "dL=()=>{__aimEntryWaiting['value']||cC['mapLoading']['value']||cH['blocking']['value']||",'entry preparation click guard');
  text=replaceOne(text,"{'is-waiting':h(cC)['mapLoading']['value']||h(cH)['blocking']['value']}","{'is-waiting':__aimEntryWaiting['value']||h(cC)['mapLoading']['value']||h(cH)['blocking']['value']}",'entry preparation styling');
  text=replaceOne(text,"dR[0x1a]||(dR[0x1a]=k('div',{'class':'al-scene-start-hint'},'Enter\\x20也行',-0x1))", "k('div',{'class':'al-scene-start-hint','style':O({'display':__aimEntryWaiting['value']?'none':''})},'Enter\\x20也行',0x4)",'entry gesture hint keeps a stable dynamic VNode');
  text=replaceOne(text,"'disabled':h(cC)['mapLoading']['value'],'onClick':dL", "'disabled':__aimEntryWaiting['value']||h(cC)['mapLoading']['value'],'onClick':dL",'entry start button disabled');
  text=replaceOne(text,"t(h(cC)['mapLoading']['value']?'地图加载中…':'开始训练')", "t(__aimEntryWaiting['value']?cJ['value']:h(cC)['mapLoading']['value']?'地图加载中…':'开始训练')",'entry start button loading message');
  text=replaceOne(text,"h(cC)['mapLoading']['value']?g('',!0x0):(j(),f('kbd',Ui,'ENTER'))", "__aimEntryWaiting['value']||h(cC)['mapLoading']['value']?g('',!0x0):(j(),f('kbd',Ui,'ENTER'))",'entry button hint only after preparation');
  text=replaceOne(text,"const cH=x(!0x1),cI=Mu({'onStart':()=>Xe(cF,{'rebuild':!0x1})})", "function __aimHallCanStart(){if(cF['session']['value']!=='calibration'&&cF['preparation']?.['value']?.['status']!=='ready')return false;return cF['engine']['value']?.['canStart']?.()!==false}const cH=x(!0x1),cI=Mu({'onStart':()=>{if(__aimHallCanStart())Xe(cF,{'rebuild':!0x1});else cI['rewind']()}})",'countdown completion requires stable preparation');
  text=replaceOne(text,"const cO=e(()=>''),cP=e(()=>bU),cQ=e(()=>'');function cR(cY){", "A(()=>cF['preparation']?.['value']?.['status'],status=>{if(status!=='ready'&&cI['state']['value']==='counting')cI['rewind']()});const cO=e(()=>cF['preparation']?.['value']?.['status']==='ready'?'':cF['preparation']?.['value']?.['status']==='failed'?'训练资源准备失败，请重试':cF['preparation']?.['value']?.['label']??'正在准备训练资源…'),cP=e(()=>bU),cQ=e(()=>'');function cR(cY){if(!__aimHallCanStart())return;",'countdown waits visibly for resources and a new click');
  text=replaceOne(text,"return cZ?.['awaitClick']?cI['rewind']():cI['restart'](),!0x0;", "return cZ?.['awaitClick']||!__aimHallCanStart()?cI['rewind']():cI['restart'](),!0x0;",'round preparation cannot begin an early countdown');
  text=replaceOne(text,"cF['phase']['value']!=='paused'?!0x1:(cF['phase']['value']='idle',cF['engine']['value']?.['start'](),cI['restart'](),!0x0)", "cF['phase']['value']!=='paused'?!0x1:!__aimHallCanStart()?!0x0:(cF['phase']['value']='idle',cF['engine']['value']?.['start'](),cI['restart'](),!0x0)",'resume countdown waits for resources');
  text=replaceOne(text,"k('p',td,t(cO['value']),0x1),cZ[0x5]||", "k('p',td,t(cO['value']),0x1),h(cF)['preparation']?.['value']?.['status']==='failed'?(j(),f('button',{'type':'button','data-action':'prep-retry','onClick':()=>h(cF)['engine']['value']?.['retryPreparation']?.()},'重试')):g('',!0x0),cZ[0x5]||",'countdown entry exposes retry');
  text=replaceOne(text,"cZ[0x5]||(cZ[0x5]=k('p',{'class':'hall-train-prep-hint'},[p('\\x20可以先转动视角看靶位\\x20·\\x20'),k('b',null,'点击左键'),p('\\x20开始，还有\\x203\\x20秒准备时间\\x20')],-0x1))", "k('p',{'class':'hall-train-prep-hint','style':O({'display':h(cF)['preparation']?.['value']?.['status']!=='ready'?'none':''})},[p('\\x20可以先转动视角看靶位\\x20·\\x20'),k('b',null,'点击左键'),p('\\x20开始，还有\\x203\\x20秒准备时间\\x20')],0x4)",'countdown gesture hint keeps a stable dynamic VNode');
  return text;
}

export function applyPrewarmPatch(sources) {
  const required = ['CymPR-fm.js', 'aQOfOAp-.js', 'tmIeW3Ig.js'];
  for (const file of required) {
    if (typeof sources[file] !== 'string') throw new Error(`Prewarm patch missing source: ${file}`);
    if (sources[file].includes('__aimCreateReadyGate') || sources[file].includes('__aimPrewarmSceneAssets')) throw new Error(`Prewarm patch already applied: ${file}`);
  }
  const out = {...sources};
  out['tmIeW3Ig.js'] = patchCharacterAssets(out['tmIeW3Ig.js']);
  out['aQOfOAp-.js'] = patchViewport(out['aQOfOAp-.js']);
  out['CymPR-fm.js'] = patchTraining(patchMuzzle(patchFlash(out['CymPR-fm.js'])));
  if(typeof out['DCKWp-_u.js']==='string')out['DCKWp-_u.js']=patchAudioResources(out['DCKWp-_u.js']);
  if(typeof out['DVK7uRSu.js']==='string')out['DVK7uRSu.js']=patchEntry(out['DVK7uRSu.js']);
  return out;
}
