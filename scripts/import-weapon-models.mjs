// Import reviewed GLBs/material exports from a read-only local VALORANT export.
// The exporter is a build-time tool; the delivered trainer needs no game files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importWeaponEffects} from './import-weapon-effects.mjs';
import {resolveEffectMaterial,materialPath} from './weapon-effect-materials.mjs';
import {weaponBodyMaterial,surfacePackFilter} from './weapon-body-materials.mjs';
import {createWeaponEnvironmentImporter} from './import-weapon-environments.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input=path.resolve(process.argv[2]??path.join(root,'qa-artifacts/val-model-tools'));
const output=path.join(root,'skin-packs/models');
const entries=JSON.parse(fs.readFileSync(path.join(input,'model-sources.json'),'utf8'));
const sourceRoot=path.join(input,'exports');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]);
const allFiles=walk(sourceRoot);
const materialFiles=new Map(allFiles.filter(f=>f.endsWith('.json')).map(f=>[path.basename(f,'.json'),f]));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'skin-packs/catalog.json'),'utf8'));
const collections=Object.fromEntries(catalog.collections.map(c=>[c.name,c.id]));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(path.join(output,'assets'),{recursive:true});
const audit={schemaVersion:1,source:'Read-only local VALORANT installation, UE 5.3 / patch 13.08',mappingSha256:'5d97ee2942e623d2fbacd39c2214a413311b62aad681d4b31049ff6bd48bcdc4',exporter:'FabianFG/CUE4Parse',exporterCommit:'2b8901c3ee9818558ad33e2496a58d50b82e99db',models:[],assets:[]};
const written=new Set(),textures=new Map();
function store(bytes,ext,source){
  const hash=sha(bytes),name=`${hash.slice(0,24)}.${ext}`,file=path.join(output,'assets',name);
  if(!written.has(name)){fs.writeFileSync(file,bytes);written.add(name);audit.assets.push({url:'/skin-packs/models/assets/'+name,bytes:bytes.length,sha256:hash,source});}
  return '/skin-packs/models/assets/'+name;
}
function texture(ref,kind='color',aoRef=null){
  const source=materialPath(ref);if(!source)return null;
  const logical=source.replace(/^\/Game\//,'ShooterGame/Content/').replace(/^\/Engine\//,'Engine/Content/')+'.png';
  const aoLogical=materialPath(aoRef).replace(/^\/Game\//,'ShooterGame/Content/').replace(/^\/Engine\//,'Engine/Content/')+'.png';
  const file=path.join(sourceRoot,logical),key=logical+':'+kind+':'+(aoRef?aoLogical:'');
  if(textures.has(key))return textures.get(key);
  if(!fs.existsSync(file))throw new Error('Missing required texture: '+logical);
  const original=fs.readFileSync(file),width=original.readUInt32BE(16),height=original.readUInt32BE(20);
  let bytes=original,occlusion=null;
  if(kind==='surface'){
    const aoFile=aoRef?path.join(sourceRoot,aoLogical):null;
    const args=['-v','error','-i',file];
    if(aoFile){args.push('-i',aoFile,'-filter_complex',surfacePackFilter(width,height));occlusion={path:aoLogical,sha256:sha(fs.readFileSync(aoFile))};}
    else args.push('-vf','format=rgba,colorchannelmixer=rr=0:rg=0:rb=1:gr=0:gg=1:gb=0:br=1:bg=0:bb=0:aa=0:ab=1,lutrgb=r=255');
    const packed=spawnSync(process.env.FFMPEG_PATH??'ffmpeg',[...args,'-frames:v','1','-threads','1','-f','image2pipe','-c:v','png','pipe:1'],{maxBuffer:64*1024*1024,windowsHide:true});
    if(packed.status!==0)throw new Error('Surface packing failed: '+logical+' '+packed.stderr);
    bytes=packed.stdout;
  }
  const filter=kind==='orm'?'colorchannelmixer=rr=0:rg=0:rb=1:gr=0:gg=1:gb=0:br=1:bg=0:bb=0':kind==='emissive'?'colorchannelmixer=rr=0:rg=1:rb=0:gr=0:gg=1:gb=0:br=0:bg=1:bb=0':null;
  if(filter){
    const result=spawnSync(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-i',file,'-vf',filter,'-frames:v','1','-threads','1','-f','image2pipe','-c:v','png','pipe:1'],{maxBuffer:64*1024*1024,windowsHide:true});
    if(result.status!==0)throw new Error('Texture conversion failed: '+logical+' '+result.stderr);
    bytes=result.stdout;
  }
  if(bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height)throw new Error('Texture resolution changed: '+logical);
  const url=store(bytes,'png',{path:logical,sha256:sha(original),operation:kind,...(occlusion?{occlusion}:{}),width,height,resolution:'original'});
  textures.set(key,url);return url;
}
const rawMaterial=logical=>{const file=path.join(input,'properties',path.basename(logical)+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).find(o=>o.Package?.toLowerCase()===logical.toLowerCase()):null;};
const exportedMaterial=logical=>{const file=path.join(sourceRoot,logical.replace('/Game/','ShooterGame/Content/').replace('/Engine/','Engine/Content/')+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;};
const materialCache=new Map();audit.bodyMaterials=[];audit.materialBindings=[];
const importEnvironment=createWeaponEnvironmentImporter({sourceRoot,store,audit,repositoryRoot:root,originalDirectory:path.join(root,'skin-packs/environments/originals')});
function material(ref){
  const name=path.basename(ref);
  if(materialCache.has(name))return materialCache.get(name);
  const file=materialFiles.get(name);if(!file)throw new Error('Missing material '+name);
  const logical=path.relative(sourceRoot,file).replaceAll('\\','/').replace('ShooterGame/Content/','/Game/').replace('Engine/Content/','/Engine/').replace(/\.json$/,'');
  const data=resolveEffectMaterial(logical,rawMaterial,exportedMaterial),m=weaponBodyMaterial(name,data,texture);
  const environment=importEnvironment(name,data,m,logical);if(environment)m.environment=environment;
  materialCache.set(name,m);audit.bodyMaterials.push({name,source:logical,...m.source,features:Object.keys(m.shader)});return m;
}
function glb(asset,role,overrides){
  const file=path.join(sourceRoot,asset.replace(/\.uasset$/i,'.glb'));
  const bytes=fs.readFileSync(file);if(bytes.toString('ascii',0,4)!=='glTF')throw new Error('Invalid GLB '+asset);
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  for(const uri of [...(json.buffers??[]),...(json.images??[])])if(uri.uri)throw new Error('External GLB reference '+asset);
  if(Array.isArray(overrides))throw new Error('Material overrides must use source names, not reordered GLB indices: '+asset);
  const slots=(json.materials??[]).map((m,i)=>({slot:i,source:m.name,material:overrides?.[m.name]??m.name}));
  audit.materialBindings.push({asset,role,slots});
  return {role,url:store(bytes,'glb',{path:asset,sha256:sha(bytes)}),materials:slots.map(s=>material(s.material))};
}
const index={schemaVersion:1,models:{},variants:{},counts:{weapons:0,collections:catalog.collections.length,variants:0,assets:0}};
const motionPlans=JSON.parse(fs.readFileSync(path.join(input,'motion-plan.json'),'utf8'));
const motionCache=new Map();
function motionClip(id){
  if(motionCache.has(id))return motionCache.get(id);
  const meta=JSON.parse(fs.readFileSync(path.join(input,'motions',id+'.json'),'utf8'));
  const bytes=fs.readFileSync(path.join(input,'motions',id+'.bin'));
  if(bytes.length!==meta.names.length*meta.frames*40)throw new Error('Invalid motion length '+id);
  const url=store(gzipSync(bytes,{level:9}),'bin.gz',{path:meta.asset,target:meta.target,sha256:sha(bytes),operation:'retargeted original skeletal animation'});
  const clip={names:meta.names,rest:meta.rest,frames:meta.frames,duration:meta.duration,sampleRate:meta.sampleRate,data:url};
  motionCache.set(id,clip);return clip;
}
function motions(entry){
  const plan=motionPlans.find(p=>p.name===entry.name&&(!entry.theme||!p.theme||p.theme===entry.theme));if(!plan)throw new Error('Missing motion plan '+entry.name);
  const clips={},actions={};
  for(const [action,tracks]of Object.entries(plan.actions)){
    actions[action]={};
    for(const [role,track]of Object.entries(tracks))if(track){
      const segments=track.segments.map(s=>{const clip=motionClip(s.clip);clips[s.clip]=clip;return {...s,to:s.to??clip.duration};});
      actions[action][role]={source:track.source,segments,duration:Math.max(...segments.map(s=>s.start+(s.to-s.from)/Math.abs(s.rate)*s.loops))};
    }
  }
  return {clips,actions};
}
const effects=importWeaponEffects({input,sourceRoot,entries,texture,store,audit});
for(const entry of entries){
  const weapon=entry.weapon??entry.name.split(' ').at(-1).toLowerCase(),name=entry.name.slice(0,-weapon.length-1),collection=entry.collection??collections[name];
  if(!collection)throw new Error('Unrecognized collection '+name);
  const body=entry.body??entry.models.find(p=>/Skelmesh\.uasset$/i.test(p)&&!/SniperScope/i.test(p));
  const magazine=entry.models.find(p=>/Magazine/i.test(p));
  if(!body||weapon!=='melee'&&!magazine)throw new Error('Incomplete weapon '+entry.name);
  const parts=[glb(body,'body',entry.bodyMaterials??entry.materialOverrides?.body)];
  if(magazine)parts.push(glb(magazine,'magazine',entry.magazineMaterials));
  const sight=weapon==='operator'?entry.models.find(p=>/SniperScope.*Staticmesh/i.test(p)):(entry.attachments??[]).find(p=>/RedDot.*Staticmesh/i.test(p));
  if(sight&&weapon!=='sheriff')parts.push(glb(sight,'sight',entry.sightMaterials));
  const silencer=(entry.attachments??[]).find(p=>/Silencer.*Staticmesh/i.test(p));
  if(weapon==='phantom'&&silencer)parts.push(glb(silencer,'silencer',entry.silencerMaterials));
  const fire=effects.packages.get(entry.name),baseKey=`${collection}/${weapon}`,key=baseKey+(entry.theme?'/'+entry.theme:'');
  if(weapon!=='melee'&&!fire?.hip.length)throw new Error('Missing skin muzzle effects '+entry.name);
  if(fire)effects.result.guns[key]=fire;
  if(fire)effects.result.guns[baseKey]??=fire;
  const packageData={schemaVersion:1,collection,weapon,...(entry.theme?{theme:entry.theme}:{}),parts,motions:motions(entry),effects:{textures:fire?effects.urls(fire):[]},...(entry.attachment?{attachment:entry.attachment}:{})};
  const relative=`${collection}/${weapon}${entry.theme?'-'+entry.theme:''}.json`;fs.mkdirSync(path.dirname(path.join(output,relative)),{recursive:true});
  fs.writeFileSync(path.join(output,relative),JSON.stringify(packageData));
  const url='/skin-packs/models/'+relative;
  index.models[baseKey]??=url;
  if(entry.theme)(index.variants[baseKey]??={})[entry.theme]=url;
  audit.models.push({collection,weapon,...(entry.theme?{theme:entry.theme}:{}),source:entry.dir,parts:parts.map(p=>({role:p.role,url:p.url}))});
}
index.counts.weapons=Object.keys(index.models).length;index.counts.assets=written.size;
index.counts.variants=Object.values(index.variants).reduce((n,v)=>n+Object.keys(v).length,0);
fs.writeFileSync(path.join(output,'index.json'),JSON.stringify(index,null,2));
fs.writeFileSync(path.join(output,'fire-effects.json'),JSON.stringify(effects.result));
fs.writeFileSync(path.join(root,'skin-packs/audit/weapon-model-sources.json'),JSON.stringify(audit,null,2));
// Remove only generated, content-addressed assets superseded by this import.
for(const name of fs.readdirSync(path.join(output,'assets')))if(/^[a-f0-9]{24}\.(?:glb|png|bin\.gz)$/.test(name)&&!written.has(name))fs.unlinkSync(path.join(output,'assets',name));
console.log(JSON.stringify(index.counts));
