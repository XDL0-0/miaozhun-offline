import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const themeLabels={default:'Default',base:'Base',watch:'Watch',renegade:'RENEGADE',raja:'RAJA',ignition:'Ignition'};
const segment=/^[a-z0-9-]+$/;
const sha256=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function runFfmpeg(args){
  const result=spawnSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...args],{
    encoding:'utf8',maxBuffer:4*1024*1024,
  });
  if(result.error)throw new Error(`Skin media build requires ffmpeg: ${result.error.message}`);
  if(result.status!==0)throw new Error(`Skin media conversion failed: ${result.stderr.trim()}`);
}

function reviewedSource(root,entry){
  if(!entry?.path||!/^skin-packs\/media\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(entry.path)
    ||entry.path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(entry.sha256??'')){
    throw new Error('Unsafe or unhashed reviewed media path: '+entry?.path);
  }
  const filename=path.join(root,...entry.path.split('/'));
  if(!fs.existsSync(filename))return null;
  if(!fs.statSync(filename).isFile())throw new Error('Reviewed media must be a file: '+entry.path);
  const mediaRoot=fs.realpathSync(path.join(root,'skin-packs','media'))+path.sep;
  if(!fs.realpathSync(filename).startsWith(mediaRoot))throw new Error('Reviewed media escapes its source directory: '+entry.path);
  if(sha256(filename)!==entry.sha256)throw new Error('Reviewed media hash mismatch: '+entry.path);
  return filename;
}

function outputUrl(destination,relative){
  const target=path.join(destination,...relative.split('/'));
  fs.mkdirSync(path.dirname(target),{recursive:true});
  return {target,url:'/skin-packs/'+relative};
}

function audioOutput(root,destination,entry,relative){
  const source=reviewedSource(root,entry);
  if(!source)return null;
  const output=outputUrl(destination,relative);
  const filters=[];
  if(entry.excerpt){
    const {startSeconds,endSeconds,gainDb,fadeOutSeconds}=entry.excerpt;
    // Decode the original before trimming so seeking never includes an earlier
    // compressed packet. Reset timestamps before applying the reviewed tail fade.
    filters.push(`atrim=start=${startSeconds}:end=${endSeconds}`,'asetpts=PTS-STARTPTS');
    if(gainDb!==undefined)filters.push(`volume=${gainDb}dB`);
    if(fadeOutSeconds>0)filters.push(`afade=t=out:st=${endSeconds-startSeconds-fadeOutSeconds}:d=${fadeOutSeconds}`);
  }
  // Explicit audio mapping ignores malformed source APIC cover-art PNGs.
  // Bitexact output fixes the Ogg stream serial and omits changing metadata.
  runFfmpeg(['-i',source,'-map','0:a:0','-vn','-sn','-dn','-map_metadata','-1',
    ...(filters.length?['-af',filters.join(',')]:[]),
    '-c:a','libvorbis','-q:a','5','-fflags','+bitexact','-flags:a','+bitexact',output.target]);
  if(fs.readFileSync(output.target).subarray(0,4).toString()!=='OggS')throw new Error('Invalid Ogg output: '+relative);
  return output.url;
}

function bannerOutput(root,destination,entry,relative){
  const source=reviewedSource(root,entry);
  if(!source)return null;
  const output=outputUrl(destination,relative);
  runFfmpeg(['-i',source,'-map','0:v:0','-an','-sn','-dn','-map_metadata','-1',
    '-vf','scale=300:300:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
    '-frames:v','1','-c:v','png','-threads','1','-fflags','+bitexact','-flags:v','+bitexact',output.target]);
  const bytes=fs.readFileSync(output.target);
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ||bytes.readUInt32BE(16)!==300||bytes.readUInt32BE(20)!==300){
    throw new Error('Invalid normalized banner: '+relative);
  }
  return output.url;
}

function bannerLayerOutput(root,destination,entry){
  const source=reviewedSource(root,entry);
  if(!source)return null;
  const bytes=fs.readFileSync(source);
  // Pips and emblems must retain their native dimensions and transparent bounds;
  // normalizing each layer to a 300px square breaks radial placement.
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ||bytes.readUInt32BE(16)!==entry.width||bytes.readUInt32BE(20)!==entry.height){
    throw new Error('Invalid reviewed banner layer: '+entry.path);
  }
  const output=outputUrl(destination,`layers/${entry.sha256}.png`);
  fs.copyFileSync(source,output.target);
  return output.url;
}

