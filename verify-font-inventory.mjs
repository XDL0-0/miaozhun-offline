import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const packageRoot=path.dirname(fileURLToPath(import.meta.url));
const walkFiles=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walkFiles(path.join(dir,e.name)):[path.join(dir,e.name)]);
const decodeHtml=s=>s.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');
const rank=p=>p.endsWith('.woff2')?0:p.endsWith('.woff')?1:/\.(?:ttf|otf)$/.test(p)?2:3;
export function inventoryFonts(root){
 const assets=new Map(),groups=[],excluded=[];
 const present=p=>fs.existsSync(path.join(root,p.replace(/^\//,'')));
 const resolve=(raw,from)=>{
  raw=decodeHtml(raw).trim();
  if(/^data:/.test(raw))return{embedded:true,mime:raw.slice(5,raw.indexOf(';')),bytes:raw.length};
  if(raw.startsWith('#'))return null;
  if(/^[a-z-]+:\/\//i.test(raw)){
   const u=new URL(raw);if(!['ishoutu.cn','static.ishoutu.cn','127.0.0.1','localhost'].includes(u.hostname)){excluded.push({source:from,url:raw,reason:'browser extension or unrelated external font'});return null}raw=u.pathname;
  }
  raw=decodeURIComponent(raw.split('?')[0].split('#')[0]);
  if(!/\.(?:woff2?|ttf|otf|eot|svg)$/i.test(raw))return null;
  return{path:raw.startsWith('/')?raw:path.posix.normalize(path.posix.join(path.posix.dirname(from),raw))};
 };
 const urls=body=>[...body.matchAll(/url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gs)].map(m=>m[2]??m[3]);
 const attr=(body,key)=>body.match(new RegExp('(?:^|;)\\s*'+key+'\\s*:\\s*([^;}]+)','i'))?.[1]?.trim()??null;
 const add=(p,source,optional,group)=>{
  let a=assets.get(p);if(!a){a={path:p,source,optional,priority:rank(p),groups:[]};assets.set(p,a)}else{if(!a.source.includes(source))a.source+='; '+source;if(!optional)a.optional=false}
  if(!a.groups.includes(group))a.groups.push(group);
 };
 for(const file of walkFiles(path.join(root,'css')).filter(f=>f.endsWith('.css'))){
  const from='/'+path.relative(root,file).replaceAll('\\','/'),source=decodeHtml(fs.readFileSync(file,'utf8'));
  for(const match of source.matchAll(/@font-face\s*\{([^}]+)\}/gi)){
   const body=match[1],resolved=urls(body).map(raw=>resolve(raw,from)).filter(Boolean);
   if(!resolved.length)continue;
   const external=[...new Set(resolved.filter(r=>r.path).map(r=>r.path))].sort((a,b)=>rank(a)-rank(b));
   const embedded=resolved.filter(r=>r.embedded),embeddedWoff2=embedded.some(r=>/woff2/.test(r.mime));
   const family=attr(body,'font-family'),weight=attr(body,'font-weight')??'normal',style=attr(body,'font-style')??'normal',range=attr(body,'unicode-range');
   const group=from+'@font-face#'+groups.length,primary=embeddedWoff2?null:external[0]??null;
   for(const p of external)add(p,`${from} @font-face ${family} weight ${weight} style ${style}; URL ${p}`,p!==primary,group);
   groups.push({id:group,css:from,family,weight,style,unicodeRange:range,embedded:embedded.length>0,external,primary,satisfied:embedded.length>0||external.some(present),cached:external.filter(present)});
  }
 }
 const list=[...assets.values()].sort((a,b)=>Number(a.optional)-Number(b.optional)||a.priority-b.priority||a.path.localeCompare(b.path));
 const byFamily={};for(const g of groups){let f=byFamily[g.family]??={groups:0,satisfied:0,missing:0,embedded:0};f.groups++;f.satisfied+=Number(g.satisfied);f.missing+=Number(!g.satisfied);f.embedded+=Number(g.embedded)}
 return{candidates:list,report:{generatedAt:new Date().toISOString(),root,files:list.length,cachedFiles:list.filter(x=>present(x.path)).length,missingFiles:list.filter(x=>!present(x.path)).length,groups:groups.length,satisfiedGroups:groups.filter(x=>x.satisfied).length,missingGroups:groups.filter(x=>!x.satisfied).length,missingPrimaryFiles:list.filter(x=>!x.optional&&!present(x.path)),missingFallbackFiles:list.filter(x=>x.optional&&!present(x.path)),byFamily,excluded,allGroups:groups,notes:['WOFF2 is preferred; other encodings in the same @font-face are optional alternatives.','Embedded data fonts satisfy their group without an external file.','Original CSS sources and each exact URL remain attached to each candidate.','Only public-site local font URLs are enumerated; browser-extension injected fonts are excluded.']}};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const arg=process.argv.find(x=>x.startsWith('--root=')),root=arg?path.resolve(arg.slice(7)):path.join(packageRoot,'site');
 const {candidates,report}=inventoryFonts(root);
 fs.writeFileSync(path.join(packageRoot,'font-candidates.json'),JSON.stringify(candidates,null,2));
 fs.writeFileSync(path.join(packageRoot,'font-inventory-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({files:report.files,cachedFiles:report.cachedFiles,missingFiles:report.missingFiles,groups:report.groups,satisfiedGroups:report.satisfiedGroups,missingGroups:report.missingGroups,missingPrimaryFiles:report.missingPrimaryFiles.length,missingFallbackFiles:report.missingFallbackFiles.length,byFamily:report.byFamily,excluded:report.excluded},null,2));
}
