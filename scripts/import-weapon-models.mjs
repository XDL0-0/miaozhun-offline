// Import reviewed GLBs/material exports from a read-only local VALORANT export.
// The exporter is a build-time tool; the delivered trainer needs no game files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input=path.resolve(process.argv[2]??path.join(root,'qa-artifacts/val-model-tools'));
const output=path.join(root,'skin-packs/models');
const entries=JSON.parse(fs.readFileSync(path.join(input,'model-sources.json'),'utf8'));
const sourceRoot=path.join(input,'exports');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]);
const allFiles=walk(sourceRoot);
const materialFiles=new Map(allFiles.filter(f=>f.endsWith('.json')).map(f=>[path.basename(f,'.json'),f]));
const collections={'Prelude to Chaos':'prelude-to-chaos',Kuronami:'kuronami',Primordium:'primordium',Rogue:'rogue','RGX 11z Pro':'rgx-11z-pro',Ayakashi:'ayakashi',Nocturnum:'nocturnum',Mystbloom:'mystbloom','ORA by OneTap':'ora-by-onetap'};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(path.join(output,'assets'),{recursive:true});
const audit={schemaVersion:1,source:'Read-only local VALORANT installation, UE 5.3 / patch 13.08',mappingSha256:'5d97ee2942e623d2fbacd39c2214a413311b62aad681d4b31049ff6bd48bcdc4',exporter:'FabianFG/CUE4Parse',exporterCommit:'2b8901c3ee9818558ad33e2496a58d50b82e99db',models:[],assets:[]};
const written=new Set(),textures=new Map();
function store(bytes,ext,source){
  const hash=sha(bytes),name=`${hash.slice(0,24)}.${ext}`,file=path.join(output,'assets',name);
  if(!written.has(name)){fs.writeFileSync(file,bytes);written.add(name);audit.assets.push({url:'/skin-packs/models/assets/'+name,bytes:bytes.length,sha256:hash,source});}
  return '/skin-packs/models/assets/'+name;
}
function texture(ref,kind='color'){
  if(!ref?.ObjectPath)return null;
  const logical=ref.ObjectPath.replace(/^\/Game\//,'ShooterGame/Content/').replace(/\.\d+$/,'')+'.png';
  const file=path.join(sourceRoot,logical),key=logical+':'+kind;
  if(textures.has(key))return textures.get(key);
  if(!fs.existsSync(file))throw new Error('Missing required texture: '+logical);
  let filter="scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease";
  if(kind==='orm')filter+=',colorchannelmixer=rr=0:rg=0:rb=1:gr=0:gg=1:gb=0:br=1:bg=0:bb=0';
  if(kind==='emissive')filter+=',colorchannelmixer=rr=0:rg=1:rb=0:gr=0:gg=1:gb=0:br=0:bg=1:bb=0';
  const result=spawnSync(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-i',file,'-vf',filter,'-frames:v','1','-threads','1','-f','image2pipe','-c:v','png','pipe:1'],{maxBuffer:24*1024*1024,windowsHide:true});
  if(result.status!==0)throw new Error('Texture conversion failed: '+logical+' '+result.stderr);
  const url=store(result.stdout,'png',{path:logical,sha256:sha(fs.readFileSync(file)),operation:kind,maxSize:1024});
  textures.set(key,url);return url;
}
const rgb=c=>c?[c.R,c.G,c.B].map(x=>Math.max(0,Math.min(1,Number(x)||0))):[1,1,1];
function material(name){
  const file=materialFiles.get(name);if(!file)throw new Error('Missing material '+name);
  const m=JSON.parse(fs.readFileSync(file,'utf8')),t=m.Textures??{},c=m.Colors??{},s=m.Scalars??{};
  const diffuse=t.PM_Diffuse??t.Albedo;
  const glass=/glass|transparent/i.test(name),led=/LED|bakedlight/i.test(name);
  const emission=c['LED Emissive Color']??c['Emissive Color']??c['EmissiveColor'];
  const glow=t.AEM?texture(t.AEM,'emissive'):led&&diffuse?texture(diffuse):null;
  const strength=glow?Math.min(2,Math.max(0,Number(s['Weapon Emissive Intensity']??s['Emissive Intensity']??(led?.6:.35)))):0;
  return {name,map:diffuse?texture(diffuse):null,normalMap:t.PM_Normals?texture(t.PM_Normals,'normal'):null,ormMap:t.PM_SpecularMasks?texture(t.PM_SpecularMasks,'orm'):null,
    emissiveMap:glow,emissive:rgb(emission),emissiveIntensity:strength,color:diffuse?[1,1,1]:rgb(c['BG Bottom Color']??c['Base Color']??c['Color']),
    roughness:glass?.2:.58,metalness:glass?.15:.28,transparent:glass,opacity:glass?(diffuse?.35:.16):1,
    // UE-only trail/lighting volumes have no solid surface. Structural shell
    // materials are part of the real gun and must remain visible at rest.
    hidden:/LightTrails|BakedLight/i.test(name)};
}
function glb(asset,role){
  const file=path.join(sourceRoot,asset.replace(/\.uasset$/i,'.glb'));
  const bytes=fs.readFileSync(file);if(bytes.toString('ascii',0,4)!=='glTF')throw new Error('Invalid GLB '+asset);
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  for(const uri of [...(json.buffers??[]),...(json.images??[])])if(uri.uri)throw new Error('External GLB reference '+asset);
  return {role,url:store(bytes,'glb',{path:asset,sha256:sha(bytes)}),materials:(json.materials??[]).map(m=>material(m.name))};
}
const index={schemaVersion:1,models:{},counts:{weapons:0,collections:9,assets:0}};
for(const entry of entries){
  const weapon=entry.name.split(' ').at(-1).toLowerCase(),name=entry.name.slice(0,-weapon.length-1),collection=collections[name];
  if(!collection)throw new Error('Unrecognized collection '+name);
  const body=entry.models.find(p=>/Skelmesh\.uasset$/i.test(p)&&!/SniperScope/i.test(p));
  const magazine=entry.models.find(p=>/Magazine/i.test(p));
  if(!body||!magazine)throw new Error('Incomplete gun '+entry.name);
  const parts=[glb(body,'body'),glb(magazine,'magazine')];
  const sight=weapon==='operator'?entry.models.find(p=>/SniperScope.*Staticmesh/i.test(p)):entry.attachments.find(p=>/RedDot.*Staticmesh/i.test(p));
  if(sight&&weapon!=='sheriff')parts.push(glb(sight,'sight'));
  const silencer=entry.attachments.find(p=>/Silencer.*Staticmesh/i.test(p));
  if(weapon==='phantom'&&silencer)parts.push(glb(silencer,'silencer'));
  const packageData={schemaVersion:1,collection,weapon,parts};
  const relative=`${collection}/${weapon}.json`;fs.mkdirSync(path.dirname(path.join(output,relative)),{recursive:true});
  fs.writeFileSync(path.join(output,relative),JSON.stringify(packageData));
  index.models[`${collection}/${weapon}`]='/skin-packs/models/'+relative;
  audit.models.push({collection,weapon,source:entry.dir,parts:parts.map(p=>({role:p.role,url:p.url}))});
}
index.counts.weapons=Object.keys(index.models).length;index.counts.assets=written.size;
fs.writeFileSync(path.join(output,'index.json'),JSON.stringify(index,null,2));
fs.writeFileSync(path.join(root,'skin-packs/audit/weapon-model-sources.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify(index.counts));
