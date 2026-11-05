import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyUpstreamWeaponsPatch,UPSTREAM_WEAPON_RUNTIME_FILES,upstreamWeaponRuntimeSource} from '../patches/upstream-weapons.mjs';
import {applyUpstreamPerformancePatch,upstreamPerformanceCoverage} from '../patches/upstream-performance.mjs';
import {applyUpstreamStoragePatch,upstreamStorageCompatibility} from '../patches/upstream-storage.mjs';
import {applyUpstreamOfflinePatch} from '../patches/upstream-offline.mjs';
import {applyBotOrderCss} from '../patches/bot-order.mjs';
import {applyTrainingHallVisibilityCss} from '../patches/training-hall-visibility.mjs';
import {buildSkinPacks} from './build-skin-packs.mjs';
import {readEnglishCatalog} from './build-localization.mjs';
import {localizeJavaScript} from '../patches/localization.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=path.join(root,'upstream/aimpro-2026-11-05');
const qa=process.argv.includes('--qa');
const destination=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
const productionDist=path.join(root,'dist');
const dist=path.resolve(destination??productionDist);
const baselineRenderAllocations=process.argv.includes('--baseline-render-allocations');
// A/B baseline only: --baseline-render-allocations --output=<isolated directory>.
// Resolve existing parents too, so symlink aliases cannot target production.
function resolveOutputPath(directory){
  if(fs.existsSync(directory))return fs.realpathSync(directory);
  try{if(fs.lstatSync(directory).isSymbolicLink())throw Error(`Cannot resolve output symlink: ${directory}`)}catch(error){if(error.code!=='ENOENT')throw error}
  const parent=path.dirname(directory);
  if(parent===directory)throw Error(`Cannot resolve output directory: ${directory}`);
  return path.join(resolveOutputPath(parent),path.basename(directory));
}
if(baselineRenderAllocations){
  if(!destination?.trim())throw Error('--baseline-render-allocations requires explicit --output=<directory> outside production dist');
  const within=(directory,parent)=>directory===parent||directory.startsWith(parent+path.sep);
  if(within(dist,productionDist)||within(resolveOutputPath(dist),resolveOutputPath(productionDist)))throw Error('--baseline-render-allocations output must be outside production dist and its descendants');
}
fs.mkdirSync(dist,{recursive:true});
fs.cpSync(path.join(snapshot,'client'),dist,{recursive:true});
// Cached public API documents are data, not executable code. Keep their exact
// serialized scene documents and stable IDs for old favorites and recordings.
const api=path.join(dist,'prod-api/api/v1/public/val/aimlab');
fs.mkdirSync(api,{recursive:true});
fs.cpSync(path.join(snapshot,'scenes'),path.join(api,'scenes'),{recursive:true});
fs.copyFileSync(path.join(snapshot,'workshop.json'),path.join(api,'workshop'));
const moduleDir=path.join(dist,'js');
let modules=Object.fromEntries(fs.readdirSync(moduleDir).filter(x=>x.endsWith('.js')).map(x=>[x,fs.readFileSync(path.join(moduleDir,x),'utf8')]));
// Apply only to retained new client modules; older files may remain in an
// existing installation for rollback, but the new entry imports none of them.
modules=applyUpstreamStoragePatch(applyUpstreamOfflinePatch(applyUpstreamPerformancePatch(applyUpstreamWeaponsPatch(modules),{renderAllocations:!baselineRenderAllocations})));
const catalog={...readEnglishCatalog(root),
  '本机记录：':'Local records:',
  '这些记录保存在当前浏览器。清除浏览器数据会删除记录，请通过完整备份迁移。':'These records are stored in this browser. Clearing browser data deletes them; use Full Backup to move them.',
  '手动换弹；无限子弹时也可使用。换弹期间无法开火':'Reload manually, including with unlimited ammunition. You cannot fire while reloading.',
  '拿刀或皮肤枪械时按一下进行检视；开火、换弹或切枪会打断检视':'Press to inspect your melee weapon or equipped weapon skin. Firing, reloading, or switching weapons interrupts inspection.',
};
// Native translation covers new UI/skills. Extend its reviewed exact catalogue
// with existing offline and skin labels without rewriting scene data.
modules['sBQRcQP-.js']=modules['sBQRcQP-.js'].replace('export{',`Object.assign(e,${JSON.stringify(catalog)});export{`);
for(const[name,source]of Object.entries(modules))fs.writeFileSync(path.join(moduleDir,name),source);
for(const[target,source]of Object.entries(UPSTREAM_WEAPON_RUNTIME_FILES))fs.writeFileSync(path.join(moduleDir,target),localizeJavaScript(upstreamWeaponRuntimeSource(target,fs.readFileSync(path.join(root,'patches',source),'utf8')),{filename:target}));
for(const name of fs.readdirSync(path.join(dist,'css'))){const file=path.join(dist,'css',name);if(!fs.statSync(file).isFile())continue;let css=fs.readFileSync(file,'utf8').replaceAll('https://static.ishoutu.cn','').replace(/@font-face\s*\{[^}]*chrome-extension:[^}]*\}/g,'');fs.writeFileSync(file,css);}
const trainCss=path.join(dist,'css/TrainLayer.C2Y5fT-i.css');
fs.writeFileSync(trainCss,applyTrainingHallVisibilityCss(fs.readFileSync(trainCss,'utf8')));
const orderCss=path.join(dist,'css/sceneBrief.u6P84tFc.css');
fs.writeFileSync(orderCss,applyBotOrderCss(fs.readFileSync(orderCss,'utf8')));
const skinManifest=buildSkinPacks({root,destination:path.join(dist,'skin-packs')});
fs.cpSync(path.join(root,'skin-packs/models'),path.join(dist,'skin-packs/models'),{recursive:true});
const modelManifest=JSON.parse(fs.readFileSync(path.join(root,'skin-packs/models/index.json'),'utf8'));
let locale=fs.readFileSync(path.join(root,'patches/i18n-runtime.js'),'utf8')
  .replace('/*__AIM_ENGLISH_CATALOG__*/{}',JSON.stringify(catalog))
  .replace('/*__AIM_SCENE_NAMES__*/{}','{}').replace('/*__AIM_MINIMAP_CALLOUTS__*/{}','{}')
  .replace('global.localStorage.getItem(key);',"global.localStorage.getItem(key) ?? global.localStorage.getItem('aim-lang');")
  .replace('global.localStorage.setItem(key, next);',"global.localStorage.setItem(key, next);global.localStorage.setItem('aim-lang', next);");
