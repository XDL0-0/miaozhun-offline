// Run the actual shipped renderer with memory-only skin choices. No user scores
// or preferences are written. Read the resulting DOM report in a real browser.
import './review-weapon-models.mjs';
import fs from 'node:fs';
const root=new URL('../',import.meta.url),file=name=>new URL(name,root);
const index=JSON.parse(fs.readFileSync(file('dist/skin-packs/models/index.json')));
const caseFiles=new Map();
for(const [key,url]of Object.entries(index.models))if(!key.endsWith('/melee'))caseFiles.set(url,key);
for(const [base,themes]of Object.entries(index.variants??{}))if(!base.endsWith('/melee'))for(const [theme,url]of Object.entries(themes))if(!caseFiles.has(url))caseFiles.set(url,base+'/'+theme);
const source=fs.readFileSync(file('site/js/aQOfOAp-.js'),'utf8');
const alias=source.slice(source.lastIndexOf('export{')).match(/\bDp as (\w+)\b/)[1];
fs.writeFileSync(file('dist/__weapon-fx-review.html'),`<!doctype html><meta charset="utf-8"><title>离线开火特效检查</title>
<style>body{margin:0;background:#10171f;color:#e8eff7;font:14px system-ui}header,pre{padding:20px}h1{font-size:22px}#results{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:15px}figure{margin:0;background:#1b2633}img{width:100%;display:block}figcaption{padding:8px}pre{white-space:pre-wrap}</style>
<header><h1>离线皮肤 · 连射与瞄准检查</h1><p id="status">加载原始枪模与本地粒子…</p><p>每张图依次为：腰射、腰射高散布、瞄准、瞄准高散布；记录各序列遮挡最明显的一帧。</p></header><div id="results"></div><pre id="report"></pre>
<script type="module">
import {${alias} as Renderer} from '/js/aQOfOAp-.js';
import {l as load,c as create} from '/__weapon-view.mjs';
import {choose} from '/__weapon-harness.mjs';
import {weaponEffects} from '/__weapon-game.mjs';
const cases=${JSON.stringify([...caseFiles.values()])},results=[],errors=[];
const renderer=new Renderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,720,false);renderer.setClearColor(0x182431,1);
const probe=document.createElement('canvas');probe.width=320;probe.height=180;const ctx=probe.getContext('2d',{willReadFrequently:true});
const capture=()=>{ctx.drawImage(renderer.domElement,0,0,320,180);return ctx.getImageData(0,0,320,180).data;};
try{
 for(const key of cases){
  const [collection,gun,theme]=key.split('/');choose(gun,collection,theme);const model=create(await load(gun==='vandal'?'viewmodel':gun));model.setGun('vandal');model.setFovHorizontal(90);
  const layer=model.fxLayer(),frames=[];const strip=document.createElement('canvas');strip.width=1280;strip.height=180;const stripCtx=strip.getContext('2d');
  for(const [scenario,zoomed,spread] of [['hip',false,.1],['hip-spread',false,5],['ads',true,.1],['ads-spread',true,5]]){
   const effects=weaponEffects({detail:15});await effects.prepare(gun,renderer,model);
   let worst={changed:0,center:0},shot=0,baseline=null;
   for(let frame=0;frame<=72;frame++){
    const time=frame/120,fire=frame<60&&frame%12===0;
    if(fire)shot=time;
    model.update({seconds:time,shots:frame<60?[shot]:[],speed:0,reloadSince:null,adsBlend:zoomed?1:0,fireIntervalSeconds:.1});
    renderer.clear();model.render(renderer,{aspect:16/9});baseline=capture();
    effects.frame({time,shots:fire?[{at:time,spreadDeg:spread,firingDeg:spread}]:[],weapon:gun,zoomed,enabled:true,viewModel:model});effects.render(renderer,layer.camera);
    const pixels=capture();let changed=0,center=0;
    for(let y=0;y<180;y++)for(let x=0;x<320;x++){
     const p=(y*320+x)*4;if(Math.max(Math.abs(pixels[p]-baseline[p]),Math.abs(pixels[p+1]-baseline[p+1]),Math.abs(pixels[p+2]-baseline[p+2]))<48)continue;
     changed++;if(x>=112&&x<208&&y>=45&&y<117)center++;
    }
    if(changed>worst.changed){worst={changed,center,time,particles:effects.stats().particles};stripCtx.drawImage(renderer.domElement,frames.length*320,0,320,180);}
   }
   frames.push({scenario,...worst,coverage:worst.changed/(320*180),centerCoverage:worst.center/(96*72)});effects.dispose();
  }
  const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.alt=key+' firing';img.src=strip.toDataURL('image/png');caption.textContent=key+' · 最大画面变化 '+(Math.max(...frames.map(f=>f.coverage))*100).toFixed(1)+'%';figure.append(img,caption);document.getElementById('results').append(figure);
  model.dispose();results.push({key,frames});document.getElementById('status').textContent='已检查 '+results.length+' / '+cases.length;
  // A regression budget for this fixed camera and dark test background, not a
  // gameplay visibility metric or a frame-rate benchmark.
  for(const f of frames)if(f.coverage>.04||f.centerCoverage>.25)throw Error('Intrusive firing coverage '+key+' '+f.scenario);
 }
 document.getElementById('status').textContent='完成：'+results.length+' 套枪械、'+results.length*4+' 组连射序列、'+results.length*4*73+' 帧。';
}catch(e){errors.push(e.stack);document.getElementById('status').textContent='失败：'+e.message;console.error(e);}
document.getElementById('report').textContent=JSON.stringify({models:results.length,scenarios:results.length*4,frames:results.length*4*73,results,errors},null,2);renderer.dispose();
</script>`);
console.log('Created local burst/ADS effect review');
