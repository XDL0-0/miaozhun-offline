// Public aim routes only. This reads source text; it never evaluates downloaded code.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const site=path.join(root,'site');
const main='js/index.C6F_bJRd.js';
const mainText=fs.readFileSync(path.join(site,main),'utf8');
const skippedDynamic=new Map([
 ['js/BbCrAlFy.js','online course/checkup outside local training'],
 ['js/OmX0A8kk.js','online course account outside local training'],
 ['js/mxLm3KzH.js','skin lab requires val:aimlab:audit permission'],
]);

function viteDependencies(source){
 const match=source.match(/m\.f=\[(.*?)\]/s);
 return match?JSON.parse('['+match[1]+']').map(p=>p.replace(/^\//,'')):[];
}

const mainDeps=viteDependencies(mainText);
const aimStart=mainText.indexOf('{path:"/aim",component:Mm');
const aimEnd=mainText.indexOf('{path:"/buyer-home"',aimStart);
if(aimStart<0||aimEnd<0)throw new Error('Unknown aim route definition; update route boundary before scanning.');
const routeText=mainText.slice(aimStart,aimEnd);
const seeds=[main,...[...routeText.matchAll(/__vite__mapDeps\(\[([0-9,]+)\]\)/g)]
 .flatMap(m=>m[1].split(',').map(i=>mainDeps[+i]))];
const queue=[],parents=new Map(),scanned=[],excluded=[];
function add(relative,source){
 if(!relative)return;
 if(relative.split('/').includes('..')||relative.includes(':'))throw new Error('Unexpected module path: '+relative);
 if(!parents.has(relative)){parents.set(relative,new Set());queue.push(relative);}
 parents.get(relative).add(source);
}
function resolveModule(from,target){return path.posix.normalize(path.posix.join(path.posix.dirname(from),target));}
for(const seed of seeds)add(seed,'aim route preload');

while(queue.length){
 const relative=queue.shift(),file=path.join(site,relative);
 if(!fs.existsSync(file))continue;
 scanned.push(relative);
 const source=fs.readFileSync(file,'utf8');
 if(relative.endsWith('.js')){
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)(["'])(\.\.?\/[^"']+)\1/g)){
   add(resolveModule(relative,match[2]),relative+' static import');
  }
  // The main bundle lists every site route. AuthDialog lists login/register/WeChat.
  // Only follow the aim component's dynamic imports, not those unrelated lists.
  if(relative===main||relative==='js/CdryQ4Mo.js')continue;
  const deps=viteDependencies(source);
  for(const match of source.matchAll(/import\((["'])(\.\.?\/[^"']+)\1\)(.{0,200}?)__vite__mapDeps\(\[([0-9,]+)\]\)/g)){
   const target=resolveModule(relative,match[2]);
   if(skippedDynamic.has(target)){
    excluded.push({path:target,source:relative,reason:skippedDynamic.get(target)});
    continue;
   }
   add(target,relative+' dynamic import');
   for(const index of match[4].split(','))add(deps[+index],relative+' dynamic preload '+target);
  }
  for(const match of source.matchAll(/import\((["'])(\.\.?\/[^"']+)\1\)/g)){
   const target=resolveModule(relative,match[2]);
   if(!skippedDynamic.has(target))add(target,relative+' dynamic import');
  }
 }else if(relative.endsWith('.css')){
  for(const match of source.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)){
   let target=match[1];
   try{target=decodeURIComponent(target);}catch{}
   // Saved browser CSS may contain extension-injected SVG/font declarations.
   if(target.startsWith('#')||target.includes(':'))continue;
   const resolved=target.startsWith('/')?target.slice(1):resolveModule(relative,target);
   add(resolved,relative+' css url');
  }
 }
}

const all=[...parents].map(([relative,sources])=>({path:relative,source:[...sources].join('; ')}));
const missing=all.filter(item=>!fs.existsSync(path.join(site,item.path)));
const report={
 generated:new Date().toISOString(),
 scope:'Public /aim route preloads, normal editor, training, settings and previews; excludes permission-gated skin lab, auth and courses.',
 counts:{total:all.length,present:all.length-missing.length,missing:missing.length},
 missing,missingJsRequiringExpansion:missing.filter(item=>item.path.endsWith('.js')),excluded,all,
 complete:missing.length===0,
 caveat:'Re-run after missing JavaScript is acquired. Its dependencies cannot be known before source is available. Public server data for boards/shared profiles is separate from this module inventory.',
 studio:{
  entry:'js/COrNDj1U.js',shell:'js/ClAFWwpi.js',style:'css/StudioShell.BwZqhuLr.css',
  backendForNormalEditing:false,
  storage:{database:'aimlab-studio',stores:{draft:{keyPath:null,keys:['current','current-owner']},scenes:{keyPath:'id'}}},
  localFeatures:['new scene','save as','autosave','JSON import','JSON export','playtest'],
  onlineFeatures:['cloud scene share','my cloud scenes','publish workshop','manage submissions','collaboration','review/admin routes'],
 },
};
fs.writeFileSync(path.join(root,'module-candidates.json'),JSON.stringify(missing,null,2));
fs.writeFileSync(path.join(root,'module-analysis-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({counts:report.counts,missing},null,2));