function validateReview(catalog,review){
  const seen=new Set();
  for(const collection of catalog.collections){
    for(const id of [collection.id,...collection.weapons,...collection.themes]){
      if(!segment.test(id))throw new Error('Unsafe catalog identifier: '+id);
    }
  }
  for(const [kind,entries] of Object.entries({audio:review.audio??[],banners:review.banners??[],fire:review.fire??[]})){
    for(const entry of entries){
      const collection=catalog.collections.find(c=>c.id===entry.collection);
      if(!collection||!collection.themes.includes(entry.theme))throw new Error('Unknown reviewed collection/theme: '+entry.collection+'/'+entry.theme);
      if(kind==='fire'&&!collection.weapons.includes(entry.weapon))throw new Error('Ineligible reviewed weapon: '+entry.weapon);
      if(kind==='audio'&&!(entry.role==='successive'&&entry.id==='successive'||entry.role==='kill'&&/^[1-6]$/.test(entry.id)))throw new Error('Invalid reviewed audio role/id');
      if(kind==='banners'&&!segment.test(entry.id))throw new Error('Unsafe banner identifier: '+entry.id);
      if(kind==='banners'&&entry.layers!==undefined){
        if(!entry.layers||typeof entry.layers!=='object'||Array.isArray(entry.layers)
          ||!['frame','ring','emblem','pip'].every(layer=>entry.layers[layer])
          ||Object.keys(entry.layers).some(layer=>!['frame','ring','emblem','pip','headshot'].includes(layer))
          ||!Number.isFinite(entry.pipRadius)||entry.pipRadius<=0||entry.pipRadius>150
          ||!Array.isArray(entry.headshotOffset)||entry.headshotOffset.length!==2
          ||entry.headshotOffset.some(value=>!Number.isFinite(value)||Math.abs(value)>150)){
          throw new Error('Invalid reviewed banner geometry: '+entry.path);
        }
        for(const layer of Object.values(entry.layers)){
          if(!Number.isInteger(layer.width)||!Number.isInteger(layer.height)
            ||layer.width<1||layer.height<1||layer.width>1024||layer.height>1024){
            throw new Error('Invalid reviewed banner dimensions: '+layer.path);
          }
        }
        if(entry.pipFallback!==undefined&&entry.pipFallback!=='generic-chevron'
          ||(entry.layers.pip.width===1||entry.layers.pip.height===1)&&entry.pipFallback!=='generic-chevron'){
          throw new Error('Invisible banner pip requires an explicit fallback: '+entry.path);
        }
        if(entry.pipSprite!==undefined){
          const sprite=entry.pipSprite,source=sprite?.source,size=sprite?.size;
          if(!Array.isArray(source)||source.length!==4||source.some(value=>!Number.isInteger(value))
            ||source[0]<0||source[1]<0||source[2]<1||source[3]<1
            ||source[0]+source[2]>entry.layers.pip.width||source[1]+source[3]>entry.layers.pip.height
            ||!Array.isArray(size)||size.length!==2||size.some(value=>!Number.isFinite(value)||value<=0||value>150)){
            throw new Error('Invalid reviewed pip sprite: '+entry.path);
          }
        }
      }
      if(Object.hasOwn(entry,'excerpt')){
        if(kind==='banners')throw new Error('Reviewed banners cannot have audio excerpts');
        const excerpt=entry.excerpt;
        if(!excerpt||typeof excerpt!=='object'||Array.isArray(excerpt))throw new Error('Invalid reviewed audio excerpt: '+entry.path);
        const {startSeconds,endSeconds,gainDb,fadeOutSeconds}=excerpt,duration=endSeconds-startSeconds;
        if(!Number.isFinite(startSeconds)||startSeconds<0||!Number.isFinite(endSeconds)||endSeconds<=startSeconds||duration>5
          ||Object.keys(excerpt).some(key=>!['startSeconds','endSeconds','gainDb','fadeOutSeconds'].includes(key))
          ||Object.hasOwn(excerpt,'gainDb')&&(!Number.isFinite(gainDb)||gainDb< -18||gainDb>18)
          ||Object.hasOwn(excerpt,'fadeOutSeconds')&&(!Number.isFinite(fadeOutSeconds)||fadeOutSeconds<0||fadeOutSeconds>Math.min(.2,duration))){
          throw new Error('Invalid reviewed audio excerpt: '+entry.path);
        }
      }
      const key=[kind,entry.collection,entry.theme,entry.weapon??entry.id].join('/');
      if(seen.has(key))throw new Error('Duplicate reviewed media mapping: '+key);
      seen.add(key);
    }
  }
}

