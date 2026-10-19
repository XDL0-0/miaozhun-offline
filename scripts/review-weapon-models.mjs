import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const file=name=>new URL(name,root);
const index=JSON.parse(fs.readFileSync(file('dist/skin-packs/models/index.json')));
const native=fs.readFileSync(file('dist/js/CFqO0zvx.js'),'utf8').replaceAll('from"./','from"/js/').replaceAll("from'./","from'/js/").replace('from"/js/aim-weapon-models.mjs"','from"/__weapon-harness.mjs"');
fs.writeFileSync(file('dist/__weapon-view.mjs'),native);
fs.writeFileSync(file('dist/__weapon-harness.mjs'),`import {createWeaponModelLoader,createWeaponAppearance} from '/js/aim-weapon-models.mjs';
const selected={},listeners=new Set();
export const skins={async initialize(){},selection:gun=>selected[gun]??{collection:'default'},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
export function choose(gun,collection){selected[gun]={collection,modelEnabled:true};for(const fn of listeners)fn();}
export const loader=createWeaponModelLoader({skins});
export const loadWeaponModel=stem=>loader.load(stem);
export const createWeaponAppearance=options=>createWeaponAppearanceImpl({...options,skins,loader});
const createWeaponAppearanceImpl=createWeaponAppearance;
`.replace('import {createWeaponModelLoader,createWeaponAppearance}', 'import {createWeaponModelLoader,createWeaponAppearance as createWeaponAppearanceImpl}').replace('const createWeaponAppearanceImpl=createWeaponAppearance;',''));
const aQ=fs.readFileSync(file('site/js/aQOfOAp-.js'),'utf8');
const rendererAlias=aQ.slice(aQ.lastIndexOf('export{')).match(/\bDp as (\w+)\b/)[1];
const cases=Object.keys(index.models).sort((a,b)=>Number(b.includes('ayakashi'))-Number(a.includes('ayakashi')));
fs.writeFileSync(file('dist/__weapon-review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>皮肤枪模验证</title>
<style>body{margin:0;background:#10171f;color:#e8eff7;font:14px system-ui}header{padding:18px 22px}h1{font-size:22px;margin:0 0 8px}p{margin:4px 0;color:#aebed0}#results{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;padding:0 20px 20px}figure{margin:0;background:#1b2633;border:1px solid #334659;border-radius:10px;overflow:hidden}figure img{width:100%;display:block}figcaption{padding:8px 12px}#report{white-space:pre-wrap;padding:20px}#app{display:none}</style>
<header><h1>皮肤枪模 · 本地实机渲染</h1><p>原始三维几何与贴图 · 原版持枪和换弹动作 · 全部素材来自本机</p><p id="status">正在检查模型、骨骼和材质…</p></header><section id="results"></section><pre id="report"></pre><div id="app"></div>
<script type="module">
import {${rendererAlias} as Renderer} from '/js/aQOfOAp-.js';
import {l as load,c as create} from '/__weapon-view.mjs';
import {choose,loader} from '/__weapon-harness.mjs';
const cases=${JSON.stringify(cases)},results=[],errors=[];
const renderer=new Renderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(640,360,false);renderer.setClearColor(0x182431,1);
const status=document.getElementById('status');let baselineMemory=null;
try{
 choose('phantom','default');
 const baseline=create(await load('phantom'));baseline.update({seconds:0,shots:[],speed:0,reloadSince:null,adsBlend:0});renderer.clear();baseline.render(renderer,{aspect:16/9});baseline.dispose();baselineMemory={...renderer.info.memory};
 for(const key of cases){
  const [collection,gun]=key.split('/');choose(gun,collection);const pack=await load(gun==='vandal'?'viewmodel':gun);if(!pack)throw Error('Native pack missing '+key);
  const model=create(pack);model.setFovHorizontal(90);model.setGun('vandal');
  const frames=[];const layer=model.fxLayer();
  for(const [state,seconds,shots,reload,hand,ads] of [['idle',0,[],null,'right',0],['fire',.12,[0],null,'right',0],['reload',1.25,[],1.25,'right',0],['left',0,[],null,'left',0],['ads',0,[],null,'right',1]]){
   model.setHand(hand);model.update({seconds,shots,speed:0,reloadSince:reload,adsBlend:ads,fireIntervalSeconds:.1});renderer.clear();model.render(renderer,{aspect:16/9});
   let skinMesh=0,skinName=null,nonfinite=0;layer.scene.traverse(obj=>{if(obj.name==='skin:'+key)skinName=obj.name;if(obj.name.startsWith('skin:')&&obj.geometry){skinMesh++;for(const n of obj.matrixWorld.elements)if(!Number.isFinite(n))nonfinite++;}});
   if(!skinName||skinMesh<2||nonfinite)throw Error('Skin missing/invalid '+key+' '+state);
   frames.push({state,skinMesh,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls});
   if(state==='idle'){
    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=renderer.domElement.toDataURL('image/png');img.alt=collection+' '+gun;caption.textContent=collection+' · '+gun.toUpperCase();figure.append(img,caption);document.getElementById('results').append(figure);
   }
  }
  choose(gun,'default');
  let leftOver=0;layer.scene.traverse(obj=>{if(obj.name.startsWith('skin:'))leftOver++;});if(leftOver)throw Error('Skin nodes leaked after disabling '+key);
  model.setGun('vandal');model.update({seconds:0,shots:[],speed:0,reloadSince:null,adsBlend:0});renderer.clear();model.render(renderer,{aspect:16/9});
  let nativeVisible=0;layer.scene.traverse(obj=>{if(obj.name==='gun:vandal'&&obj.visible)nativeVisible++;});if(!nativeVisible)throw Error('Native gun not restored '+key);
  choose(gun,collection);await loader.load(gun);await new Promise(requestAnimationFrame);
  model.update({seconds:0,shots:[],speed:0,reloadSince:null,adsBlend:0});renderer.clear();model.render(renderer,{aspect:16/9});
  let restored=false;layer.scene.traverse(obj=>{if(obj.name==='skin:'+key)restored=true;});if(!restored)throw Error('Skin did not return '+key);
  model.dispose();
  const memory={...renderer.info.memory};if(memory.geometries!==baselineMemory.geometries||memory.textures!==baselineMemory.textures)throw Error('GPU resources leaked '+key+' '+JSON.stringify(memory)+' baseline '+JSON.stringify(baselineMemory));
  results.push({key,frames,defaultRestored:true,skinRestored:true,memoryAfterDispose:memory});status.textContent='已检查 '+results.length+' / '+cases.length+' 套枪模';
 }
 status.textContent='通过：'+results.length+' 套枪模，'+results.length*5+' 个动作与左右手状态。';
}catch(e){errors.push(e.stack);status.textContent='验证失败：'+e.message;console.error(e);}
const report={schemaVersion:1,models:results.length,states:results.length*5,baselineMemory,results,errors};document.getElementById('report').textContent=JSON.stringify(report,null,2);renderer.dispose();
</script>`);
console.log('Created local weapon review: '+cases.length+' models');
