import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {materialPath} from './weapon-effect-materials.mjs';
import {decodeRadianceHDR,isEnvironmentPanorama,resizeLinearHDR,encodeRGBA16F,environmentStats,halfEnvironmentStats} from './weapon-environments.mjs';

export const DEFAULT_WEAPON_STUDIO='/Game/Blueprints/LightStudio/HDRI/Weapon/Ares_HDRI_FirstPerson';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceParameters=data=>({
  scalars:Object.fromEntries(Object.entries(data.Scalars??{}).filter(([name])=>/HDRI|Reflection|Probe/i.test(name))),
  colors:Object.fromEntries(Object.entries(data.Colors??{}).filter(([name])=>/HDRI|Reflection/i.test(name))),
});
export function sourceEnvironmentIntensity(data,fallback){
  if(materialPath(data.Textures?.HDRI))for(const parameter of ['HDRI Strength','HDRI Brightness']){
    const value=data.Scalars?.[parameter];
    if(Number.isFinite(value)&&value>=0)return {value,parameter};
  }
  return {value:fallback,parameter:null};
}

// Called by import-weapon-models.mjs. Original RGBE files are retained as source
// records; only bounded linear RGBA16F payloads enter the runtime asset closure.
export function createWeaponEnvironmentImporter({sourceRoot,store,audit,originalDirectory,repositoryRoot,maxWidth=1024,maxHeight=512,fallback=DEFAULT_WEAPON_STUDIO}){
  const imported=new Map();
  const review=audit.environments={schemaVersion:1,type:'rgba16f',channels:'RGBA',byteOrder:'little-endian',colorSpace:'linear-srgb',alpha:1,
    processing:'Radiance RGBE decoded to linear radiance; oversized panoramas use linear area averaging before IEEE binary16 quantization. No exposure, tone mapping or radiance clamping.',
    cap:{width:maxWidth,height:maxHeight},fallbackSource:fallback,sources:[],materials:[],omitted:[]};
  function environment(logical){
    const key=logical.toLowerCase();if(imported.has(key))return imported.get(key);
    if(!/^\/(?:Game|Engine)\//.test(logical)||logical.includes('..'))throw new Error('Invalid source environment path');
    const relative=logical.replace(/^\/Game\//,'ShooterGame/Content/').replace(/^\/Engine\//,'Engine/Content/')+'.hdr';
    const file=path.join(sourceRoot,relative);
    if(!fs.existsSync(file))throw new Error('Missing original weapon HDRI: '+relative);
    const original=fs.readFileSync(file),originalSha256=sha(original),image=decodeRadianceHDR(original);
    if(!isEnvironmentPanorama(image.width,image.height))throw new Error('Source HDRI is not a 2:1 panorama: '+logical);
    const originalStatistics=environmentStats(image.rgba),resized=resizeLinearHDR(image,maxWidth,maxHeight);
    const half=encodeRGBA16F(resized.rgba),runtimeStatistics=halfEnvironmentStats(half),bytes=gzipSync(half,{level:9});
    fs.mkdirSync(originalDirectory,{recursive:true});
    const backup=path.join(originalDirectory,originalSha256+'.hdr');fs.writeFileSync(backup,original);
    const originalRecord={file:path.relative(repositoryRoot,backup).replaceAll('\\','/'),sha256:originalSha256,bytes:original.length,width:image.width,height:image.height,statistics:originalStatistics};
    const data=store(bytes,'bin.gz',{path:relative,kind:'environment',operation:'linear HDR panorama to little-endian RGBA16F; gzip',sha256:sha(half),originalSha256,
      width:resized.width,height:resized.height,resolution:resized.resampled?'environment-size-cap':'original',resampled:resized.resampled,original:originalRecord});
    const descriptor={data,width:resized.width,height:resized.height,type:'rgba16f'};
    review.sources.push({source:logical,original:originalRecord,environment:descriptor,decodedSha256:sha(half),decodedBytes:half.length,compressedBytes:bytes.length,resampled:resized.resampled,statistics:runtimeStatistics});
    imported.set(key,descriptor);return descriptor;
  }
  return function importMaterialEnvironment(name,data,material,sourceMaterial){
    if(material.hidden){review.omitted.push({material:name,sourceMaterial,reason:'Hidden source surface has no environment allocation'});return null;}
    const explicit=materialPath(data.Textures?.HDRI),logical=explicit||fallback;
    const result=environment(logical);
    const previousEnvIntensity=material.envIntensity,intensity=sourceEnvironmentIntensity(data,previousEnvIntensity);
    material.envIntensity=intensity.value;
    review.materials.push({material:name,sourceMaterial,assignment:explicit?'source-material-hdri':'weapon-studio-fallback',source:logical,
      environment:result.data,importedEnvIntensity:material.envIntensity,intensityParameter:intensity.parameter,previousEnvIntensity,parameters:sourceParameters(data)});
    return result;
  };
}
