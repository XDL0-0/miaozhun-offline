// Prepare a real-renderer benchmark page. Run it explicitly in a visible browser;
// generating this page only inventories local files and does not measure FPS.
import './review-weapon-models.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),dist=path.join(root,'dist');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const index=read('dist/skin-packs/models/index.json');
const local=url=>path.join(dist,url.replace(/^\//,''));
const variants=new Map(Object.entries(index.models).map(([key,url])=>[url,key]));
for(const [base,themes]of Object.entries(index.variants??{}))for(const [theme,url]of Object.entries(themes))variants.set(url,base+'/'+theme);
const originalFetch=globalThis.fetch,natives=new Map();
try{
 globalThis.fetch=async url=>{const u=new URL(url,'http://127.0.0.1:18746');if(u.hostname!=='127.0.0.1')throw Error('Static inventory blocked external request');return new Response(fs.readFileSync(local(u.pathname)));};
 const codec=await import(pathToFileURL(path.join(dist,'js/DHDvBWqu.js')).href);
 for(const weapon of ['vandal','phantom','sheriff','operator','melee']){const stem=weapon==='vandal'?'viewmodel':weapon==='melee'?'knife':weapon;natives.set(weapon,JSON.parse(Buffer.from(await codec.c('/aim-viewmodel/'+stem+'.json'))));}
}finally{globalThis.fetch=originalFetch;}

const pngInfo=url=>{const b=fs.readFileSync(local(url));return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};};
const textureRefs=m=>m.hidden?[]:[m.map,m.normalMap,m.ormMap,m.emissiveMap,...Object.values(m.shader??{}).flatMap(s=>[s.map,s.mask,s.gradient,s.noise])].filter(Boolean);
const sumRgba=urls=>[...new Set(urls)].reduce((n,url)=>{const p=pngInfo(url);return n+p.width*p.height*4;},0);
const textureKeys=m=>{
 if(m.hidden)return [];
 const entries=[[m.map,true],[m.normalMap,false],[m.ormMap,false],[m.emissiveMap,false]],f=m.shader??{};
 for(const name of ['tint','plastic','flow','scroll','line'])if(f[name])entries.push([f[name].map,false]);
 if(f.flow)entries.push([f.flow.gradient,true]);if(f.rim)entries.push([f.rim.map,false],[f.rim.noise,false]);if(f.heat)entries.push([f.heat.map,true],[f.heat.mask,false]);
 return entries.filter(([url])=>url).map(([url,color])=>url+':'+color);
};
const textureSize=key=>{const url=key.slice(0,key.lastIndexOf(':')),{width,height}=pngInfo(url);let w=width,h=height,mipTexels=0;while(true){mipTexels+=w*h;if(w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}return {key,url,colorSpace:key.endsWith(':true')?'srgb':'linear',width,height,rgba8BaseBytes:width*height*4,rgba8FullMipBytes:mipTexels*4};};
const sumKeys=keys=>[...keys].reduce((result,key)=>{const size=textureSize(key);result.base+=size.rgba8BaseBytes;result.mips+=size.rgba8FullMipBytes;return result;},{base:0,mips:0});
const rows=[];
for(const [url,key]of variants){
 const pack=JSON.parse(fs.readFileSync(local(url),'utf8')),native=natives.get(pack.weapon),nativeBones=native.gun.skeleton.names;
 let calls=0,twoSided=0,triangles=0;const visibleMaterials=new Set(),visibleTextures=new Set(),allTextures=new Set(),inertEmissive=new Set(),constructedGpuKeys=new Set(),visibleGpuKeys=new Set();
 for(const [partIndex,part]of pack.parts.entries()){
  const b=fs.readFileSync(local(part.url)),gltf=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
  part.materials.flatMap(textureRefs).forEach(u=>allTextures.add(u));
  part.materials.flatMap(textureKeys).forEach(k=>constructedGpuKeys.add(k));
  const copies=part.role==='magazine'&&nativeBones.includes('Magazine_Extra')?2:1;
  for(const mesh of gltf.meshes??[])for(const primitive of mesh.primitives){
   const material=part.materials[primitive.material??0];if(material.hidden)continue;
   calls+=copies;triangles+=(gltf.accessors[primitive.indices].count/3)*copies;
   if(material.transparent&&material.doubleSided)twoSided+=copies;
   visibleMaterials.add(partIndex+':'+(primitive.material??0));textureRefs(material).forEach(u=>visibleTextures.add(u));
   textureKeys(material).forEach(k=>visibleGpuKeys.add(k));
   if(material.emissiveIntensity===0&&material.emissiveMap)inertEmissive.add(material.emissiveMap);
  }
 }
 const all=[...allTextures],visible=[...visibleTextures],rgba=sumRgba(all),visibleRgba=sumRgba(visible),motionBytes=Object.values(pack.motions?.clips??{}).reduce((n,c)=>n+c.frames*c.names.length*40,0);
 rows.push({key,weapon:pack.weapon,sourceParts:pack.parts.length,sourceMaterialSlots:pack.parts.reduce((n,p)=>n+p.materials.length,0),visibleMaterialSlots:visibleMaterials.size,estimatedWeaponDrawCalls:[calls+1,calls+1+twoSided],estimatedWeaponTriangles:triangles+native.arms.tris,bodyTextureUrls:all,constructedGpuKeys:[...constructedGpuKeys],visibleGpuKeys:[...visibleGpuKeys],bodyTextureCount:all.length,potentialDecodedBodyRgbaBytes:rgba,visibleTextureCount:visible.length,potentialVisibleGpuRgbaWithMipsBytes:sumKeys(visibleGpuKeys).mips,decodedMotionBytes:motionBytes,zeroBaseEmissionMapCount:inertEmissive.size,potentialZeroBaseEmissionMapBytes:sumRgba(inertEmissive)});
}
const largest=[...rows].sort((a,b)=>b.potentialDecodedBodyRgbaBytes-a.potentialDecodedBodyRgbaBytes).slice(0,4);
const inventory={schemaVersion:1,measured:false,method:'Static local-file estimates only. RGBA sizes assume 4 bytes/pixel; GPU estimate sums every full mip level using original dimensions and distinguishes srgb/linear texture instances. Counts include original hands and visible skin primitives, spare-magazine duplication and a range for two-sided transparent passes. They exclude map/actors/particle passes, driver memory, sharing, decoded effect sprites and renderer overhead. No FPS has been measured.',models:rows.map(({bodyTextureUrls,constructedGpuKeys,visibleGpuKeys,...r})=>r),largestFourRawPacks:{keys:largest.map(r=>r.key),withoutCrossPackSharingBytes:largest.reduce((n,r)=>n+r.potentialDecodedBodyRgbaBytes+r.decodedMotionBytes,0),assumingSharedImageUrlsBytes:sumRgba(largest.flatMap(r=>r.bodyTextureUrls))+largest.reduce((n,r)=>n+r.decodedMotionBytes,0)}};
const pairKeys=[['champions-2026/phantom/defending','champions-2026/melee/defending'],['champions-2026/phantom/attacking','champions-2026/melee/attacking'],['champions-2021/vandal','champions-2021/melee'],['champions-2022/phantom','champions-2022/melee'],['champions-2021/vandal','champions-2022/phantom'],['champions-2021/vandal','champions-2022/melee'],['champions-2022/phantom','champions-2021/melee'],['kuronami/vandal','kuronami/phantom'],...rows.filter(r=>r.weapon==='melee').map(r=>['rogue/vandal',r.key]),['champions-2023/vandal','champions-2023/melee'],['champions-2024/phantom','champions-2024/melee'],['champions-2025/vandal','champions-2025/melee']];
const compareKeys=(left,right)=>{const a=new Set(left),b=new Set(right),union=new Set([...a,...b]),shared=[...a].filter(k=>b.has(k)),beforeA=sumKeys(a),beforeB=sumKeys(b),after=sumKeys(union);return {textureObjectsBefore:a.size+b.size,textureObjectsAfter:union.size,sharedTextureObjects:shared.length,rgba8BaseBytesBefore:beforeA.base+beforeB.base,rgba8BaseBytesAfter:after.base,rgba8FullMipBytesBefore:beforeA.mips+beforeB.mips,rgba8FullMipBytesAfter:after.mips,rgba8FullMipBytesSaved:beforeA.mips+beforeB.mips-after.mips,sharedTextures:shared.map(textureSize)};};
const sharing={schemaVersion:1,measured:false,method:'Exact source dimensions and URL+color-space identities, applying the runtime body-texture acquisition rules. Before: each controller owns one texture per key. After: identical keys across live controllers share one Texture. RGBA8 base/full-mip byte totals are exact for that assumed storage format; actual resident GPU memory also depends on driver/renderer state and is not measured. Visible primitives estimate uploaded body maps; constructed-material totals also include hidden/unused material slots. Effect textures, environment maps and native arms are excluded.',pairs:pairKeys.map(keys=>{const [a,b]=keys.map(key=>rows.find(r=>r.key===key));if(!a||!b)throw Error('Unknown sharing pair '+keys);return {keys,visibleBodyTextures:compareKeys(a.visibleGpuKeys,b.visibleGpuKeys),constructedMaterialTextures:compareKeys(a.constructedGpuKeys,b.constructedGpuKeys)};})};
fs.mkdirSync(path.join(root,'qa-artifacts'),{recursive:true});
fs.writeFileSync(path.join(root,'qa-artifacts/weapon-profile-static.json'),JSON.stringify(inventory,null,2));
fs.writeFileSync(path.join(root,'qa-artifacts/weapon-texture-sharing.json'),JSON.stringify(sharing,null,2));
fs.writeFileSync(path.join(dist,'__weapon-profile-static.json'),JSON.stringify(inventory));
const bundle=fs.readFileSync(path.join(root,'site/js/aQOfOAp-.js'),'utf8'),alias=bundle.slice(bundle.lastIndexOf('export{')).match(/\bDp as (\w+)\b/)[1];
const allCases=[{key:'native/vandal',collection:'default',weapon:'vandal',theme:'default'},...rows.map(r=>{const [collection,weapon,theme='default']=r.key.split('/');return {key:r.key,collection,weapon,theme};})];
const defaults=new Set(['native/vandal','champions-2021/vandal','champions-2026/phantom/defending','champions-2026/melee/defending','rogue/vandal','kuronami/phantom']);
fs.writeFileSync(path.join(dist,'__weapon-profile.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>离线武器性能测量</title>
<style>body{margin:20px;background:#10171f;color:#e8eff7;font:14px system-ui}h1{font-size:22px}p{max-width:1000px;color:#b8c9db}fieldset{display:flex;gap:8px 18px;flex-wrap:wrap;max-width:1100px}label{min-width:245px}button{padding:9px 15px;margin:10px 8px 10px 0}canvas{max-width:100%;height:auto;background:#182431}table{border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:7px 10px;border-bottom:1px solid #334659;text-align:right}td:first-child,th:first-child{text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:1200px}#status{color:#7ae0be}</style>
<h1>武器渲染独立测量</h1><p>本页调用当前交付的模型、动作、材质和开火特效。使用独立内存选择，不修改训练设置或成绩。请保持页面可见；结果仅反映武器场景，不能代表含地图、机器人和模拟计算的整场训练帧率。</p>
<p>默认每款先预热 90 帧，再依次记录待机、连续开火／近战攻击、检视各 120 帧。CPU 时间包含实际函数执行；可用时通过异步 GPU 查询记录绘制时间，不使用 gl.finish。帧间隔另列，浏览器调度或后台状态会影响它。</p>
<fieldset id="cases"><legend>测试项目</legend></fieldset><button id="run">开始所选项目</button><button id="stop" disabled>停止</button><button id="download" disabled>下载 JSON 报告</button><p id="status">尚未开始；静态清单不是 FPS 实测。</p><div id="view"></div><div id="summary"></div><pre id="report"></pre><div id="app" hidden></div>
<script type="module">
import {${alias} as Renderer} from '/js/aQOfOAp-.js';
import {l as load,c as create} from '/__weapon-view.mjs';
import {choose} from '/__weapon-harness.mjs';
import {weaponEffects} from '/__weapon-game.mjs';
import {skinPacks} from '/js/aim-skin-packs.mjs';
const cases=${JSON.stringify(allCases)},defaults=${JSON.stringify([...defaults])},status=document.getElementById('status'),reportNode=document.getElementById('report');
const inventory=await fetch('/__weapon-profile-static.json').then(r=>r.json());
for(const entry of cases){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=entry.key;box.checked=defaults.includes(entry.key);label.append(box,document.createTextNode(entry.key));document.getElementById('cases').append(label);}
let stop=false,lastReport=null;
const percentiles=values=>{if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),p=q=>a[Math.min(a.length-1,Math.floor((a.length-1)*q))];return {samples:a.length,mean:a.reduce((n,v)=>n+v,0)/a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1)};};
const resourceEntries=()=>performance.getEntriesByType('resource').filter(e=>e.name.startsWith(location.origin));
const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(time=>{if(stop)throwLater(resolve,'用户停止');else if(document.hidden)throwLater(resolve,'页面进入后台；本次测量无效，请保持可见后重试。');else resolve({time});}));
function throwLater(resolve,error){resolve({error});}
function checkFrame(frame){if(frame.error)throw Error(frame.error);return frame.time;}
function gpuTimers(renderer){const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),pending=[];let active=null;const values=[];return {supported:!!ext,begin(frame){if(!ext||frame%8||active)return;active=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,active);},end(){if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null;}},poll(){if(!ext)return;const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);for(let i=pending.length-1;i>=0;i--){const query=pending[i];if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))continue;if(!disjoint)values.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);pending.splice(i,1);}},values,dispose(){if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(active);}pending.forEach(q=>gl.deleteQuery(q));}};}
function stateAt(weapon,phase,seconds,started){const melee=weapon==='melee',shots=phase==='action'&&!melee?[Math.floor(seconds/.1)*.1]:[],events=phase==='inspect'?[{at:started,inspect:true,weapon}]:phase==='action'&&melee?[{at:Math.floor(seconds/.4)*.4,combo:Math.floor(seconds/.4)%4,weapon}]:[];return {seconds,shots,melee:events,speed:0,reloadSince:null,reloadDuration:3,adsBlend:0,fireIntervalSeconds:.1,equipAt:null};}
function observeSurfaceUniforms(model){const uniforms=new WeakMap();model.fxLayer().scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m?.userData.aimSurface)continue;const original=m.onBeforeCompile;m.onBeforeCompile=function(shader,renderer){original.call(this,shader,renderer);uniforms.set(this,shader.uniforms);};}});return uniforms;}
function textureStats(model,uniforms){const objects=new Map(),keys=new Map();model.fxLayer().scene.traverseVisible(o=>{if(!o.geometry)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m||m.visible===false)continue;const textures=[...Object.values(m),...Object.values(uniforms.get(m)??{}).map(u=>u.value)].filter(t=>t?.isTexture);for(const t of textures){const image=t.image,src=image?.currentSrc??image?.src;if(!src)continue;const url=new URL(src,location.href);if(!url.pathname.startsWith('/skin-packs/models/'))continue;const width=image.naturalWidth??image.width,height=image.naturalHeight??image.height;if(!width||!height)continue;let w=width,h=height,texels=0;while(true){texels+=w*h;if(w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}const key=url.pathname+':'+(t.colorSpace||'linear'),value={key,uuid:t.uuid,width,height,rgba8BaseBytes:width*height*4,rgba8FullMipBytes:texels*4};objects.set(t.uuid,value);keys.set(key,value);}}});const sum=(values,field)=>[...values].reduce((n,v)=>n+v[field],0);return {method:'Observed visible source-body Texture UUIDs from material properties and captured source-shader uniforms. Byte counts assume RGBA8 original dimensions plus a full mip chain; resident GPU allocation is not measured.',textureObjects:objects.size,uniqueUrlAndColorSpaceKeys:keys.size,duplicateTextureObjects:objects.size-keys.size,rgba8BaseBytes:sum(objects.values(),'rgba8BaseBytes'),rgba8FullMipBytes:sum(objects.values(),'rgba8FullMipBytes'),ifSharedRgba8FullMipBytes:sum(keys.values(),'rgba8FullMipBytes'),textures:[...objects.values()]};}
function visibleProfile(model,uniforms){const layer=model.fxLayer(),names=[],maps=new Set(),meshes=[];layer.scene.traverseVisible(o=>{if(!o.geometry)return;meshes.push(o.name);for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m||m.visible===false)continue;names.push(m.name);for(const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'])if(m[k])maps.add(m[k].uuid);}});return {appearanceKey:model.skinEffectsKey?.()??null,visibleMeshes:meshes,visibleMaterials:names,baseGpuTextureObjects:maps.size,textureStats:textureStats(model,uniforms)};}
function publish(report){lastReport=report;reportNode.textContent=JSON.stringify(report,null,2);const rows=report.results.flatMap(r=>r.phases.map(p=>'<tr><td>'+r.key+' · '+p.phase+'</td><td>'+p.updateCpuMs.mean.toFixed(3)+'</td><td>'+p.renderSubmitCpuMs.mean.toFixed(3)+'</td><td>'+p.rafIntervalMs.p95.toFixed(2)+'</td><td>'+(p.gpuDrawMs?.mean.toFixed(3)??'不可用')+'</td><td>'+p.drawCalls.p50+'</td><td>'+p.steadyResourceRequests+'</td></tr>')).join('');document.getElementById('summary').innerHTML='<table><tr><th>项目</th><th>更新 CPU ms</th><th>提交绘制 CPU ms</th><th>帧间隔 p95 ms</th><th>GPU ms</th><th>绘制调用</th><th>稳态资源请求</th></tr>'+rows+'</table>';document.getElementById('download').disabled=false;}
document.getElementById('stop').onclick=()=>{stop=true;};
document.getElementById('download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'}));a.download='weapon-performance-profile.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
document.getElementById('run').onclick=async()=>{
 const selected=new Set([...document.querySelectorAll('#cases input:checked')].map(n=>n.value)),chosen=cases.filter(c=>selected.has(c.key));if(!chosen.length)return;
 stop=false;document.getElementById('run').disabled=true;document.getElementById('stop').disabled=false;
 const renderer=new Renderer({antialias:true,preserveDrawingBuffer:false});renderer.info.autoReset=false;renderer.setPixelRatio(1);renderer.setSize(1280,720,false);renderer.setClearColor(0x182431,1);document.getElementById('view').replaceChildren(renderer.domElement);
 const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={schemaVersion:1,measured:true,startedAt:new Date().toISOString(),method:'Visible foreground RAF, real shipped renderer at 1280x720 DPR1, no world/map/actors. 90 warm-up frames then 120 measured frames per idle/action/inspect phase. CPU clocks do not imply GPU completion; optional asynchronous disjoint timer queries sample GPU draws every eight frames. No gl.finish. Memory-only skin selections; no settings or scores written.',environment:{userAgent:navigator.userAgent,visibility:document.visibilityState,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),contextAttributes:gl.getContextAttributes()},staticInventory:inventory,results:[],errors:[]};
 let model=null,effects=null,timers=null;
 try{
  status.textContent='等待原有素材预载完成…';await skinPacks.prepare();performance.setResourceTimingBufferSize(10000);
  for(const entry of chosen){
   if(stop)throw Error('用户停止');const {weapon,collection,theme}=entry,stamp=performance.now(),requestsBefore=resourceEntries().length;status.textContent='加载 '+entry.key+'…';choose(weapon,collection,theme);
   const pack=await load(weapon==='vandal'?'viewmodel':weapon==='melee'?'knife':weapon,{knife:weapon==='melee'});if(!pack)throw Error('Native package unavailable '+entry.key);
   const loadedAt=performance.now();model=create(pack);model.setGun('vandal');model.setFovHorizontal(90);const textureUniforms=observeSurfaceUniforms(model),createdAt=performance.now();effects=weapon==='melee'?null:weaponEffects({detail:15});await effects?.prepare(weapon,renderer,model);const preparedAt=performance.now();
   let oldShot=-Infinity;const draw=(state,phase)=>{renderer.info.reset();renderer.clear();model.render(renderer,{aspect:16/9});const shot=state.shots.at(-1),fresh=phase==='action'&&Number.isFinite(shot)&&shot!==oldShot;oldShot=shot??-Infinity;effects?.frame({time:state.seconds,shots:fresh?[{at:shot,spreadDeg:.1,firingDeg:.1}]:[],weapon,zoomed:false,enabled:true,viewModel:model});effects?.render(renderer,model.fxLayer().camera);};
   status.textContent='预热 '+entry.key+'（90 帧）…';
   for(let i=0;i<90;i++){checkFrame(await waitFrame());const phase=i<30?'idle':i<60?'action':'inspect',state=stateAt(weapon,phase,i/60,1);model.update(state);draw(state,phase);}
   const readyAt=performance.now(),visual=visibleProfile(model,textureUniforms);if(collection!=='default'&&!visual.appearanceKey)throw Error('Selected skin is not visible '+entry.key);const result={key:entry.key,loadMs:loadedAt-stamp,createMs:createdAt-loadedAt,prepareMs:preparedAt-createdAt,warmupMs:readyAt-preparedAt,resourceRequestsThroughWarmup:resourceEntries().length-requestsBefore,visual,memoryAfterWarmup:{...renderer.info.memory},programsAfterWarmup:renderer.info.programs.length,phases:[]};
   let clock=10;
   for(const phase of ['idle','action','inspect']){
    status.textContent='测量 '+entry.key+' · '+phase+'（120 帧）…';const updates=[],renders=[],intervals=[],calls=[],triangles=[],resources=resourceEntries().length,phaseStart=clock;let previous=null;timers=gpuTimers(renderer);oldShot=-Infinity;
    for(let frame=0;frame<120;frame++){const now=checkFrame(await waitFrame());if(previous!==null){const delta=Math.max(0,now-previous);intervals.push(delta);clock+=delta/1000;}previous=now;const state=stateAt(weapon,phase,clock,phaseStart),before=performance.now();model.update(state);const updated=performance.now();timers.begin(frame);draw(state,phase);timers.end();const rendered=performance.now();updates.push(updated-before);renders.push(rendered-updated);calls.push(renderer.info.render.calls);triangles.push(renderer.info.render.triangles);timers.poll();}
    for(let i=0;i<8;i++){checkFrame(await waitFrame());timers.poll();}
    result.phases.push({phase,updateCpuMs:percentiles(updates),renderSubmitCpuMs:percentiles(renders),rafIntervalMs:percentiles(intervals),gpuDrawMs:percentiles(timers.values),gpuTimingSupported:timers.supported,drawCalls:percentiles(calls),triangles:percentiles(triangles),steadyResourceRequests:resourceEntries().length-resources,memory:{...renderer.info.memory},programs:renderer.info.programs.length});timers.dispose();timers=null;clock+=1;
   }
   effects?.dispose();effects=null;model.dispose();model=null;result.memoryAfterDispose={...renderer.info.memory};report.results.push(result);publish(report);
  }
  status.textContent='测量完成：'+report.results.length+' 个项目。请查看 CPU、GPU 与资源请求，不要把独立武器测试当作整场训练 FPS。';
 }catch(error){report.errors.push(error.stack);status.textContent='测量停止：'+error.message;}finally{timers?.dispose();effects?.dispose();model?.dispose();renderer.dispose();report.completedAt=new Date().toISOString();publish(report);document.getElementById('run').disabled=false;document.getElementById('stop').disabled=true;}
};
</script></html>`);
console.log(JSON.stringify({page:'http://127.0.0.1:18746/__weapon-profile.html',defaultCases:[...defaults],staticInventory:path.join(root,'qa-artifacts/weapon-profile-static.json'),largestFourRawPacks:inventory.largestFourRawPacks,measured:false},null,2));
