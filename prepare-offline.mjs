import fs from 'node:fs';
import path from 'node:path';
import {applyInterpolationPatch} from './patches/interpolation.mjs';
import {applyHudPatch} from './patches/hud.mjs';
import {applyFrameratePatch} from './patches/framerate.mjs';
import {applyPrewarmPatch} from './patches/prewarm.mjs';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const source=path.join(root,'site'),dist=path.join(root,'dist');
fs.mkdirSync(dist,{recursive:true});fs.cpSync(source,dist,{recursive:true});
fs.mkdirSync(path.join(root,'runtime'),{recursive:true});
if(!fs.existsSync(path.join(root,'runtime/node.exe')))fs.copyFileSync(process.execPath,path.join(root,'runtime/node.exe'));
const assetFile=path.join(dist,'js/DHDvBWqu.js');
let asset=fs.readFileSync(assetFile,'utf8');
const hostBinding="const M=()=>typeof window<'u'?window[a8(0xe5)][a8(0xd9)]:''";
if(!asset.includes(hostBinding))throw new Error('资源加载器版本不匹配，未修改');
// The public asset package was generated for ishoutu.cn; retain its format and origin identifier locally.
asset=asset.replace(hostBinding,"const M=()=>'ishoutu.cn'");
fs.writeFileSync(assetFile,asset);
for(const dir of ['css','js'])for(const name of fs.readdirSync(path.join(dist,dir))){
 const file=path.join(dist,dir,name);if(!fs.statSync(file).isFile())continue;
 let s=fs.readFileSync(file,'utf8');
 // All static assets in this copy are served by the local server.
 s=s.replaceAll('https://static.ishoutu.cn','');
 fs.writeFileSync(file,s);
}
const studioFile=path.join(dist,'js/ClAFWwpi.js');
if(fs.existsSync(studioFile)){
 let studio=fs.readFileSync(studioFile,'utf8');
 // The editor already saves drafts and scenes in IndexedDB. Offline copies use
 // that normal editor path, without cloud review modes or collaboration rooms.
 const studioQuery='const w=dc()?.query??{},b=';
 const collaboration='ue=l2(),he=Q.filter';
 if(!studio.includes(studioQuery)||!studio.includes(collaboration))throw new Error('场景编辑器版本不匹配，未修改');
 studio=studio.replace(studioQuery,'const w={},b=')
  .replace(collaboration,'ue=!1,he=Q.filter')
  .replace('a("small",null,"瞄准专家")','a("small",null,"本机场景库 · 支持 JSON 导入/导出")');
 fs.writeFileSync(studioFile,studio);
}
const trainingFile=path.join(dist,'js/DVK7uRSu.js');
let training=fs.readFileSync(trainingFile,'utf8');
// Workshop rounds are already recorded with their complete scene document. Make
// their existing local replay button available without enabling cloud features
// or the separate reviewer/player-workshop paths.
const localReplayGuard="h(cB)['lastReplay']['value']&&!cH['value']?";
const workshopIdentity="cE=e(()=>cD['value']?.['source']==='workshop')";
if(training.split(localReplayGuard).length!==2||training.split(workshopIdentity).length!==2)throw new Error('训练回放入口版本不匹配，未修改');
training=training.replace(localReplayGuard,"h(cB)['lastReplay']['value']&&(!cH['value']||cE['value'])?");
fs.writeFileSync(trainingFile,training);
const replayFile=path.join(dist,'js/DqtmD7Xr.js');
let replay=fs.readFileSync(replayFile,'utf8');
// The original replay viewport builds scene blocks and actors but never mounts
// the map GLB. Use the same public map loaders as training, including lighting.
// Visual map clones share cached geometry/materials, so detach rather than
// disposing those shared assets when the viewport is closed.
const replayReplacements=[
 ['let j=null,pe=!1,me=!1,ke=[];',
  'let j=null,pe=!1,me=!1,ke=[];let __aimOfflineReplayDisposed=!1;'],
 ['h=An(t.scene,{aspectRatio:U}),h.camera.fov=xn(oe,U),h.camera.updateProjectionMatrix(),d=ln(t.scene),h.mount(d);',
  'h=An(t.scene,{aspectRatio:U}),h.bindRenderer(k),h.camera.fov=xn(oe,U),h.camera.updateProjectionMatrix(),d=ln(t.scene),h.mount(d);const __aimOfflineMapId=t.scene.environment.map;if(__aimOfflineMapId)Promise.all([__aimOfflineMaps.loadMapVisual(__aimOfflineMapId),__aimOfflineMaps.loadMapLighting(__aimOfflineMapId),__aimOfflineMaps.loadMapPvs(__aimOfflineMapId)]).then(([__aimOfflineMap])=>{if(__aimOfflineReplayDisposed||!h||!k)return;h.applyEnvironment(t.scene.environment);h.setMapVisual(__aimOfflineMap);I()}).catch(__aimOfflineMapError=>console.error("离线回放地图加载失败",__aimOfflineMapError));'],
 ['function I(){!k||!h||(k.render(h.scene,h.camera)',
  'function I(){!k||!h||(h.updateLocalLights(h.camera.position),h.updateMapVisibility(h.camera,!1),k.render(h.scene,h.camera)'],
 ['Ze(()=>{re?.disconnect(),re=null,_?.dispose()',
  'Ze(()=>{__aimOfflineReplayDisposed=!0;h?.setMapVisual(null);re?.disconnect(),re=null,_?.dispose()'],
];
if(replay.includes('__aimOfflineMaps'))throw new Error('回放地图模块已被修改，未重复应用');
for(const [before,after] of replayReplacements){
 if(replay.split(before).length!==2)throw new Error('回放地图模块版本不匹配，未修改');
 replay=replay.replace(before,after);
}
replay='import{f1 as __aimOfflineMaps}from"./aQOfOAp-.js";\n'+replay;
fs.writeFileSync(replayFile,replay);
// Performance patches are reproducible transformations of the retained public
// client modules. Each patch rejects unexpected upstream versions.
const moduleDirectory=path.join(dist,'js');
const originalModules=Object.fromEntries(fs.readdirSync(moduleDirectory).filter(name=>name.endsWith('.js')).map(name=>[name,fs.readFileSync(path.join(moduleDirectory,name),'utf8')]));
const optimizedModules=applyPrewarmPatch(applyFrameratePatch(applyHudPatch(applyInterpolationPatch(originalModules))));
for(const[name,text]of Object.entries(optimizedModules))if(text!==originalModules[name])fs.writeFileSync(path.join(moduleDirectory,name),text);
const offlineStyles=`.al-studio-shell [data-action="share-scene"],.al-studio-shell [data-action="my-cloud-scenes"],.al-studio-shell [data-action="pw-manage"],.al-studio-shell .pwb,.al-studio-shell .al-cloud-scene-share{display:none!important}`;
fs.writeFileSync(path.join(dist,'offline-ui.css'),offlineStyles);
const sceneDir=path.join(dist,'prod-api/api/v1/public/val/aimlab/scenes');
const sceneCodes=new Set(fs.existsSync(sceneDir)?fs.readdirSync(sceneDir):[]);
const workshopPath=path.join(dist,'prod-api/api/v1/public/val/aimlab/workshop');
const catalogue=JSON.parse(fs.readFileSync(workshopPath,'utf8'));
const allCount=catalogue.data.length;
catalogue.data=catalogue.data.filter(s=>sceneCodes.has(s.shareCode));
fs.writeFileSync(workshopPath,JSON.stringify(catalogue));
fs.copyFileSync(path.join(root,'offline-runtime.js'),path.join(dist,'offline-runtime.js'));
fs.writeFileSync(path.join(dist,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101316"><title>瞄准专家 · 离线版</title><link rel="icon" href="/favicon-aim.ico"><link rel="stylesheet" href="/css/index.DjXErpXU.css"><link rel="stylesheet" href="/offline-ui.css"><script src="/offline-runtime.js"></script><script type="module" src="/js/index.C6F_bJRd.js"></script></head><body><div id="app"></div></body></html>`);
const maps=[...new Set(catalogue.data.map(s=>s.mapId).filter(Boolean))];
const summary={app:'aim-offline',version:2,originalVersion:'0.0.15',sceneCount:catalogue.data.length,originalSceneCount:allCount,maps,network:'local-only',origin:'http://127.0.0.1:18746',performanceOptimizations:['adjacent-tick-interpolation','shared-hud-raf','local-fps-limit','scene-prewarm'],created:new Date().toISOString()};
fs.writeFileSync(path.join(dist,'offline-manifest.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
