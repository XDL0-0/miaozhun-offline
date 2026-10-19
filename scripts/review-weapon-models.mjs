import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const file=name=>new URL(name,root);
const index=JSON.parse(fs.readFileSync(file('dist/skin-packs/models/index.json')));
const native=fs.readFileSync(file('dist/js/CFqO0zvx.js'),'utf8').replaceAll('from"./','from"/js/').replaceAll("from'./","from'/js/").replace('from"/js/aim-weapon-models.mjs"','from"/__weapon-harness.mjs"');
fs.writeFileSync(file('dist/__weapon-view.mjs'),native);
const game=fs.readFileSync(file('dist/js/CymPR-fm.js'),'utf8').replaceAll('from"./','from"/js/').replaceAll("from'./","from'/js/").replace('from"/js/aim-weapon-models.mjs"','from"/__weapon-harness.mjs"');
fs.writeFileSync(file('dist/__weapon-game.mjs'),game+'\nexport{qv as weaponEffects,Cm as weaponInput};\n');
fs.writeFileSync(file('dist/__weapon-harness.mjs'),`import {createWeaponModelLoader,createWeaponAppearance} from '/js/aim-weapon-models.mjs';
const selected={},listeners=new Set();
export const skins={async initialize(){},selection:gun=>selected[gun]??{collection:'default'},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
export function choose(gun,collection,theme='default'){selected[gun]={collection,theme,modelEnabled:true};for(const fn of listeners)fn();}
export const loader=createWeaponModelLoader({skins});
const originalLoad=loader.load.bind(loader);let nextHold=null;
loader.load=async stem=>{const gun=stem==='viewmodel'?'vandal':stem==='knife'?'melee':stem,held=nextHold?.weapon===gun?nextHold:null;if(held)nextHold=null;try{const pack=await originalLoad(stem);if(held)await held.gate;return pack;}finally{held?.finished();}};
export function holdNextModelLoad(weapon){let release,finished;const gate=new Promise(resolve=>{release=resolve}),settled=new Promise(resolve=>{finished=resolve});nextHold={weapon,gate,finished};return {release,settled};}
export const loadWeaponModel=stem=>loader.load(stem);
export const weaponEffectImage=url=>loader.picture(url);
export const createWeaponAppearance=options=>createWeaponAppearanceImpl({...options,skins,loader});
const createWeaponAppearanceImpl=createWeaponAppearance;
`.replace('import {createWeaponModelLoader,createWeaponAppearance}', 'import {createWeaponModelLoader,createWeaponAppearance as createWeaponAppearanceImpl}').replace('const createWeaponAppearanceImpl=createWeaponAppearance;',''));
const aQ=fs.readFileSync(file('site/js/aQOfOAp-.js'),'utf8');
const rendererAlias=aQ.slice(aQ.lastIndexOf('export{')).match(/\bDp as (\w+)\b/)[1];
const cases=[];
for(const [key,url]of Object.entries(index.models)){
 const [collection,gun]=key.split('/'),variants=Object.entries(index.variants?.[key]??{});
 if(!variants.some(([,value])=>value===url))cases.push({key,collection,gun,theme:'default'});
 for(const [theme]of variants)cases.push({key:key+'/'+theme,collection,gun,theme});
}
cases.sort((a,b)=>Number(b.collection==='ayakashi')-Number(a.collection==='ayakashi'));
if(process.argv.includes('--champions'))for(let i=cases.length-1;i>=0;i--)if(!cases[i].collection.startsWith('champions-'))cases.splice(i,1);
const materialReview=process.argv.includes('--materials');
fs.writeFileSync(file('dist/__weapon-review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>皮肤枪模验证</title>
<style>body{margin:0;background:#10171f;color:#e8eff7;font:14px system-ui}header{padding:18px 22px}h1{font-size:22px;margin:0 0 8px}p{margin:4px 0;color:#aebed0}#results{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;padding:0 20px 20px}figure{margin:0;background:#1b2633;border:1px solid #334659;border-radius:10px;overflow:hidden}figure img{width:100%;display:block}figcaption{padding:8px 12px}#report{white-space:pre-wrap;padding:20px}#app{display:none}</style>
<header><h1>皮肤动作与高清贴图 · 离线实机验证</h1><p>原始 2K 贴图 · 专属换弹与检视 · 原始枪口粒子及枪身发光 · Y 检视</p><p id="status">正在检查模型、骨骼、动作和开火特效…</p><p id="key-proof">键盘检视检查：等待动作验证完成</p></header><section id="results"></section><pre id="report"></pre><div id="app"></div>
<script type="module">
import {${rendererAlias} as Renderer} from '/js/aQOfOAp-.js';
import {l as load,c as create} from '/__weapon-view.mjs';
import {choose,loader,holdNextModelLoad} from '/__weapon-harness.mjs';
import {weaponEffects,weaponInput} from '/__weapon-game.mjs';
const cases=${JSON.stringify(cases)},results=[],errors=[],raceChecked=new Set();
const renderer=new Renderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,720,false);renderer.setClearColor(0x182431,1);
const status=document.getElementById('status');let baselineMemory=null;
try{
 choose('phantom','default');
 const baseline=create(await load('phantom'));baseline.update({seconds:0,shots:[],speed:0,reloadSince:null,adsBlend:0});renderer.clear();baseline.render(renderer,{aspect:16/9});const baseFx=weaponEffects({detail:15});await baseFx.prepare('phantom',renderer,baseline);baseFx.dispose();baseline.dispose();baselineMemory={...renderer.info.memory};
 for(const item of cases){
  const {key,collection,gun,theme}=item,isMelee=gun==='melee';choose(gun,collection,theme);const pack=await load(isMelee?'knife':gun==='vandal'?'viewmodel':gun,{knife:isMelee});if(!pack)throw Error('Native pack missing '+key);
  const appearanceKey=pack.appearance?.key;if(!appearanceKey)throw Error('Skin pack missing '+key);
  const model=create(pack);model.setFovHorizontal(90);model.setGun('vandal');
  const frames=[];const layer=model.fxLayer(),effects=isMelee?null:weaponEffects({detail:15}),armScales=new Map();await effects?.prepare(gun,renderer,model);
  let surfaceCheck=null;
  const inspect=[{at:.01,inspect:true,weapon:gun}];
  const inspectDuration=pack.appearance.motions?.actions.inspect?.arms?.duration??2;
  const inspectSample=Math.min(inspectDuration*.5,2.49),inspectAt=.01+inspectSample,inspectEnd=4.01+inspectDuration+.5;
  const meleeStates=[['idle',0,[],null,'right',0,[]],['equip',.3,[],null,'right',0,[],0],...Array.from({length:4},(_,i)=>['attack'+(i+1),.15+i*.3,[],null,'right',0,[{at:.01+i*.3,combo:i,weapon:gun}]]),['heavy',1.35,[],null,'right',0,[{at:1.21,heavy:true,weapon:gun}]],['inspect',inspectAt,[],null,'right',0,inspect],['inspect-attack',3.15,[],null,'right',0,[...inspect,{at:3.01,combo:0,weapon:gun}]],['inspect-cancelled',5,[],null,'right',0,[...inspect,{at:3.01,combo:0,weapon:gun}]],['inspect-repeat',4.01+inspectSample,[],null,'right',0,[{at:4.01,inspect:true,weapon:gun}]],['inspect-ended',inspectEnd,[],null,'right',0,[{at:4.01,inspect:true,weapon:gun}]],['left',0,[],null,'left',0,[]]];
  const states=isMelee?meleeStates:[['idle',0,[],null,'right',0,[]],['fire',.04,[0],null,'right',0,[]],['reload',1.25,[],1.25,'right',0,[]],['inspect',inspectAt,[],null,'right',0,inspect],['inspect-fire',inspectAt+.04,[inspectAt],null,'right',0,inspect],['inspect-reload',inspectAt+.2,[],.2,'right',0,inspect],['inspect-cancelled',inspectAt+.5,[],null,'right',0,inspect],['inspect-repeat',4.01+inspectSample,[],null,'right',0,[{at:4.01,inspect:true,weapon:gun}]],['inspect-ended',inspectEnd,[],null,'right',0,[{at:4.01,inspect:true,weapon:gun}]],['left',0,[],null,'left',0,[]],['ads',0,[],null,'right',1,[]]];
  for(const [state,seconds,shots,reload,hand,ads,melee,equipAt] of states){
   model.setHand(hand);model.update({seconds,shots,melee,equipAt,speed:0,reloadSince:reload,reloadDuration:3,adsBlend:ads,fireIntervalSeconds:.1});renderer.clear();model.render(renderer,{aspect:16/9});
   effects?.frame({time:seconds,shots:[],weapon:gun,zoomed:ads>0,enabled:false,viewModel:model});effects?.render(renderer,layer.camera);
   effects?.frame({time:seconds,shots:state==='fire'?[{at:0,spreadDeg:.1,firingDeg:.1}]:[],weapon:gun,zoomed:ads>0,enabled:true,viewModel:model});effects?.render(renderer,layer.camera);
   let skinMesh=0,skinName=null,nonfinite=0;layer.scene.traverse(obj=>{if(obj.name==='skin:'+appearanceKey)skinName=obj.name;if(obj.name.startsWith('skin:')&&obj.geometry){skinMesh++;for(const n of obj.matrixWorld.elements)if(!Number.isFinite(n))nonfinite++;}});
   if(!skinName||skinMesh<(isMelee?1:2)||nonfinite)throw Error('Skin missing/invalid '+key+' '+state);
   const skin=layer.scene.getObjectByName('skin:'+appearanceKey),motion=skin.userData.motion;
   layer.scene.traverse(obj=>{if(!obj.isBone||!/^L_|^R_|^MasterWeapon$/.test(obj.name))return;if(state==='idle')armScales.set(obj.uuid,obj.scale.toArray());if(state==='inspect-ended'){const original=armScales.get(obj.uuid);if(original&&obj.scale.toArray().some((v,k)=>Math.abs(v-original[k])>1e-5))throw Error('Hand scale not restored '+key+' '+obj.name);}});
   if(['inspect','inspect-repeat'].includes(state)&&motion!=='inspect'||state==='reload'&&motion!=='reload'||['inspect-cancelled','inspect-ended'].includes(state)&&motion==='inspect')throw Error('Wrong animation state '+key+' '+state+' '+motion);
   if(isMelee&&(['equip','heavy'].includes(state)||/^attack[1-4]$/.test(state))){const expected=state==='attack4'&&!pack.appearance.motions?.actions.attack4?'attack1':state;if(pack.appearance.motions?.actions[expected]&&motion!==expected)throw Error('Wrong melee animation '+key+' '+state+' '+motion);}
   if(state==='inspect-attack'&&motion==='inspect')throw Error('Melee attack did not cancel inspect '+key);
   const stats=effects?.stats()??{systems:[],particles:0};if(state==='fire'&&(!stats.systems.length||!stats.particles))throw Error('No skin muzzle particles '+key+' '+JSON.stringify(stats));
   const visibleMaterials=[];layer.scene.traverseVisible(obj=>{if(!obj.geometry)return;for(const m of Array.isArray(obj.material)?obj.material:[obj.material])if(m?.visible!==false)visibleMaterials.push({mesh:obj.name,material:m.name,map:!!m.map,color:m.color?.toArray(),emissiveIntensity:m.emissiveIntensity,transparent:m.transparent});});
   frames.push({state,motion,skinMesh,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,effects:stats,...(${materialReview}?{visibleMaterials}:{})});
   if(state==='idle'||collection==='ayakashi'&&['fire','reload','inspect'].includes(state)||collection.startsWith('champions-')&&['equip','heavy','inspect'].includes(state)||${materialReview}&&(state==='inspect'||gun==='operator'&&['reload','ads'].includes(state))){
    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=renderer.domElement.toDataURL('image/png');img.alt=collection+' '+gun+' '+state+(theme==='default'?'':' '+theme);caption.textContent=collection+' · '+gun.toUpperCase()+(theme==='default'?'':' · '+theme)+' · '+state;figure.append(img,caption);document.getElementById('results').append(figure);
   }
   if(${materialReview}&&state==='idle'){
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const snapshot=()=>{ctx.drawImage(renderer.domElement,0,0,320,180);return ctx.getImageData(0,0,320,180).data;};
    const rendererState=()=>{const gl=renderer.getContext(),target=renderer.getRenderTarget(),color={copy(v){this.r=v.r;this.g=v.g;this.b=v.b;return this;}};renderer.getClearColor(color);return {clearColor:[color.r,color.g,color.b],clearAlpha:renderer.getClearAlpha(),target:target?{uuid:target.uuid,width:target.width,height:target.height,texture:target.texture?.uuid}:null,autoClear:renderer.autoClear,outputColorSpace:renderer.outputColorSpace,toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,glClearColor:Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)),colorMask:Array.from(gl.getParameter(gl.COLOR_WRITEMASK)),scissorTest:gl.isEnabled(gl.SCISSOR_TEST),scissor:Array.from(gl.getParameter(gl.SCISSOR_BOX)),viewport:Array.from(gl.getParameter(gl.VIEWPORT)),framebufferBound:gl.getParameter(gl.FRAMEBUFFER_BINDING)!==null,readFramebufferBound:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)!==null};};
    const transforms=()=>{const data=[];layer.scene.traverseVisible(o=>{if(!o.isSkinnedMesh)return;data.push(...o.matrixWorld.elements,...o.bindMatrixInverse.elements,...o.skeleton.boneMatrices);});return data;};
    // Compare the frozen mesh with the same isolated render path on both sides;
    // the state snapshots above also exercise the separate muzzle-effect pass.
    const priorRenderer=rendererState();renderer.setClearColor(0x182431,1);renderer.clear();model.render(renderer,{aspect:16/9});
    const before=snapshot(),beforeTransforms=transforms(),beforeRenderer=rendererState(),features=new Set(),clocks=new Set();layer.scene.traverseVisible(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.userData.aimSurface){const s=m.userData.aimSurface;s.features.forEach(f=>features.add(f));clocks.add(s.clock);}});
    for(const c of clocks){c.time.value=2;c.heat.value=.75;}renderer.setClearColor(0x182431,1);renderer.clear();const clearedRenderer=rendererState();model.render(renderer,{aspect:16/9});const after=snapshot(),afterRenderer=rendererState();
    let animated=0,white=0,opaqueBackgroundChanges=0;for(let i=0;i<before.length;i+=4){if(before[i]>225&&before[i+1]>225&&before[i+2]>225)white++;if(Math.max(Math.abs(before[i]-after[i]),Math.abs(before[i+1]-after[i+1]),Math.abs(before[i+2]-after[i+2]))>5){animated++;if(before[i]===24&&before[i+1]===36&&before[i+2]===49)opaqueBackgroundChanges++;}}
    const afterTransforms=transforms();let transformDelta=0;for(let i=0;i<beforeTransforms.length;i++)transformDelta=Math.max(transformDelta,Math.abs(beforeTransforms[i]-afterTransforms[i]));
    surfaceCheck={features:[...features],animatedPixels:animated,whitePixels:white,outsidePixels:opaqueBackgroundChanges,probePixels:320*180,transformDelta,backgroundBefore:Array.from(before.slice(0,4)),backgroundAfter:Array.from(after.slice(0,4)),rendererPrior:priorRenderer,rendererBefore:beforeRenderer,rendererAfterClear:clearedRenderer,rendererAfter:afterRenderer};
    if(opaqueBackgroundChanges>10)throw Error('Surface effect escaped the existing gun silhouette '+key+' '+JSON.stringify(surfaceCheck));
   }
  }
  let rapidSelectionRestored=null;
  if(collection.startsWith('champions-')&&(!raceChecked.has(gun)||collection==='champions-2026'&&theme==='attacking')){
   const other=cases.find(candidate=>candidate.gun===gun&&candidate.key!==key);if(!other)throw Error('Rapid selection alternate missing '+key);
   const held=holdNextModelLoad(gun);choose(gun,other.collection,other.theme);choose(gun,collection,theme);held.release();await held.settled;await new Promise(requestAnimationFrame);
   model.update({seconds:0,shots:[],melee:[],speed:0,reloadSince:null,adsBlend:0});renderer.clear();model.render(renderer,{aspect:16/9});
   rapidSelectionRestored=!!layer.scene.getObjectByName('skin:'+appearanceKey);
   if(!rapidSelectionRestored||layer.scene.getObjectByName('gun:vandal')?.visible)throw Error('Rapid A to B to A lost the selected skin '+key);
   raceChecked.add(gun);
  }
  choose(gun,'default');
  let leftOver=0;layer.scene.traverse(obj=>{if(obj.name.startsWith('skin:'))leftOver++;});if(leftOver)throw Error('Skin nodes leaked after disabling '+key);
  model.setGun('vandal');model.update({seconds:0,shots:[],speed:0,reloadSince:null,adsBlend:0});renderer.clear();model.render(renderer,{aspect:16/9});
  let nativeVisible=0;layer.scene.traverse(obj=>{if(obj.name==='gun:vandal'&&obj.visible)nativeVisible++;});if(!nativeVisible)throw Error('Native gun not restored '+key);
  choose(gun,collection,theme);await loader.load(gun);await new Promise(requestAnimationFrame);
  model.update({seconds:0,shots:[],speed:0,reloadSince:null,adsBlend:0});renderer.clear();model.render(renderer,{aspect:16/9});
  let restored=false;layer.scene.traverse(obj=>{if(obj.name==='skin:'+appearanceKey)restored=true;});if(!restored)throw Error('Skin did not return '+key);
  effects?.dispose();model.dispose();
  const memory={...renderer.info.memory};if(memory.geometries!==baselineMemory.geometries||memory.textures!==baselineMemory.textures)throw Error('GPU resources leaked '+key+' '+JSON.stringify(memory)+' baseline '+JSON.stringify(baselineMemory));
  results.push({key,frames,...(surfaceCheck?{surfaceCheck}:{}),...(rapidSelectionRestored!==null?{rapidSelectionRestored}:{}),defaultRestored:true,skinRestored:true,memoryAfterDispose:memory});status.textContent='已检查 '+results.length+' / '+cases.length+' 套枪模';
 }
 status.textContent='通过：'+results.length+' 套武器，'+results.reduce((n,r)=>n+r.frames.length,0)+' 个动作、开火特效与左右手状态。';
}catch(e){errors.push(e.stack);status.textContent='验证失败：'+e.message;console.error(e);}
const report={schemaVersion:2,models:results.length,states:results.reduce((n,r)=>n+r.frames.length,0),baselineMemory,results,errors};document.getElementById('report').textContent=JSON.stringify(report,null,2);renderer.dispose();
const nativeInput=weaponInput();nativeInput.attach(document.body);nativeInput.setEnabled(true);let keyPresses=0;
document.getElementById('key-proof').textContent='键盘检视检查：请按 Y';
document.addEventListener('keydown',()=>{const count=nativeInput.takeInspectPresses();keyPresses+=count;if(count){report.nativeInspectKeyPresses=keyPresses;document.getElementById('key-proof').textContent='原生 Y 检视输入：通过（'+keyPresses+' 次）';document.getElementById('report').textContent=JSON.stringify(report,null,2);}});
</script>`);
console.log('Created local weapon review: '+cases.length+' models');
