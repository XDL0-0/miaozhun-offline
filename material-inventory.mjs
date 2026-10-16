import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const base='G:/TOOLS/AimOffline',root=base+'/site';
const args=process.argv.slice(2);
const scripts=fs.readdirSync(root+'/js').filter(x=>x.endsWith('.js')).map(n=>[n,fs.readFileSync(root+'/js/'+n,'utf8')]);
if(args[0]==='context'||args[0]==='filecontext'){
 let arr=args[0]==='filecontext'?scripts.filter(x=>x[0]===args[1]):scripts;
 for(const [name,s]of arr)for(const term of args.slice(args[0]==='filecontext'?2:1)){
  let i=-1,c=0;while((i=s.indexOf(term,i+1))>=0&&c++<20)console.log(JSON.stringify({name,term,context:s.slice(Math.max(0,i-250),i+800)}));
 }
 process.exit();
}
function expression(s,start){
 let level=0,quote=null,escape=false;
 for(let i=start;i<s.length;i++){
  let c=s[i];if(quote){if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c===quote)quote=null;continue}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue}if(c==='{'||c==='['||c==='(')level++;if(c==='}'||c===']'||c===')'){level--;if(level===0)return s.slice(start,i+1)}
 }
 throw new Error('unbalanced');
}
function obj(file,symbol){const s=scripts.find(x=>x[0]===file)[1],pos=s.indexOf(symbol);if(pos<0)throw new Error(symbol);return vm.runInNewContext('('+expression(s,s.indexOf('{',pos))+')',{}, {timeout:1000})}
function arr(file,symbol){const s=scripts.find(x=>x[0]===file)[1],pos=s.indexOf(symbol);if(pos<0)throw new Error(symbol);return vm.runInNewContext('('+expression(s,s.indexOf('[',pos))+')',{}, {timeout:1000})}
if(args[0]==='objects'){
 console.log(JSON.stringify(obj('tmIeW3Ig.js','aD='),null,2));process.exit();
}
const origFetch=globalThis.fetch;
globalThis.fetch=async(u,options)=>{
 const url=new URL(u,'http://127.0.0.1:18746');
 if(url.hostname==='127.0.0.1'){
  const file=root+decodeURIComponent(url.pathname);return fs.existsSync(file)?new Response(fs.readFileSync(file)):new Response('Missing',{status:404});
 }
 return origFetch(url,options);
};
const codec=await import(pathToFileURL(base+'/dist/js/DHDvBWqu.js'));
if(args[0]==='decode'){
 for(const url of args.slice(1))try{console.log(JSON.stringify({url,data:await codec.f(url)}))}catch(e){console.log(JSON.stringify({url,error:e.message}))}
 process.exit();
}
if(args[0]==='strings'){
 for(const url of args.slice(1))try{const d=await codec.f(url),list=[];function walk(x,key){if(typeof x==='string'&&x.length<200)list.push([key,x]);else if(x&&typeof x==='object')for(const [k,v]of Object.entries(x))walk(v,k)}walk(d,'');console.log(JSON.stringify({url,keys:Object.keys(d),strings:list}));}catch(e){console.log(JSON.stringify({url,error:e.message}))}
 process.exit();
}
const candidates=new Map(),manifests=new Set(),decoded=[],pending=[],errors=[];
function add(p,source,optional=false){
 if(!p||p.includes('${')||p.includes('..')||/[\s<>]/.test(p))return;
 p=p.replace(/^https:\/\/(?:static\.)?ishoutu\.cn/,'');
 if(!p.startsWith('/'))p='/'+p;
 const old=candidates.get(p);if(old){if(!old.source.includes(source))old.source+='; '+source;if(!optional)delete old.optional;return}
 candidates.set(p,{path:p,source,...optional?{optional:true}:{}});
 if(p.endsWith('.json.enc'))manifests.add(p.slice(0,-4));
}
function enc(p,source,optional=false){add(p.endsWith('.enc')?p:p+'.enc',source,optional)}
function walk(x,callback,key=''){
 if(typeof x==='string'){callback(x,key);return}if(x&&typeof x==='object')for(const [k,v]of Object.entries(x))walk(v,callback,k);
}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(dir+'/'+e.name):[dir+'/'+e.name])}
const supportedExt=/\.(?:bin|json|png|jpg|jpeg|avif|webp|ktx2|glb|gltf|ogg|mp3|wav|wasm|woff2?)(?:\.enc)?$/i;
// Cached source includes the permission-gated skin laboratory. Its backgrounds
// are not referenced by public training or the normal local scene editor.
const excludedLiteralModules=new Set(['mxLm3KzH.js']);
for(const [name,s]of scripts){
 if(excludedLiteralModules.has(name))continue;
 for(const m of s.matchAll(/(['"])(\/[^'"\r\n\\\s]{1,200})\1/g))if(supportedExt.test(m[2]))add(m[2],`site/js/${name} literal`);
}
for(const p of files(root).filter(f=>/\/aim-(?:maps|viewmodel|weapons|agents|impact)\//.test(f)))add(p.slice(root.length),'existing cached asset');
const maps=Object.keys(obj('aQOfOAp-.js','SB='));
for(const map of maps){
 for(const ext of ['glb','collision.json','lightmaps.json','lights.json','pvs.json','surfaces.json'])enc(`/aim-maps/${map}.${ext}`,'aQOfOAp-.js map loader');
 if(['bonsai','jam','plummet','infinity'].includes(map))enc(`/aim-maps/${map}.ropes.json`,'aQOfOAp-.js rope map set');
 for(const ext of ['png','json'])add(`/aim-maps/${map}.minimap.${ext}`,'map minimap loader');
}
const agents=obj('tmIeW3Ig.js','aD=');
for(const [agent,data]of Object.entries(agents))for(const key of ['bin','albedo','ao','orm'])if(data[key])enc('/aim-agents/'+data[key],`tmIeW3Ig.js aD.${agent}.${key}`);
for(const agent of arr('B9C9f4Y8.js','ls=["astra"'))add(`/images/agent-art/${agent}.webp`,'B9C9f4Y8.js ls/vu agent art');
for(const agent of arr('B9C9f4Y8.js','Di=["jett"'))add(`/images/agent-portraits/${agent}.webp`,'B9C9f4Y8.js Di/o_ loading portraits');
for(const map of Object.values(obj('DuBWfmzx.js',"ft={'ascent'")))for(const dir of ['map-covers','map-slices'])add(`/images/${dir}/${map}.webp`,'DuBWfmzx.js ft/X/St map thumbnail mapping');
add('/images/map-splash/ascent.webp','B9C9f4Y8.js t2/va map splash');
for(const gun of ['vandal','phantom','operator','sheriff','guardian','spectre','odin'])add(`/images/gun-art/${gun}.webp`,'DCKWp-_u.js Em/$r gun artwork selectable set');
const weapons=Object.keys(obj('B51EgnC9.js','H={vandal:'));
for(const weapon of weapons.filter(n=>n!=='vandal'))for(const ext of ['json','bin'])enc(`/aim-weapons/${weapon}.${ext}`,'tmIeW3Ig.js HE weapon loader; B51EgnC9.js selectable weapons');
const render=scripts.find(s=>s[0]==='CymPR-fm.js')[1];
const stems=[...new Set([...render.matchAll(/stem:"([^"\r\n]+)"/g)].map(m=>m[1]))];
for(const stem of stems)for(const suffix of ['.json','.bin','.equip.json','.equip.bin'])enc('/aim-viewmodel/'+stem+suffix,'CymPR-fm.js weapon stem + CFqO0zvx.js loader',suffix.startsWith('.equip'));
const knifeStem=scripts.find(x=>x[0]==='CFqO0zvx.js')[1].match(/const It='([^']+)'/)[1];
for(const stem of ['ak47','jett','killjoy.detain','killjoy.device',knifeStem])for(const ext of ['json','bin'])enc(`/aim-viewmodel/${stem}.${ext}`,'CFqO0zvx.js/tmIeW3Ig.js explicit loader');
for(const p of Object.values(obj('tmIeW3Ig.js','bn={"brimstone-enemy"')))enc('/aim-viewmodel/'+p,'tmIeW3Ig.js bn smoke manifests');
const flashKeys=Object.values(obj('CymPR-fm.js','Al={reyna:'));
for(const key of flashKeys)enc(`/aim-viewmodel/flashfx.${key}.json`,'CymPR-fm.js Al/Wm flash packs');
const aiExpr=expression(render,render.indexOf('{',render.indexOf('Ai={core:')));
for(const m of aiExpr.matchAll(/tex:(\[[^\]]*\])/g)){
 for(const tex of vm.runInNewContext(m[1],{}, {timeout:1000}).filter(Boolean))enc(`/aim-viewmodel/flashfx.tex.${tex}.${['TP_Hawk_S0_DF','AB_Nox_S0_Flower_DF'].includes(tex)?'jpg':'png'}`,'CymPR-fm.js Ai flash material texture map');
}
enc('/aim-viewmodel/muzzle.5073054cbb.json','CymPR-fm.js muzzle manifest constant');
add('/aim-kernels/manifest.json','DqtmD7Xr.js replay kernel manifest');
for(const p of ['/basis/basis_transcoder.js','/basis/basis_transcoder.wasm'])add(p,'aQOfOAp-.js KTX2Loader.setTranscoderPath');
// Manifest references contain exact filenames. UE /Game paths denote packed source identities,
// not downloadable URLs; their binary data is already in the referenced pack.
for(const manifest of manifests){
 if(!fs.existsSync(root+manifest+'.enc')){pending.push(manifest+'.enc');continue}
 try{
  const d=await codec.f(manifest);decoded.push(manifest+'.enc');
  walk(d,(value,key)=>{
   if(!supportedExt.test(value)||value.startsWith('/Game/')||value.includes('://')||value.length>200)return;
   let p=value.startsWith('/')?value:path.posix.join(path.posix.dirname(manifest),value);
   let source=`decoded manifest ${manifest} field ${key}`;
   // HE decodes third-person geometry from aim-weapons, while df/vf explicitly
   // requests its manifest texture.file from aim-viewmodel. Preserve both facts.
   if(/^\/aim-weapons\/.+\.(?:png|jpg|jpeg|avif|webp)(?:\.enc)?$/i.test(p)){
    source+=` (manifest value ${JSON.stringify(value)}; tmIeW3Ig.js df/vf resolves texture in /aim-viewmodel/)`;
    p='/aim-viewmodel/'+path.posix.basename(p);
   }
   enc(p,source);
  });
 }catch(e){errors.push({path:manifest+'.enc',error:e.message})}
}
const glbReports=[];
for(const map of maps){
 const p=`/aim-maps/${map}.glb`;if(!fs.existsSync(root+p+'.enc'))continue;
 try{const b=Buffer.from(await codec.c(p)),magic=b.subarray(0,4).toString();if(magic!=='glTF')throw new Error('not GLB');const chunkLen=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+chunkLen).toString().trim());let external=0;
 for(const value of [...(g.buffers??[]),...(g.images??[])])if(value.uri&&!value.uri.startsWith('data:')){external++;enc(path.posix.join('/aim-maps/',value.uri),p+' GLB embedded JSON URI')}
 glbReports.push({map,externalUris:external,images:g.images?.length??0,buffers:g.buffers?.length??0});
 }catch(e){errors.push({path:p+'.enc',error:e.message})}
}
const kernelFile=root+'/aim-kernels/manifest.json';
if(fs.existsSync(kernelFile))try{for(const k of JSON.parse(fs.readFileSync(kernelFile,'utf8')).kernels??[])if(/^kernel-aimlab-\d+-[0-9a-f]{12}\.js$/.test(k.file))add('/aim-kernels/'+k.file,'aim-kernels/manifest.json exact file')}catch(e){errors.push({path:'/aim-kernels/manifest.json',error:e.message})}
else pending.push('/aim-kernels/manifest.json');
const output=[...candidates.values()].sort((a,b)=>a.path.localeCompare(b.path));
const absent=output.filter(x=>!fs.existsSync(root+x.path));
const report={generatedAt:new Date().toISOString(),total:output.length,existing:output.filter(x=>fs.existsSync(root+x.path)).length,missing:absent.length,missingRequired:absent.filter(x=>!x.optional),missingOptional:absent.filter(x=>x.optional),excludedLiteralModules:[...excludedLiteralModules],maps,weapons,agentCount:Object.keys(agents).length,stems,decodedManifestCount:decoded.length,pendingManifests:[...new Set(pending)].sort(),errors,glbReports,notes:['Each exact source path is backed by source literals, source loader interpolation and enumerated selectable keys, a cached asset, or a decoded manifest.','Rerun after acquiring pending manifests to recursively add their exact filenames.','Map lightmap PNG and AVIF are both enumerated: the original loader feature-detects AVIF and keeps PNG fallback.','Generic texture registry assets include effects used by all selectable flash packs, including not-yet-cached packs.','No remote downloads or browser UI performed by this script.']};
fs.writeFileSync(base+'/material-candidates.json',JSON.stringify(output,null,2));
fs.writeFileSync(base+'/material-inventory-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
