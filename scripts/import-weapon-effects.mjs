import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {decodeWeaponGlb} from '../patches/weapon-models-runtime.mjs';

// Translate cooked Cascade tables into the trainer's existing particle engine.
// No particle simulation or shader compilation is added to the firing handler.
export function importWeaponEffects({input,sourceRoot,entries,texture,store,audit}){
  const plans=JSON.parse(fs.readFileSync(path.join(input,'fire-plan.json'),'utf8'));
  const result={guns:{},systems:{},materials:{},meshes:{},textures:{}},byName=new Map(),issues=[];
  const refPath=ref=>(ref?.ObjectPath??ref?.AssetPathName??'').replace(/\.[^/.]+$/,'');
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
  function tex(ref){
    const logical=refPath(ref);if(!logical)return null;const key='skin:'+logical;
    if(result.textures[key])return key;
    const normalized={ObjectPath:logical+'.0'},file=exported(normalized,'png');
    if(!fs.existsSync(file)){issues.push({kind:'missing texture',source:logical});return null;}
    const bytes=fs.readFileSync(file),url=texture(normalized);
    result.textures[key]={file:url,w:bytes.readUInt32BE(16),h:bytes.readUInt32BE(20),srgb:true,clampX:false,clampY:false,nearest:false,alphaConst:false};
    return key;
  }
  function material(ref){
    const logical=refPath(ref),key='skin:'+logical;if(result.materials[key])return key;
    const file=exported(ref,'json');if(!fs.existsSync(file)){issues.push({kind:'missing material',source:logical});return null;}
    const data=JSON.parse(fs.readFileSync(file)),t=data.Textures??{},s=data.Scalars??{},c=data.Colors??{},sw=data.Switches??{};
    let m;
    const fakeLight=/FakeLight/i.test(logical)||data.BlendMode===4;
    const lutRef=t.LUTs??t.LUT??Object.entries(t).find(([n])=>/LUT/i.test(n))?.[1]??(fakeLight?{ObjectPath:'/Game/VFX/Textures/ColorGradient/0_LUT_Variant_TEMPLATE_TEX.0'}:null);
    const lut=lutRef&&fs.existsSync(exported(lutRef,'png'))?lutRef:null;
    if(fakeLight&&lut){m={kind:'fakelight',lut:tex(lut),lutPos:s.LUT_Position??.5};if(!m.lut)return null;}
    else{
      const refs=[t.Emissive_Base,t['Emissive Color'],t.PM_Emissive,t.Emissive,t.Texture,t.Diffuse,t.Albedo,...Object.entries(t).filter(([n])=>!/Normal|Distort|LUT|Noise|Opacity Layer/i.test(n)).map(([,v])=>v),t.PM_Diffuse];
      const ref=refs.find(r=>r&&!/DefaultDiffuse/.test(refPath(r))&&fs.existsSync(exported(r,'png'))),main=ref?tex(ref):null;
      if(!main){
        m={kind:'skinproc',mode:/Ring|Ripple|BlackHole/i.test(logical)?1:/Elec/i.test(logical)?2:0,power:s.FresnelPower??s.Power??2};
        issues.push({kind:'procedural shader translation',source:logical});
      }
      else if(c.ColorA&&c.ColorB)m={kind:'uberlerp',tex:main,colA:rgb(c.ColorA),colB:rgb(c.ColorB)};
      else m={kind:'mf',tex:main,lut:lut?tex(lut):null,lutMin:s.LUT_Min??0,lutMix:s.LUT_Mix??1,emissiveMult:Math.min(20,Math.max(.05,s['Emissive Intensity']??s['Emissive Multiplier']??s.EmissiveMult??1)),lutVariant:s.LUT_Variant??0,nLuts:s['Number of Luts']??4,errorFix:s['Error Fix']??.05,rot90:sw['Rotate 90 Degrees']??false,useLut:!!lut,useAlpha:false,texColor:sw['Use Texture Color']??false,particleColor:true};
      m.tint=rgb(c.Emissive_ColorMult??c['Emissive Color']??c.EmissiveColor??c.Param??c.Tint??c.Color);
    }
    result.materials[key]=m;return key;
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
      const td=resolve(p.TypeDataModule),tp=td?.Properties??{};
      const e={name:source?.Properties?.EmitterName??source?.Name,enabled:p.bEnabled!==false,detail:source?.Properties?.DetailModeBitmask??15,mat:material(required.Material),align:enumName(required.ScreenAlignment??'PSA_Square','PSA_'),local:required.bUseLocalSpace??false,duration:required.EmitterDuration??1,delay:required.EmitterDelay??0,loops:required.EmitterLoops??0,rate:dist(spawn.Rate??required.SpawnRate,1,0,objects),burst:(spawn.BurstList??required.BurstList??[]).map(b=>[b.Count,b.CountLow??-1,b.Time??0]),burstScale:dist(spawn.BurstScale,1,1,objects),sub:[required.SubImages_Horizontal??1,required.SubImages_Vertical??1],interp:enumName(required.InterpolationMethod??'PSUVIM_None','PSUVIM_'),randImgTime:required.RandomImageTime??1,uvFlip:enumName(required.UVFlippingMode??'None'),sort:enumName(required.SortMode??'None','PSORTMODE_'),lock:'NONE',pivot:[0,0],mesh:null,mods:[]};
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
      const tint=result.materials[e.mat]?.tint;if(tint&&tint.some(v=>v!==1))e.mods.push({t:'colscale_life',c:{c3:tint},a:{c:1},emitterTime:false});
      if(e.enabled&&e.mat)emitters.push(e);
    }
    result.systems[name]={emitters};byName.set(asset,name);return name;
  }
  const packages=new Map();
  for(const plan of plans){
    const rules=list=>list.map(({asset,...rule})=>({...rule,sys:system(asset)}));
    const gun={hip:rules(plan.hip),ads:rules(plan.ads),prev:'DestroyPrevious',tonemap:'ue'};
    packages.set(plan.name,gun);
  }
  audit.particleImport={source:'Original skin firing blueprints and cooked Cascade tables',systems:byName.size,materials:Object.keys(result.materials).length,meshes:Object.keys(result.meshes).length,textures:Object.keys(result.textures).length,limitations:[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()]};
  return {result,packages,urls(gun){return [...new Set([...gun.hip,...gun.ads].flatMap(rule=>result.systems[rule.sys].emitters.flatMap(e=>{const m=result.materials[e.mat];return [m.tex,m.lut,m.texE,m.texO].filter(Boolean).map(t=>result.textures[t].file);})))];}};
}