/** Build only reviewed tracked originals; local/wiki-downloads is never read. */
export function buildSkinPacks({root=projectRoot,destination}={}){
  root=path.resolve(root);
  destination=path.resolve(destination??path.join(root,'dist','skin-packs'));
  const sources=path.join(root,'skin-packs');
  if(destination===path.parse(destination).root||destination===root||destination===sources||sources.startsWith(destination+path.sep)
    ||destination.startsWith(sources+path.sep))throw new Error('Skin output must be separate from its source tree');
  const catalog=JSON.parse(fs.readFileSync(path.join(sources,'catalog.json'),'utf8'));
  const review=JSON.parse(fs.readFileSync(path.join(sources,'asset-review.json'),'utf8'));
  if(review.schemaVersion!==1)throw new Error('Unsupported skin asset review version');
  validateReview(catalog,review);
  // Verify every existing reviewed input before clearing previous output.
  for(const entries of [review.audio??[],review.banners??[],review.fire??[]])for(const entry of entries){
    reviewedSource(root,entry);
    for(const layer of Object.values(entry.layers??{}))reviewedSource(root,layer);
  }
  fs.rmSync(destination,{recursive:true,force:true});
  fs.mkdirSync(destination,{recursive:true});
  const layerUrls=new Set();
  const counts={collections:catalog.collections.length,themes:0,audio:0,killAudio:0,successiveAudio:0,banners:0,layeredBanners:0,bannerLayers:0,fire:0,missingFire:0,eligibleFireCombinations:0};
  const collections=catalog.collections.map(collection=>({
    id:collection.id,name:collection.name,tier:collection.tier,weapons:[...collection.weapons],
    themes:collection.themes.map(theme=>{
      counts.themes++;
      const result={id:theme,label:themeLabels[theme]??theme,fire:{},kills:{},successive:null,banners:[],missing:[]};
      for(const weapon of collection.weapons){
        counts.eligibleFireCombinations++;
        const entry=(review.fire??[]).find(e=>e.collection===collection.id&&e.theme===theme&&e.weapon===weapon);
        const url=entry?audioOutput(root,destination,entry,`${collection.id}/fire/${theme}/${weapon}.ogg`):null;
        result.fire[weapon]=url;
        if(url){counts.fire++;counts.audio++}
        else{counts.missingFire++;result.missing.push('fire:'+weapon)}
      }
      for(let n=1;n<=6;n++){
        const entry=(review.audio??[]).find(e=>e.collection===collection.id&&e.theme===theme&&e.role==='kill'&&e.id===String(n));
        const url=entry?audioOutput(root,destination,entry,`${collection.id}/kill/${theme}/kill-${n}.ogg`):null;
        if(url){result.kills[n]=url;counts.audio++;counts.killAudio++}
        else if(n<=5||entry)result.missing.push('kill:'+n);
      }
      const successive=(review.audio??[]).find(e=>e.collection===collection.id&&e.theme===theme&&e.role==='successive');
      result.successive=successive?audioOutput(root,destination,successive,`${collection.id}/kill/${theme}/successive.ogg`):null;
      if(result.successive){counts.audio++;counts.successiveAudio++}
      else result.missing.push('successive');
      const bannerEntries=(review.banners??[]).filter(e=>e.collection===collection.id&&e.theme===theme);
      for(const entry of bannerEntries){
        const url=bannerOutput(root,destination,entry,`${collection.id}/banners/${theme}/${entry.id}.png`);
        if(url){
          const banner={id:entry.id,label:entry.label,url};
          if(entry.layers){
            const layers=Object.fromEntries(Object.entries(entry.layers).map(([key,value])=>[key,bannerLayerOutput(root,destination,value)]));
            if(Object.values(layers).every(Boolean)){
              const {headshot,...parts}=layers;
              Object.assign(banner,{layers:parts,headshot,pipRadius:entry.pipRadius,headshotOffset:entry.headshotOffset,
                ...(entry.pipFallback?{pipFallback:entry.pipFallback}:{}),...(entry.pipSprite?{pipSprite:entry.pipSprite}:{})});
              for(const value of Object.values(layers))layerUrls.add(value);
              counts.layeredBanners++;
            }else{
              result.missing.push('banner-layers:'+entry.id);
              // Do not silently substitute the old first-kill artwork.
              continue;
            }
          }
          result.banners.push(banner);counts.banners++;
        }
        else result.missing.push('banner:'+entry.id);
      }
      if(!bannerEntries.length)result.missing.push('banner');
      return result;
    }),
  }));
  counts.bannerLayers=layerUrls.size;
  const partial=collections.some(c=>c.themes.some(t=>t.missing.length));
  const manifest={schemaVersion:2,compiledOn:catalog.compiledOn,sourceStatus:partial?'partial':'complete',resourceStatus:partial?'partial':'complete',
    bannerFormat:counts.layeredBanners?'layered':'transparent-composite',bannerSize:[300,300],counts,collections};
  fs.writeFileSync(path.join(destination,'index.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifest=buildSkinPacks();
  console.log(JSON.stringify({sourceStatus:manifest.sourceStatus,resourceStatus:manifest.resourceStatus,...manifest.counts},null,2));
}
