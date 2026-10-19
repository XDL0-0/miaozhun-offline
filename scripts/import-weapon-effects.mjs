import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {resolveEffectMaterial,effectShapeTexture,materialPath} from './weapon-effect-materials.mjs';
import {decodeWeaponGlb} from '../patches/weapon-models-runtime.mjs';

// Translate cooked Cascade tables into the trainer's existing particle engine.
// No particle simulation or shader compilation is added to the firing handler.
export function importWeaponEffects({input,sourceRoot,entries,texture,store,audit}){
  const plans=JSON.parse(fs.readFileSync(path.join(input,'fire-plan.json'),'utf8'));
  const result={guns:{},systems:{},materials:{},meshes:{},textures:{}},byName=new Map(),issues=[];
  const refPath=materialPath;
  const exported=(ref,ext)=>path.join(sourceRoot,refPath(ref).replace(/^\/Game\//,'ShooterGame/Content/').replace(/^\/Engine\//,'Engine/Content/')+'.'+ext);
  const enumName=(v,prefix='')=>(v??'').split('::').at(-1).replace(prefix,'');
  const vec=v=>[v?.X??0,v?.Y??0,v?.Z??0],rgb=v=>[v?.R??1,v?.G??1,v?.B??1];
  const scalar=(v,defaultValue=0)=>Number.isFinite(v)?v:defaultValue;
  const commonLut=path.join(sourceRoot,'ShooterGame/Content/VFX/Textures/ColorGradient/0_LUT_Variant_TEMPLATE_TEX');
  if(!fs.existsSync(commonLut+'.png')&&fs.existsSync(commonLut+'.hdr')){
    const converted=spawnSync(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-i',commonLut+'.hdr','-pix_fmt','rgb24','-frames:v','1',commonLut+'.png'],{windowsHide:true});
    if(converted.status!==0)throw new Error('HDR light lookup conversion failed');
  }
  function dist(raw,dimensions=1,fallback=0,objects=[]){
    if(!raw)return dimensions===3?{c3:Array.isArray(fallback)?fallback:[fallback,fallback,fallback]}:{c:fallback};
    const t=raw.Table;
    if(t?.Values?.length)return {v:t.Values,n:t.EntryCount??1,st:t.EntryStride??dimensions,sub:t.SubEntryStride??0,tb:t.TimeBias??0,ts:t.TimeScale??0,op:t.Op??1,lock:t.LockFlag??0};
    const object=objects[Number(raw.Distribution?.ObjectPath?.split('.').at(-1))];
    if(object?.Properties?.ConstantCurve?.Points&&dimensions===1)return {curve:object.Properties.ConstantCurve.Points.map(p=>[p.InVal,p.OutVal,enumName(p.InterpMode),p.ArriveTangent,p.LeaveTangent])};
    if(dimensions===3)return {c3:raw.MinValueVec?vec(raw.MinValueVec):Array.isArray(fallback)?fallback:[fallback,fallback,fallback]};
    return {c:raw.MinValue??raw.MaxValue??fallback};
  }
  const base=JSON.parse(fs.readFileSync(new URL('./weapon-native-effect-materials.json',import.meta.url)));
  const readRaw=logical=>{const f=path.join(input,'properties',path.basename(logical)+'.json');if(!fs.existsSync(f))return null;return JSON.parse(fs.readFileSync(f)).find(o=>o.Package===logical);};
  const readExport=logical=>{const f=exported({ObjectPath:logical+'.0'},'json');return fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):null;};
  const rejected=new Map(),converted=[];
  function tex(ref){
    const logical=refPath(ref);if(!logical)return null;const key='skin:'+logical;
    if(result.textures[key])return key;
    const normalized={ObjectPath:logical+'.0'},file=exported(normalized,'png');
    if(!fs.existsSync(file)){issues.push({kind:'missing texture',source:logical});return null;}
    const bytes=fs.readFileSync(file),url=texture(normalized);
    const native=base.textures?.[logical],lookup=/LUT|ColorGradient/i.test(logical);
    const alpha=spawnSync(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-i',file,'-vf','format=rgba,alphaextract','-f','rawvideo','-pix_fmt','gray','pipe:1'],{windowsHide:true,maxBuffer:32*1024*1024});
    if(alpha.status!==0)throw new Error('Cannot inspect sprite transparency: '+logical);
    const alphaConst=alpha.stdout.every(v=>v===255);
    result.textures[key]={file:url,w:bytes.readUInt32BE(16),h:bytes.readUInt32BE(20),srgb:native?.srgb??!lookup,clampX:native?.clampX??lookup,clampY:native?.clampY??lookup,nearest:native?.nearest??lookup,alphaConst};
    return key;
  }
  function material(ref){
    const logical=refPath(ref),key='skin:'+logical;if(result.materials[key])return key;if(rejected.has(key))return null;
    const reject=reason=>{rejected.set(key,reason);issues.push({kind:'suppressed material',source:logical,reason});return null;};
    if(!readExport(logical))return reject('Missing exported material');
    const data=resolveEffectMaterial(logical,readRaw,readExport),t=data.Textures,s=data.Scalars,c=data.Colors,sw=data.Switches;
    const template=base.materials?.[logical];let m;
    if(template){
      m=structuredClone(template);
      for(const k of ['tex','texE','texO','lut'])if(m[k]){m[k]=tex({ObjectPath:m[k]+'.0'});if(!m[k])return reject('Missing source texture');}
    }else if(/FakeLight/i.test(logical)||data.BlendMode===4){
      const lut=t.LUTs??t.LUT;
      if(!lut)return reject('Untranslated mesh-light shader; generic white gun glow removed');
      m={kind:'fakelight',lut:tex(lut),lutPos:s.LUT_Position??.5,lutRow:((s.LUT_Variant??0)+.5)/(s['Number of Luts']??4)};if(!m.lut)return reject('Missing light lookup');
    }else{
      if(c.WPO&&t.WPO_Tex)return reject('Vertex-displaced flower shader unavailable; rigid crossing planes removed');
      const raw=readRaw(logical),embedded=raw?.Type==='Material'&&raw.ReferencedTextures?.length===1?raw.ReferencedTextures[0]:null;
      const ref=effectShapeTexture({...t,...(embedded?{Texture:embedded}:{})},r=>fs.existsSync(exported(r,'png')));
      if(!ref)return reject('No reliable source silhouette; procedural fallback removed');
      const main=tex(ref),textureInfo=result.textures[main],generic=data.parents.some(p=>/0_GenericA01_MAT$/.test(p));
      // Camera-projected distortion, noise volumes and debug/default textures
      // cannot be replaced by a textured rectangle without losing their mask.
      if(sw.Diffuse_UVScreen||sw.Emissive_UVScreen)return reject('Screen-projected shader is unsupported');
      const alphaRef=sw.Alpha_aToggle?t.Alpha_Base:null;
      const opacity=alphaRef&&!/DefaultDiffuse|00_Debug|LUT|ColorGradient/.test(refPath(alphaRef))&&fs.existsSync(exported(alphaRef,'png'))?tex(alphaRef):null;
      const lutRef=sw.LUT===true?t.LUTs??t.LUT:null;
      const uv=prefix=>({scale:[s[prefix+'_ScaleU']??1,s[prefix+'_ScaleV']??1],offset:[s[prefix+'_OffsetU']??0,s[prefix+'_OffsetV']??0],rot:s[prefix+'_Rotate']??0,rate:s[prefix+'_RotateRate']??0,scroll:[s[prefix+'_ScrollU']??0,s[prefix+'_ScrollV']??0]});
      const e=generic?uv('Emissive'):{scale:[1,1],offset:[0,0],rot:0,rate:0,scroll:[0,0]},o=generic?uv('Alpha'):e;
      const dyn=(data.dynamic??[]).findIndex(n=>/^Dissolve$/i.test(n));
      m={kind:'skinmask',tex:main,texO:opacity,lut:lutRef?tex(lutRef):null,e,o,
        useAlpha:sw['Use Alpha Channel']??(!textureInfo.alphaConst),opacityAlpha:opacity?!result.textures[opacity].alphaConst:false,
        tint:rgb(c.Emissive_ColorMult??c['Emissive Color']??c.EmissiveColor),
        texColor:sw.Emissive_Base_32Bit??false,emissiveMult:s['Emissive Mult']??s['Emissive Intensity']??s.EmissiveMult??1,
        alphaMult:Math.min(s.Alpha_ColorMult??1,4),polarE:sw.Emissive_PolarCoord??false,polarO:sw.Alpha_PolarCoord??false,
        lutMin:s.LUT_Min??0,lutMax:s.LUT_Max??s.LUT_Mix??1,lutVariant:s.LUT_Variant??0,nLuts:s['Number of Luts']??4,
        dissolve:dyn,dissolveSoft:1/Math.max(1,s.DissolveEdgeSoft??s.SoftValue??s.Alpha_Dissolve_HardEdgePower??10)};
      // Exact source slot selection restores petals/eyes instead of sampling a
      // noise mask or the flat Variant Color selector as RGB.
      if(c['V0:ColorLight'])m.tint=rgb(c['V0:ColorLight']);
      if(sw.Rotate90||sw['Rotate 90 Degrees'])m.e={...m.e,rot:m.e.rot+.25};
      if(c.ColorA&&c.ColorB)m={kind:'uberlerp',tex:main,colA:rgb(c.ColorA),colB:rgb(c.ColorB)};
    }
    result.materials[key]=m;converted.push({source:logical,kind:m.kind,parents:data.parents});return key;
  }
  function mesh(ref){
    const name='skin:'+refPath(ref);if(result.meshes[name])return name;
    const file=exported(ref,'glb');if(!fs.existsSync(file)){issues.push({kind:'missing effect mesh',source:refPath(ref)});return null;}
    const bytes=fs.readFileSync(file),decoded=decodeWeaponGlb(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
    const v=[],uv=[],i=[];let start=0;
    for(const p of decoded.primitives){for(let k=0;k<p.position.length;k+=3)v.push(p.position[k],-p.position[k+1],p.position[k+2]);uv.push(...p.uv);i.push(...p.index.map(x=>x+start));start+=p.position.length/3;}
    result.meshes[name]={v,uv,i};return name;
  }
  function system(asset){
    if(byName.has(asset))return byName.get(asset);
    const file=path.join(input,'properties',path.basename(asset,'.uasset')+'.json'),objects=JSON.parse(fs.readFileSync(file)),object=objects.find(o=>o.Type==='ParticleSystem');
    if(!object)throw new Error('Expected Cascade system '+asset);
    const resolve=ref=>objects[Number(ref?.ObjectPath?.split('.').at(-1))];
    const name='skin:'+asset.replace('ShooterGame/Content/','/Game/').replace('.uasset',''),emitters=[];
    for(const ref of object.Properties.Emitters??[]){
      const source=resolve(ref),lod=resolve(source?.Properties?.LODLevels?.[0]),p=lod?.Properties??{},required=resolve(p.RequiredModule)?.Properties??{},spawn=resolve(p.SpawnModule)?.Properties??{};
      if(p.bEnabled===false)continue;
      const td=resolve(p.TypeDataModule),tp=td?.Properties??{};
      const e={name:source?.Properties?.EmitterName??source?.Name,enabled:p.bEnabled!==false,detail:source?.Properties?.DetailModeBitmask??15,mat:material(required.Material),align:enumName(required.ScreenAlignment??'PSA_Square','PSA_'),local:required.bUseLocalSpace??false,duration:required.EmitterDuration??1,delay:required.EmitterDelay??0,loops:required.EmitterLoops??0,rate:dist(spawn.Rate??required.SpawnRate,1,0,objects),burst:(spawn.BurstList??required.BurstList??[]).map(b=>[b.Count,b.CountLow??-1,b.Time??0]),burstScale:dist(spawn.BurstScale,1,1,objects),sub:[required.SubImages_Horizontal??1,required.SubImages_Vertical??1],interp:enumName(required.InterpolationMethod??'PSUVIM_None','PSUVIM_'),randImgTime:required.RandomImageTime??1,uvFlip:enumName(required.UVFlippingMode??'None'),sort:enumName(required.SortMode??'None','PSORTMODE_'),lock:'NONE',pivot:[0,0],mesh:null,mods:[]};
      if(!e.mat){issues.push({kind:'suppressed emitter',source:asset,emitter:e.name,reason:rejected.get('skin:'+refPath(required.Material))});continue;}
      if(td?.Type==='ParticleModuleTypeDataMesh'){
        const n=mesh(tp.Mesh);if(n)e.mesh={name:n,cameraFacing:tp.bCameraFacing??false,align:enumName(tp.MeshAlignment),axisLock:enumName(tp.AxisLockOption),overrideMaterial:tp.bOverrideMaterial??false,rpy:dist(tp.RollPitchYawRange,3,0,objects)};
      }else if(td){issues.push({kind:'unsupported particle type',source:asset,type:td.Type});e.enabled=false;}
      const d=(raw,n=1,f=0)=>dist(raw,n,f,objects);
      for(const ref of p.Modules??[]){
        const m=resolve(ref);if(!m||m.Properties?.bEnabled===false)continue;const v=m.Properties??{},type=m.Type.replace(/_Seeded$/,'');
        let mod;
        switch(type){
          case 'ParticleModuleLifetime':mod={t:'life',d:d(v.Lifetime,1,1)};break;
          case 'ParticleModuleSize':mod={t:'size',d:d(v.StartSize,3,1)};break;
          case 'ParticleModuleSizeScale':mod={t:'sml',d:d(v.SizeScale,3,1),x:v.EnableX??true,y:v.EnableY??true,z:v.EnableZ??true};break;
          case 'ParticleModuleSizeMultiplyLife':mod={t:'sml',d:d(v.LifeMultiplier,3,1),x:v.MultiplyX??true,y:v.MultiplyY??true,z:v.MultiplyZ??true};break;
          case 'ParticleModuleColor':mod={t:'color',c:d(v.StartColor,3,1),a:d(v.StartAlpha,1,1),clamp:v.bClampAlpha??true};break;
          case 'ParticleModuleColorOverLife':mod={t:'col_life',c:d(v.ColorOverLife,3,1),a:d(v.AlphaOverLife,1,1)};break;
          case 'ParticleModuleColorScaleOverLife':mod={t:'colscale_life',c:d(v.ColorScaleOverLife,3,1),a:d(v.AlphaScaleOverLife,1,1),emitterTime:v.bEmitterTime??false};break;
          case 'AresParticleModuleVariantColor':mod={t:'colscale_life',c:{c3:rgb(v.BaseColor)},a:{c:1},emitterTime:false};break;
          case 'ParticleModuleRotation':mod={t:'rot',d:d(v.StartRotation)};break;
          case 'ParticleModuleRotationRate':mod={t:'rotrate',d:d(v.StartRotationRate)};break;
          case 'ParticleModuleLocation':mod={t:'loc',d:d(v.StartLocation,3,0)};break;
          case 'ParticleModuleVelocity':mod={t:'vel',d:d(v.StartVelocity,3,0),r:d(v.StartVelocityRadial)};break;
          case 'ParticleModuleAcceleration':case 'ParticleModuleAccelerationOverLifetime':mod={t:'accel',d:d(v.Acceleration??v.AccelOverLife,3,0)};break;
          case 'ParticleModuleAccelerationConstant':mod={t:'accel',d:{c3:vec(v.Acceleration)}};break;
          case 'ParticleModuleAccelerationDrag':mod={t:'drag',d:d(v.DragCoefficient)};break;
          case 'ParticleModuleSubUV':mod={t:'subuv',d:d(v.SubImageIndex)};break;
          case 'ParticleModuleSubUVMovie':mod={t:'movie',fps:d(v.FrameRate,1,30),start:v.StartingFrame??0};break;
          case 'ParticleModuleOrbit':mod={t:'orbit',offset:d(v.OffsetAmount,3,0),rotation:d(v.RotationAmount,3,0),rate:d(v.RotationRateAmount,3,0)};break;
          case 'ParticleModuleCameraOffset':mod={t:'camoff',d:d(v.CameraOffset),spawnOnly:v.bSpawnTimeOnly??false,method:enumName(v.UpdateMethod)};break;
          case 'ParticleModuleMeshRotation':mod={t:'meshrot',d:d(v.StartRotation,3,0)};break;
          case 'ParticleModulePivotOffset':e.pivot=[v.PivotOffset?.X??0,v.PivotOffset?.Y??0];break;
          case 'ParticleModuleOrientationAxisLock':e.lock=enumName(v.LockAxisFlags??'EPAL_NONE','EPAL_');break;
          case 'ParticleModuleParameterDynamic':mod={t:'dyn',ch:(v.DynamicParams??[]).map(x=>({d:d(x.ParamValue),emitterTime:x.bUseEmitterTime??false,spawnOnly:x.bSpawnTimeOnly??false}))};break;
          case 'ParticleModuleLocationPrimitiveSphere':mod={t:'sphere',radius:d(v.StartRadius),loc:d(v.StartLocation,3,0),px:v.Positive_X??true,nx:v.Negative_X??true,py:v.Positive_Y??true,ny:v.Negative_Y??true,pz:v.Positive_Z??true,nz:v.Negative_Z??true,surface:v.SurfaceOnly??false,velocity:v.Velocity??false,velScale:d(v.VelocityScale,1,1)};break;
          case 'ParticleModuleVelocityInheritParent':break;
          default:issues.push({kind:'unsupported particle module',source:asset,type});
        }
        if(mod)e.mods.push(mod);
      }
      const tint=result.materials[e.mat]?.kind!=='skinmask'?result.materials[e.mat]?.tint:null;if(tint&&tint.some(v=>v!==1))e.mods.push({t:'colscale_life',c:{c3:tint},a:{c:1},emitterTime:false});
      if(e.enabled&&e.mat)emitters.push(e);
    }
    result.systems[name]={emitters,...(!emitters.length?{suppressed:true,reason:'All source emitters require unsupported materials'}:{})};byName.set(asset,name);return name;
  }
  const packages=new Map();
  for(const plan of plans){
    const rules=list=>list.map(({asset,...rule})=>({...rule,sys:system(asset)}));
    const gun={hip:rules(plan.hip),ads:rules(plan.ads),prev:'DestroyPrevious',tonemap:'ue'};
    packages.set(plan.name,gun);
  }
  audit.particleImport={source:'Original skin firing blueprints and cooked Cascade tables',systems:byName.size,materials:Object.keys(result.materials).length,meshes:Object.keys(result.meshes).length,textures:Object.keys(result.textures).length,converted,limitations:[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()]};
  return {result,packages,urls(gun){return [...new Set([...gun.hip,...gun.ads].flatMap(rule=>result.systems[rule.sys].emitters.flatMap(e=>{const m=result.materials[e.mat];return [m.tex,m.lut,m.texE,m.texO].filter(Boolean).map(t=>result.textures[t].file);})))];}};
}