fs.writeFileSync(path.join(dist,'offline-i18n.js'),locale);
let offline=fs.readFileSync(path.join(root,'offline-runtime.js'),'utf8').replace("['ishoutu.cn','static.ishoutu.cn']","['ishoutu.cn','static.ishoutu.cn','aimpro.world']");
offline=offline.replace("const unavailableSelector='","const unavailableSelector='.hall-profile--login,[data-action=\"tab-pw\"],[data-action=\"tab-poll\"],[data-action=\"tab-haojiao\"],[data-action=\"raffle\"],[data-action=\"checkup\"],[data-action=\"open-desktop-download\"],[data-action=\"changelog\"],[data-action=\"share\"],[data-action=\"login\"],[data-action=\"ball-open-board\"],").replace("const tab=[...document.querySelectorAll('.hall-tab')].find(el=>el.textContent.trim()==='瓦工坊')","const tab=document.querySelector('[data-action=\"tab-workshop\"]')").replace("target.classList.contains('hall-rail-item')&&target.textContent.trim()==='收藏项目'","target.matches('[data-action=\"favorites\"]')").replace("target.classList.contains('hall-tab')&&target.textContent.trim()==='瓦工坊'","target.matches('[data-action=\"tab-workshop\"]')");
fs.writeFileSync(path.join(dist,'offline-runtime.js'),localizeJavaScript(offline,{filename:'offline-runtime.js'}));
const offlineStyles='.al-rv button[aria-label="Share"],.al-rv button[aria-label="分享"]{display:none!important}.al-studio-shell [data-action="share-scene"],.al-studio-shell [data-action="my-cloud-scenes"],.al-studio-shell [data-action="pw-manage"],.al-studio-shell .pwb,.al-studio-shell .al-cloud-scene-share{display:none!important}';
fs.writeFileSync(path.join(dist,'offline-ui.css'),[offlineStyles,...['skin-packs.css','localization.css','layout.css','settings-layout.css','editor-layout.css'].map(name=>fs.readFileSync(path.join(root,'patches',name),'utf8'))].join('\n'));
fs.writeFileSync(path.join(dist,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101316"><title>瞄准专家 · 离线版</title><link rel="icon" href="/favicon-aim.ico"><link rel="stylesheet" href="/css/index.BIf09BrE.css"><link rel="stylesheet" href="/offline-ui.css"><script>window.__AIM_NO_THIRD_PARTY_STATS__=true;${qa?'Element.prototype.requestFullscreen=()=>Promise.resolve();let __qaPointer=null;Object.defineProperty(document,"pointerLockElement",{get:()=>__qaPointer});Element.prototype.requestPointerLock=function(){__qaPointer=this;document.dispatchEvent(new Event("pointerlockchange"));return Promise.resolve()};document.exitPointerLock=()=>{__qaPointer=null;document.dispatchEvent(new Event("pointerlockchange"))};':''}</script><script src="/offline-i18n.js"></script><script src="/offline-runtime.js"></script><script type="module" src="/js/index.FoQE3geO.js"></script></head><body><div id="app"></div></body></html>`);
const workshop=JSON.parse(fs.readFileSync(path.join(api,'workshop'),'utf8'));
const performanceOptimizations=baselineRenderAllocations?{...upstreamPerformanceCoverage,renderAllocation:'Disabled (--baseline-render-allocations): native actor/camera temporary vectors and per-frame actor-ID Set retained.'}:upstreamPerformanceCoverage;
const manifest={app:'aim-offline',version:5,engineBuild:'aimpro-2026-11-05',mapFormat:'VMP1',assetFormat:'versioned VSE2',sceneCount:workshop.data.length,maps:[...new Set(workshop.data.map(x=>x.mapId).filter(Boolean))],network:'local-only',origin:'http://127.0.0.1:18746',languages:['zh-CN','en'],defaultLanguage:'zh-CN',storageCompatibility:upstreamStorageCompatibility,performanceOptimizations,skinPacks:skinManifest.counts,weaponModels:modelManifest.counts,created:new Date().toISOString()};
fs.writeFileSync(path.join(dist,'offline-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({destination:dist,...manifest},null,2));

fs.writeFileSync(path.join(dist,'localization-report.json'),JSON.stringify({schemaVersion:2,engineBuild:manifest.engineBuild,languages:manifest.languages,defaultLanguage:manifest.defaultLanguage,translationMode:'native DOM/canvas translation with retained offline and skin catalogue',offlineCatalogEntries:Object.keys(catalog).length,sceneDocuments:'original unchanged',coverage:'Native catalogue coverage is not a full audit of every new string.'},null,2)+'\n');
