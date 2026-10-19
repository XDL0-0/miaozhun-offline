// Verify the delivered local package, without contacting the network or opening a browser.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inventoryFonts} from './verify-font-inventory.mjs';
import {decodeWeaponGlb} from './patches/weapon-models-runtime.mjs';

const packageRoot=path.dirname(fileURLToPath(import.meta.url));
const arg=process.argv.find(x=>x.startsWith('--root='));
const root=arg?path.resolve(arg.slice(7)):path.join(packageRoot,'dist');
const reportFile=path.join(packageRoot,'verification.json');
const baseUrl='http://127.0.0.1:18746';
const maps=['ascent','bonsai','triad','plummet','jam','infinity'];
const expectedSceneCount=62;
const weapons=new Set(['vandal','phantom','classic','sheriff','spectre','ares','operator','ghost','odin','frenzy','guardian','marshal','outlaw','bulldog','stinger','judge','shorty','bucky','melee']);
const failures=[],ignored=[],aliases=[],alternatives=[];
const missingMap=new Map(),requirements=new Map(),decrypted=new Map();
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const walkFiles=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walkFiles(path.join(dir,d.name)):[path.join(dir,d.name)]);
const rel=file=>'/'+path.relative(root,file).replaceAll('\\','/');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const has=p=>fs.existsSync(path.join(root,p.replace(/^\//,'')))&&fs.statSync(path.join(root,p.replace(/^\//,''))).isFile();
function normalize(p){
 let decoded;try{decoded=decodeURIComponent(String(p))}catch{decoded=String(p)}
 if(decoded.startsWith('data:')||decoded.startsWith('blob:')||decoded.startsWith('#')||path.posix.basename(decoded).startsWith('#'))return null;
 if(/^https?:\/\//.test(decoded)){
  const u=new URL(decoded);if(!['ishoutu.cn','static.ishoutu.cn','127.0.0.1','localhost'].includes(u.hostname))return null;decoded=u.pathname;
 }
 decoded=decoded.replaceAll('\\','/').split('?')[0].split('#')[0];
 const p2='/'+decoded.replace(/^\//,'');
 if(p2.split('/').includes('..'))throw new Error('Path escapes package root: '+p);
 return p2;
}
function existing(p){
 if(has(p))return p;
 // Original HE/df/vf weapon loader explicitly loads 3P gun textures from /aim-viewmodel/.
 if(/^\/aim-weapons\/[^/]+\.(?:png|jpe?g|avif|webp)(?:\.enc)?$/i.test(p)){
  const target=p.replace('/aim-weapons/','/aim-viewmodel/');if(has(target))return target;
  if(!target.endsWith('.enc')&&has(target+'.enc'))return target+'.enc';
 }
 if(!p.endsWith('.enc')&&has(p+'.enc'))return p+'.enc';
 return null;
}
function requireAsset(p,source,optional=false){
 const original=p;p=normalize(p);if(!p){ignored.push({path:original,source,reason:'embedded URI or CSS SVG fragment'});return}
 let target=p;
 if(/^\/aim-weapons\/[^/]+\.(?:png|jpe?g|avif|webp)(?:\.enc)?$/i.test(p))target=p.replace('/aim-weapons/','/aim-viewmodel/');
 // These public loaders always request .enc, except the plain minimap metadata/image.
 if(/^\/aim-(?:weapons|viewmodel|agents|maps)\//.test(target)&&!target.endsWith('.enc')&&!has(target)&&!/\.minimap\.(?:json|png)$/.test(target))target+='.enc';
 const prior=requirements.get(target);
 if(prior){prior.sources.add(source);prior.requestedPaths.add(p);if(!optional)prior.optional=false;return}
 requirements.set(target,{path:target,requestedPaths:new Set([p]),sources:new Set([source]),optional});
}
function walkValues(x,fn,key=''){
 if(typeof x==='string'){fn(x,key);return}if(x&&typeof x==='object')for(const[k,v]of Object.entries(x))walkValues(v,fn,k);
}
const files=walkFiles(root).sort();
// The existing, locally patched public-format codec is used unchanged.
// Relative fetches are fulfilled from dist; an unexpected external request fails closed.
globalThis.fetch=async url=>{
 const u=new URL(url,baseUrl);if(!['127.0.0.1','localhost'].includes(u.hostname))throw new Error('Verifier blocked external URL: '+u.hostname);
 const p=normalize(u.pathname),file=p?path.join(root,p.slice(1)):'';
 return file&&has(p)?new Response(fs.readFileSync(file),{status:200}):new Response('Missing',{status:404});
};
const codec=await import(pathToFileURL(path.join(root,'js/DHDvBWqu.js')).href);
const resources=[];
let encrypted=0,jsonCount=0;
const glbModels=[];
for(const file of files){
 const p=rel(file),stored=fs.readFileSync(file),entry={path:p,bytes:stored.byteLength,sha256:sha256(stored)};
 if(p.endsWith('.enc')){
  try{
   const plain=p.slice(0,-4),body=Buffer.from(await codec.c(plain));
   encrypted++;entry.decryptedBytes=body.length;entry.decryptedSha256=sha256(body);
   if(body.length===0)throw new Error('Decoded asset is empty');
   if(plain.endsWith('.json')){
    const data=JSON.parse(body.toString('utf8'));decrypted.set(plain,data);jsonCount++;
    if(!object(data)&&!Array.isArray(data))throw new Error('JSON asset is not an object or array');
   }else if(plain.endsWith('.glb')){
    if(body.subarray(0,4).toString()!=='glTF'||body.readUInt32LE(4)!==2||body.readUInt32LE(8)!==body.length)throw new Error('Invalid GLB magic/version/declared length');
    let at=12,gltf=null;while(at<body.length){const n=body.readUInt32LE(at),type=body.readUInt32LE(at+4);if(at+8+n>body.length)throw new Error('Truncated GLB chunk');if(type===0x4e4f534a)gltf=JSON.parse(body.subarray(at+8,at+8+n).toString('utf8').trim());at+=8+n}
    if(at!==body.length||!gltf)throw new Error('Invalid GLB chunk boundaries or missing JSON');
    let externalUris=0;for(const v of [...(gltf.buffers??[]),...(gltf.images??[])])if(v.uri&&!v.uri.startsWith('data:')){externalUris++;requireAsset(path.posix.join(path.posix.dirname(plain),v.uri),plain+' GLB URI')}
    glbModels.push({path:plain,bytes:body.length,images:gltf.images?.length??0,externalUris});
   }else if(/\.png$/i.test(plain)&&!body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid decoded PNG signature');
   else if(/\.jpe?g$/i.test(plain)&&!(body[0]===255&&body[1]===216&&body[2]===255))throw new Error('Invalid decoded JPEG signature');
   else if(/\.avif$/i.test(plain)&&!(body.subarray(4,8).toString()==='ftyp'&&body.subarray(8,40).toString().includes('avif')))throw new Error('Invalid decoded AVIF signature');
   entry.integrity='decoded and authenticated';
  }catch(error){entry.integrity='failed';failures.push({path:p,stage:'encrypted resource integrity',error:error.message})}
 }else if(/\.woff2?$/.test(p)){
  const expected=p.endsWith('.woff2')?'wOF2':'wOFF';
  if(stored.subarray(0,4).toString()!==expected)failures.push({path:p,stage:'font integrity',error:'Invalid '+expected+' signature'});
 }else if(/\.(?:mjs|js)$/.test(p)){
  const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
  if(syntax.status!==0)failures.push({path:p,stage:'JavaScript syntax',error:(syntax.stderr||syntax.error?.message||'JavaScript parser failed').slice(0,1200)});
 }
 resources.push(entry);
}
// The skin manifest is the source of runtime availability, including partial
// themes. Every advertised URL must be playable/decodable local media.
let skinPacks=null;
if(has('/skin-packs/index.json')){
 try{
  const manifest=readJson(path.join(root,'skin-packs/index.json'));
  if(manifest.schemaVersion!==2)throw new Error('Unsupported skin manifest version');
  const counts={audio:0,killAudio:0,successiveAudio:0,banners:0,layeredBanners:0,bannerLayers:0,fire:0,missingFire:0,eligibleFireCombinations:0},layerUrls=new Set();
  function skinAsset(url,kind){
   if(typeof url!=='string'||!/^\/skin-packs\/[a-z0-9/-]+\.(?:ogg|png)$/.test(url))throw new Error('Unsafe skin asset URL');
   requireAsset(url,'skin pack '+kind);
   if(!has(url))return;
   const bytes=fs.readFileSync(path.join(root,url.slice(1)));
   if(kind==='banner-layer'){
    if(bytes.length<26||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(16)>1024||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(20)>1024)throw new Error('Invalid native-size skin banner layer: '+url);
   }else if(kind==='banner'){
    if(bytes.length<26||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==300||bytes.readUInt32BE(20)!==300||bytes[25]!==6)throw new Error('Invalid normalized RGBA skin banner: '+url);
   }else if(bytes.subarray(0,4).toString()!=='OggS')throw new Error('Invalid Ogg skin audio: '+url);
  }
  for(const collection of manifest.collections)for(const theme of collection.themes){
   for(const weapon of collection.weapons){counts.eligibleFireCombinations++;if(theme.fire[weapon]){skinAsset(theme.fire[weapon],'fire');counts.fire++;counts.audio++}else counts.missingFire++}
   for(const url of Object.values(theme.kills)){skinAsset(url,'kill');counts.audio++;counts.killAudio++}
   if(theme.successive){skinAsset(theme.successive,'successive');counts.audio++;counts.successiveAudio++}
   for(const banner of theme.banners){
    skinAsset(banner.url,'banner');counts.banners++;
    if(banner.layers){
     if(!['frame','ring','emblem','pip'].every(layer=>banner.layers[layer])||!(banner.pipRadius>0&&banner.pipRadius<=150)||!Array.isArray(banner.headshotOffset)||banner.headshotOffset.length!==2||banner.headshotOffset.some(value=>!Number.isFinite(value)||Math.abs(value)>150))throw new Error('Invalid skin banner geometry');
     for(const url of [...Object.values(banner.layers),banner.headshot].filter(Boolean)){skinAsset(url,'banner-layer');layerUrls.add(url)}
     if(banner.pipSprite){
      const {source,size}=banner.pipSprite,pip=has(banner.layers.pip)?fs.readFileSync(path.join(root,banner.layers.pip.slice(1))):null;
      if(!Array.isArray(source)||source.length!==4||source.some(value=>!Number.isInteger(value))||source[0]<0||source[1]<0||source[2]<=0||source[3]<=0||!Array.isArray(size)||size.length!==2||size.some(value=>!Number.isFinite(value)||value<=0||value>150)||pip&&(source[0]+source[2]>pip.readUInt32BE(16)||source[1]+source[3]>pip.readUInt32BE(20)))throw new Error('Invalid skin pip sprite geometry');
     }
     counts.layeredBanners++;
    }
   }
  }
  counts.bannerLayers=layerUrls.size;
  for(const [key,value]of Object.entries(counts))if(manifest.counts[key]!==value)throw new Error('Skin manifest count mismatch: '+key);
  skinPacks={resourceStatus:manifest.resourceStatus,...counts};
 }catch(error){failures.push({path:'/skin-packs/index.json',stage:'skin pack integrity',error:error.message})}
}
// Weapon appearances are ordinary local GLBs/PNGs, independent of the encrypted
// default models. Verify every material/attachment before certifying offline use.
try{
 const indexPath='/skin-packs/models/index.json';requireAsset(indexPath,'weapon model catalogue');
 const index=readJson(path.join(root,indexPath.slice(1))),seen=new Set();
 if(index.schemaVersion!==1||Object.keys(index.models??{}).length!==14)throw new Error('Incomplete weapon model catalogue');
 const safe=url=>typeof url==='string'&&/^\/skin-packs\/models\/[a-z0-9/-]+\.(?:json|png|glb)$/.test(url);
 for(const [key,url]of Object.entries(index.models)){
  if(!safe(url))throw new Error('Invalid weapon model package path');requireAsset(url,indexPath);
  const pack=readJson(path.join(root,url.slice(1)));
  if(pack.schemaVersion!==1||key!==pack.collection+'/'+pack.weapon||pack.parts.filter(p=>p.role==='body').length!==1||pack.parts.filter(p=>p.role==='magazine').length!==1)throw new Error('Incomplete weapon model '+key);
  for(const part of pack.parts){
   if(!safe(part.url))throw new Error('Invalid weapon GLB path');requireAsset(part.url,key+' '+part.role);seen.add(part.url);
   const bytes=fs.readFileSync(path.join(root,part.url.slice(1))),decoded=decodeWeaponGlb(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
   if(decoded.primitives.some(p=>p.material>=part.materials.length||!p.position.every(Number.isFinite)))throw new Error('Invalid weapon geometry '+key);
   for(const mat of part.materials)for(const field of ['map','normalMap','ormMap','emissiveMap']){
    const texture=mat[field];if(!texture)continue;if(!safe(texture))throw new Error('Invalid weapon texture path');requireAsset(texture,key+' '+mat.name);seen.add(texture);
    const png=fs.readFileSync(path.join(root,texture.slice(1)));
    if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)>1024||png.readUInt32BE(20)>1024)throw new Error('Invalid weapon texture '+texture);
   }
  }
 }
 if(index.counts.assets!==seen.size)throw new Error('Weapon model asset count mismatch');
 if(skinPacks)skinPacks.weaponModels={...index.counts};
}catch(error){failures.push({path:'/skin-packs/models/index.json',stage:'weapon model integrity',error:error.message})}
// Expand every decoded manifest. Packed /Game identities are metadata, not URLs.
for(const [p,data]of decrypted){
 walkValues(data,(v,key)=>{
  if(v.length>200||v.startsWith('/Game/')||!/(?:^|\/)[A-Za-z0-9_.-]+\.(?:bin|json|png|jpe?g|avif|webp|ktx2|gltf|glb|ogg|wav|mp3)(?:\.enc)?$/i.test(v))return;
  const target=v.startsWith('/')?v:path.posix.join(path.posix.dirname(p),v);
  requireAsset(target,p+' manifest field '+key);
 });
}
// A complete AVIF or PNG pair satisfies a lightmap atlas. The original loader
// chooses AVIF on this Edge runtime and retains PNG as a compatibility fallback.
const lightmapAlternatives=new Map();
for(const [p,data]of decrypted)if(p.endsWith('.lightmaps.json'))for(const [atlasId,atlas]of Object.entries(data.atlases??{})){
 const groups=[{format:'png',files:[atlas.irr,atlas.sh]},{format:'avif',files:[atlas.avif?.irr,atlas.avif?.sh]}]
  .filter(g=>g.files.every(v=>typeof v==='string')).map(g=>({...g,files:g.files.map(v=>path.posix.join(path.posix.dirname(p),v)),complete:g.files.every(v=>!!existing(path.posix.join(path.posix.dirname(p),v)))}));
 const satisfied=groups.some(g=>g.complete),info={manifest:p,atlas:atlasId,satisfied,formats:groups};alternatives.push(info);
 for(const g of groups)for(const variant of g.files){lightmapAlternatives.set(variant,info);lightmapAlternatives.set(variant+'.enc',info)}
 if(!satisfied)failures.push({path:p,stage:'map lightmap integrity',error:'No complete PNG or AVIF atlas pair: '+atlasId});
}
const materialFile=path.join(packageRoot,'material-candidates.json');
const materials=fs.existsSync(materialFile)?readJson(materialFile):[];
if(!materials.length)failures.push({stage:'inventory',error:'material-candidates.json is missing or empty'});
const moduleReportFile=path.join(packageRoot,'module-analysis-report.json');
const moduleCandidatesFile=path.join(packageRoot,'module-candidates.json');
const moduleReport=fs.existsSync(moduleReportFile)?readJson(moduleReportFile):{};
const moduleCandidates=fs.existsSync(moduleCandidatesFile)?readJson(moduleCandidatesFile):[];
const fontInventory=inventoryFonts(root);
const fontAssetPaths=new Set(fontInventory.candidates.map(x=>x.path));
const fontGroups=new Map(fontInventory.report.allGroups.map(x=>[x.id,x]));
const excludedOwners=new Set((moduleReport.excluded??[]).map(x=>x.path.replace(/^\//,'')));
for(const item of materials){
 if(fontAssetPaths.has(normalize(item.path)))continue;
 const owners=[...String(item.source).matchAll(/(?:site\/)?(js\/[A-Za-z0-9_.-]+\.js)/g)].map(m=>m[1]);
 // The material scan sees cached unrelated modules too. Only assets referenced
 // exclusively by a documented excluded module are outside the public aim closure.
 if(owners.length&&owners.every(p=>excludedOwners.has(p))&&String(item.source).split(';').every(s=>/site\/js\/[A-Za-z0-9_.-]+\.js literal/.test(s))){
  ignored.push({path:item.path,source:item.source,reason:'Referenced exclusively by a documented excluded online or permission-gated module'});continue;
 }
 requireAsset(item.path,'material inventory: '+item.source,!!item.optional);
}
const moduleItems=[...(moduleReport.all??[]),...moduleCandidates];
if(!moduleItems.length)failures.push({stage:'inventory',error:'Module inventory is missing or empty'});
for(const item of moduleItems)if(!fontAssetPaths.has(normalize(item.path)))requireAsset(item.path,'module inventory: '+item.source,!!item.optional);
for(const item of fontInventory.candidates){
 // When the preferred format is absent but another src encoding is available,
 // the font face still loads locally; retain the absent variant as optional.
 const alternateAvailable=!has(item.path)&&item.groups.every(id=>fontGroups.get(id)?.satisfied);
 requireAsset(item.path,'font inventory: '+item.source,!!item.optional||alternateAvailable);
}
const moduleExclusions=new Set((moduleReport.excluded??[]).map(x=>normalize(x.path)));
const modulePaths=new Set([...(moduleReport.all??moduleCandidates),...materials.filter(x=>x.path.endsWith('.js'))].map(x=>normalize(x.path)).filter(Boolean));
for(const p of modulePaths){
 if(!has(p))continue;const source=fs.readFileSync(path.join(root,p.slice(1)),'utf8');
 if(p.endsWith('.js')){
  for(const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*)(['"])(\.\.?\/[^'"]+)\1/g))requireAsset(path.posix.join(path.posix.dirname(p),m[2]),p+' static import');
  // index owns the whole site's routes; auth's dynamic routes are unrelated to training.
  if(!['/js/index.C6F_bJRd.js','/js/CdryQ4Mo.js'].includes(p))for(const m of source.matchAll(/import\((['"])(\.\.?\/[^'"]+)\1\)/g)){
   const target=path.posix.join(path.posix.dirname(p),m[2]);if(!moduleExclusions.has(target))requireAsset(target,p+' dynamic import');
  }
 }else if(p.endsWith('.css'))for(const m of source.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)){
  const v=m[1];if(v.startsWith('#')||v.includes(':'))continue;
  const target=v.startsWith('/')?v:path.posix.join(path.posix.dirname(p),v);
  if(!fontAssetPaths.has(normalize(target)))requireAsset(target,p+' CSS URL');
 }
}
const mapReports=[];
for(const map of maps){
 const required=['glb','collision.json','lightmaps.json','lights.json','pvs.json','surfaces.json'];
 if(['bonsai','jam','plummet','infinity'].includes(map))required.push('ropes.json');
 const paths=required.map(ext=>`/aim-maps/${map}.${ext}.enc`);
 paths.push(`/aim-maps/${map}.minimap.json`,`/aim-maps/${map}.minimap.png`);
 for(const p of paths)requireAsset(p,'complete map '+map);
 const model=glbModels.find(x=>x.path===`/aim-maps/${map}.glb`);
 const manifestKeys={};for(const ext of required.filter(x=>x.endsWith('.json'))){const d=decrypted.get(`/aim-maps/${map}.${ext}`);if(d)manifestKeys[ext]=Object.keys(d)}
 mapReports.push({map,requiredFiles:paths,complete:paths.every(p=>!!existing(p)),model:model??null,manifestKeys});
 if(!model)failures.push({path:`/aim-maps/${map}.glb.enc`,stage:'map integrity',error:'Map GLB not decoded successfully'});
}
const scenes=[],sceneBase='/prod-api/api/v1/public/val/aimlab';
let sourceCodes=[],catalogue=[];
try{
 const siteCatalogueFile=path.join(packageRoot,'site'+sceneBase+'/workshop');
 const source=fs.existsSync(siteCatalogueFile)?readJson(siteCatalogueFile):null;
 sourceCodes=(source?.data??[]).map(x=>x.shareCode);
 const body=readJson(path.join(root,sceneBase+'/workshop'));catalogue=body.data;
 if(!Array.isArray(catalogue))throw new Error('Catalogue data is not an array');
 if(catalogue.length!==expectedSceneCount)throw new Error(`Expected ${expectedSceneCount} scenes, found ${catalogue.length}`);
 if(new Set(catalogue.map(x=>x.shareCode)).size!==catalogue.length)throw new Error('Duplicate scene share codes');
 const absent=sourceCodes.filter(c=>!catalogue.some(x=>x.shareCode===c));if(absent.length)throw new Error('Source scenes omitted: '+absent.join(','));
}catch(error){failures.push({stage:'scene catalogue',error:error.message})}
for(const scene of catalogue){
 const p=sceneBase+'/scenes/'+scene.shareCode,checks=[];
 try{
  const data=readJson(path.join(root,p)).data;
  if(!data||typeof data.doc!=='string')throw new Error('Missing serialized scene document');
  const doc=JSON.parse(data.doc),bytes=Buffer.byteLength(data.doc);
  if(!object(doc.rules)||!object(doc.environment))throw new Error('Missing scene rules or environment');checks.push('rules and environment');
  if(!Number.isFinite(doc.rules.duration)||doc.rules.duration<=0)throw new Error('Invalid rules duration');
  if(!weapons.has(doc.rules.weapon))throw new Error('Unknown weapon: '+doc.rules.weapon);
  if(typeof doc.rules.scoring!=='string'||!doc.rules.scoring)throw new Error('Missing scoring rule');checks.push('duration, weapon and scoring rules');
  if(doc.environment.map&&!maps.includes(doc.environment.map))throw new Error('Unavailable scene map: '+doc.environment.map);
  if(!Array.isArray(doc.blocks)||!Array.isArray(doc.actors)||!Array.isArray(doc.spawners))throw new Error('Invalid blocks/actors/spawners');
  if(!object(doc.playerSpawn?.position)||!['x','y','z'].every(k=>Number.isFinite(doc.playerSpawn.position[k]))||!Number.isFinite(doc.playerSpawn.yaw))throw new Error('Invalid player spawn');checks.push('scene geometry, actor lists and spawn');
  if(Number.isFinite(data.docBytes)&&data.docBytes!==bytes)throw new Error(`Document byte count mismatch: ${bytes} vs ${data.docBytes}`);checks.push('document bytes');
  const originalFile=path.join(packageRoot,'site'+p);if(fs.existsSync(originalFile)){
   const original=readJson(originalFile).data;if(sha256(original.doc)!==sha256(data.doc))throw new Error('Saved scene document differs from acquired source');checks.push('source document SHA256 equality');
  }
  scenes.push({code:scene.shareCode,name:scene.name,map:doc.environment.map??null,weapon:doc.rules.weapon,duration:doc.rules.duration,docBytes:bytes,docSha256:sha256(data.doc),actors:doc.actors.length,blocks:doc.blocks.length,checks});
 }catch(error){failures.push({path:p,scene:scene.shareCode,stage:'scene rules',error:error.message})}
}
const satisfied=[];
for(const req of requirements.values()){
 const found=existing(req.path),alt=lightmapAlternatives.get(req.path);
 if(found){
  satisfied.push(req.path);
  for(const requested of req.requestedPaths)if(found!==requested&&!(found===requested+'.enc'))aliases.push({requested,resolved:found,reason:requested.startsWith('/aim-weapons/')?'original weapon texture loader uses /aim-viewmodel/':'encoded package variant'});
 }else if(alt?.satisfied){satisfied.push(req.path)}
 else{
  const item={path:req.path,optional:req.optional,sources:[...req.sources],requestedPaths:[...req.requestedPaths]};
  missingMap.set(req.path,item);
 }
}
const missing=[...missingMap.values()].sort((a,b)=>a.path.localeCompare(b.path));
let localization=null;
try{
 const manifest=readJson(path.join(root,'offline-manifest.json'));
 localization=readJson(path.join(root,'localization-report.json'));
 if(manifest.version<4||manifest.defaultLanguage!=='zh-CN'||JSON.stringify(manifest.languages)!==JSON.stringify(['zh-CN','en']))throw new Error('Bilingual application manifest is missing');
 if(localization.schemaVersion!==1||!Array.isArray(localization.missing)||localization.missing.length)throw new Error('Localization coverage is incomplete');
 if(maps.some(map=>!Number.isInteger(localization.minimapCallouts?.[map])||localization.minimapCallouts[map]<=0))throw new Error('English minimap coverage is incomplete');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),i18nAt=html.indexOf('src="/offline-i18n.js"'),runtimeAt=html.indexOf('src="/offline-runtime.js"'),clientAt=html.indexOf('src="/js/index.');
 if(i18nAt<0||i18nAt>=runtimeAt||runtimeAt>=clientAt||!has('/offline-i18n.js'))throw new Error('Language runtime must load before offline adaptation and client modules');
}catch(error){failures.push({stage:'localization integrity',error:error.message})}
const requiredMissing=missing.filter(x=>!x.optional),optionalMissing=missing.filter(x=>x.optional);
const resourceManifest={schemaVersion:1,algorithm:'SHA256',root:'dist',createdAt:new Date().toISOString(),fileCount:resources.length,storedBytes:resources.reduce((sum,x)=>sum+x.bytes,0),encryptedAssets:encrypted,resources};
const hashFile=path.join(packageRoot,'verification-resources.sha256.json');
fs.writeFileSync(hashFile,JSON.stringify(resourceManifest,null,2));
fs.writeFileSync(path.join(packageRoot,'verification-resources.sha256.txt'),resources.map(x=>`${x.sha256}  dist${x.path}`).join('\n')+'\n');
const result={schemaVersion:2,generatedAt:new Date().toISOString(),root,success:failures.length===0&&requiredMissing.length===0&&scenes.length===expectedSceneCount,
 scope:'Acquired public local training, map scenes and local editor resources. Account, rankings, course content, cloud publishing and permission-gated skin lab are outside offline runtime.',
 checks:{network:'No network used: fetch reads dist only and blocks external hosts',encryptedFormat:'Every .enc file authenticated, decrypted and decompressed with the current original-format codec',sceneCount:expectedSceneCount,mapCount:maps.length},
 resourceCount:resources.length,storedBytes:resourceManifest.storedBytes,encryptedResources:encrypted,jsonResources:jsonCount,
 inventory:{materialCandidates:materials.length,moduleCandidates:moduleCandidates.length,moduleClosureEntries:moduleReport.all?.length??moduleCandidates.length,uniqueRequirements:requirements.size,satisfied:satisfied.length,moduleExclusions:moduleReport.excluded??[]},
 scenes:scenes.length,sceneDetails:scenes,maps:mapReports,skinPacks,localization,fonts:{files:fontInventory.report.files,cachedFiles:fontInventory.report.cachedFiles,groups:fontInventory.report.groups,satisfiedGroups:fontInventory.report.satisfiedGroups,missingGroups:fontInventory.report.missingGroups,byFamily:fontInventory.report.byFamily,excluded:fontInventory.report.excluded},missingRequiredAssets:requiredMissing,missingOptionalAssets:optionalMissing,aliases,alternativeGroups:alternatives,ignoredReferences:ignored,failures,
 sha256Manifest:{file:path.basename(hashFile),sha256:sha256(fs.readFileSync(hashFile)),fileCount:resources.length},
 limitations:['Static/resource integrity validation does not prove every interactive training mode; the separate browser smoke test covers rendering and input.','A lightmap atlas is considered present when either complete PNG or complete AVIF pair exists; Edge supports the saved AVIF assets.']};
fs.writeFileSync(reportFile,JSON.stringify(result,null,2));
console.log(JSON.stringify({success:result.success,resourceCount:result.resourceCount,encryptedResources:encrypted,jsonResources:jsonCount,scenes:scenes.length,maps:mapReports.filter(x=>x.complete).length,skinPacks,fonts:result.fonts,requiredMissingCount:requiredMissing.length,requiredMissing:requiredMissing.map(x=>x.path).slice(0,30),optionalMissingCount:optionalMissing.length,optionalMissing:optionalMissing.map(x=>x.path).slice(0,10),failures,report:reportFile,sha256Manifest:hashFile},null,2));
if(!result.success)process.exitCode=1;
