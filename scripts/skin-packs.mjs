import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildSkinPacks} from './build-skin-packs.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export const catalog=readJSON(path.join(projectRoot,'skin-packs','catalog.json'));
export const destinationRoot=path.join(projectRoot,'dist','skin-packs');
const reviewAt=root=>readJSON(path.join(root,'skin-packs','asset-review.json'));

export function validateCatalog(value=catalog){
  const ids=new Set();
  for(const collection of value.collections){
    if(!/^[a-z0-9-]+$/.test(collection.id)||ids.has(collection.id))throw new Error('Invalid/duplicate collection id: '+collection.id);
    ids.add(collection.id);
    if(!collection.weapons.length||!collection.themes.length)throw new Error('Empty weapon/theme list: '+collection.id);
    for(const part of [...collection.weapons,...collection.themes])if(!/^[a-z0-9-]+$/.test(part))throw new Error('Unsafe segment: '+part);
  }
  return true;
}

/** Logical capabilities and their actual reviewed inputs; absent sources have no invented filename. */
export function requiredAssets(collection,review=reviewAt(projectRoot)){
  const assets=[];
  const add=(kind,theme,id,entry,weapon)=>assets.push({kind,theme,id,...(weapon?{weapon}:{}),source:entry?.path??null,sha256:entry?.sha256??null});
  for(const theme of collection.themes){
    const matching=entries=>(entries??[]).filter(entry=>entry.collection===collection.id&&entry.theme===theme);
    const audio=matching(review.audio),banners=matching(review.banners),fire=matching(review.fire);
    for(const weapon of collection.weapons)add('fire',theme,'fire:'+weapon,fire.find(entry=>entry.weapon===weapon),weapon);
    for(let n=1;n<=5;n++)add('kill',theme,'kill:'+n,audio.find(entry=>entry.role==='kill'&&entry.id===String(n)));
    // Ayakashi's sixth clip is retained for audition, outside the game's 1–5 cycle.
    for(const entry of audio.filter(entry=>entry.role==='kill'&&Number(entry.id)>5))add('kill',theme,'kill:'+entry.id,entry);
    add('successive',theme,'successive',audio.find(entry=>entry.role==='successive'));
    if(banners.length)for(const entry of banners)add('banner',theme,'banner:'+entry.id,entry);
    else add('banner',theme,'banner',null);
  }
  return assets;
}

function inspectSource(root,asset){
  if(!asset.source)return 'not-reviewed';
  if(!/^skin-packs\/media\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(asset.source)
    ||asset.source.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(asset.sha256??''))return 'invalid-review';
  const filename=path.join(root,...asset.source.split('/'));
  if(!fs.existsSync(filename))return 'missing-file';
  if(!fs.statSync(filename).isFile())return 'invalid-file';
  const mediaRoot=fs.realpathSync(path.join(root,'skin-packs','media'))+path.sep;
  if(!fs.realpathSync(filename).startsWith(mediaRoot))return 'invalid-file';
  const hash=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  return hash===asset.sha256?'present':'hash-mismatch';
}

export function auditPack(collection,{root=projectRoot,review=reviewAt(root)}={}){
  const assets=requiredAssets(collection,review).map(asset=>({...asset,status:inspectSource(root,asset)}));
  const missing=assets.filter(asset=>asset.status!=='present');
  const present=assets.length-missing.length;
  return {id:collection.id,sourceStatus:missing.length?(present?'partial':'missing'):'complete',
    present,expected:assets.length,complete:missing.length===0,
    missing:missing.map(({theme,id,status,source})=>({theme,id,status,source})),assets};
}

export function audit({root=projectRoot}={}){
  const value=readJSON(path.join(root,'skin-packs','catalog.json')),review=reviewAt(root);
  validateCatalog(value);
  return value.collections.map(collection=>auditPack(collection,{root,review}));
}

/** Compatibility command: print the review inventory without creating obsolete local input folders. */
export function scaffold({root=projectRoot}={}){
  const value=readJSON(path.join(root,'skin-packs','catalog.json')),review=reviewAt(root);
  validateCatalog(value);
  return value.collections.map(collection=>({id:collection.id,assets:requiredAssets(collection,review)}));
}

/** The same schema-2 builder used by prepare-offline; incomplete themes remain usable. */
export function stage(options={}){
  return buildSkinPacks(options);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const choice=process.argv[2]??'--audit';
  if(!['--scaffold','--audit','--stage'].includes(choice)){
    console.error('Usage: node scripts/skin-packs.mjs [--scaffold|--audit|--stage]');
    process.exitCode=2;
  }else{
    try{
      if(choice==='--stage'){
        const manifest=stage();
        console.log(JSON.stringify({action:choice,schemaVersion:manifest.schemaVersion,stageStatus:manifest.resourceStatus,
          integration:'not-checked',counts:manifest.counts,manifest:'dist/skin-packs/index.json'},null,2));
      }else{
        const packs=choice==='--scaffold'?scaffold():audit();
        console.log(JSON.stringify({action:choice,scope:choice==='--scaffold'?'review-inventory':'reviewed-source-media',
          staging:'not-checked',integration:'not-checked',packs},null,2));
      }
    }catch(error){console.error(error.message);process.exitCode=1}
  }
}
