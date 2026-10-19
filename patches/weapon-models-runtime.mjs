import {skinPacks} from './skin-packs-runtime.mjs';
import {decodeWeaponMotion,createWeaponMotionPlayer} from './weapon-motion-runtime.mjs';
import {weaponMaterialTextures,createWeaponBodyMaterial} from './weapon-body-materials-runtime.mjs';
import {createWeaponTextureLease,weaponAssetBytes} from './weapon-textures-runtime.mjs';

const WEAPONS=new Set(['vandal','phantom','sheriff','operator','melee']);
const weaponOf=stem=>stem==='viewmodel'?'vandal':stem==='knife'?'melee':stem;
const validPath=p=>typeof p==='string'&&/^\/skin-packs\/models\/[a-z0-9/-]+\.(?:json|png|glb|bin\.gz)$/.test(p);
const TYPES={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const SIZES={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};

export function decodeWeaponEnvironment(meta,buffer){
  if(!meta||!validPath(meta.data)||!meta.data.endsWith('.bin.gz')||meta.type!=='rgba16f'||!Number.isInteger(meta.width)||!Number.isInteger(meta.height)||meta.width<8||meta.width>1024||meta.height<4||meta.height>512||Math.abs(meta.width-meta.height*2)>1||buffer.byteLength!==meta.width*meta.height*8)throw new Error('Invalid weapon environment');
  const pixels=new Uint16Array(buffer);
  for(const value of pixels)if(value&0x8000||(value&0x7c00)===0x7c00)throw new Error('Invalid HDR environment sample');
  return {...meta,pixels};
}

function tangentFrame(p){
  if(!p.tangent)return p;
  const {position,normal,tangent,uv,index}=p,count=position.length/3,signs=new Int8Array(count),duplicates=[],lookup=new Map(),corners=new Uint32Array(index.length);
  for(let v=0;v<count;v++){
    const n=v*3,t=v*4,nx=normal[n],ny=normal[n+1],nz=normal[n+2],dot=nx*tangent[t]+ny*tangent[t+1]+nz*tangent[t+2];
    const x=tangent[t]-nx*dot,y=tangent[t+1]-ny*dot,z=tangent[t+2]-nz*dot,length=Math.hypot(x,y,z);
    if(length>1e-8){tangent[t]=x/length;tangent[t+1]=y/length;tangent[t+2]=z/length;}
  }
  for(let k=0;k<index.length;k+=3){
    const a=index[k],b=index[k+1],c=index[k+2],du1=uv[b*2]-uv[a*2],dv1=uv[b*2+1]-uv[a*2+1],du2=uv[c*2]-uv[a*2],dv2=uv[c*2+1]-uv[a*2+1],det=du1*dv2-du2*dv1;
    const B=[0,0,0];if(Math.abs(det)>1e-12)for(let axis=0;axis<3;axis++)B[axis]=((position[c*3+axis]-position[a*3+axis])*du1-(position[b*3+axis]-position[a*3+axis])*du2)/det;
    for(let corner=0;corner<3;corner++){
      const v=index[k+corner],n=v*3,t=v*4,nx=normal[n],ny=normal[n+1],nz=normal[n+2],tx=tangent[t],ty=tangent[t+1],tz=tangent[t+2];
      const dot=(ny*tz-nz*ty)*B[0]+(nz*tx-nx*tz)*B[1]+(nx*ty-ny*tx)*B[2],sign=Math.abs(dot)>1e-12?(dot<0?-1:1):(signs[v]||tangent[t+3]);
      if(!signs[v])signs[v]=sign;
      let target=v;
      if(sign!==signs[v]){
        const id=v+':'+sign;target=lookup.get(id);
        if(target===undefined){target=count+duplicates.length;duplicates.push({source:v,sign});lookup.set(id,target);}
      }
      corners[k+corner]=target;
    }
  }
  // A small number of source vertices straddle UV orientation seams. Split
  // those corners, including skin weights, so neither side has inverted bumps.
  const result={...p};
  if(duplicates.length){
    for(const [name,size]of Object.entries({position:3,normal:3,tangent:4,uv:2,uv1:2,joint:4,weight:4}))if(p[name]){
      const source=p[name],copy=new source.constructor((count+duplicates.length)*size);copy.set(source);
      duplicates.forEach((entry,i)=>copy.set(source.subarray(entry.source*size,(entry.source+1)*size),(count+i)*size));result[name]=copy;
    }
    result.index=count+duplicates.length>65535?corners:new Uint16Array(corners);
  }
  for(let v=0;v<count;v++)result.tangent[v*4+3]=signs[v]||tangent[v*4+3];
  duplicates.forEach((entry,i)=>result.tangent[(count+i)*4+3]=entry.sign);
  return result;
}

// CUE4Parse GLB: metres, Y-up. The native trainer uses centimetres, Z-up,
// mirrored Y. Their composition is a proper +90 degree X rotation.
export function decodeWeaponGlb(buffer){
  const view=new DataView(buffer);
  if(view.byteLength<28||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==view.byteLength)throw new Error('Invalid weapon GLB');
  let json,bin;
  for(let at=12;at<view.byteLength;){
    const length=view.getUint32(at,true),type=view.getUint32(at+4,true);at+=8;
    if(at+length>view.byteLength)throw new Error('Truncated weapon GLB');
    if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,at,length)).trim());
    else if(type===0x004e4942)bin=buffer.slice(at,at+length);
    at+=length;
  }
  if(!json||!bin||(json.buffers??[]).some(b=>b.uri)||(json.images??[]).some(b=>b.uri))throw new Error('Weapon GLB requires embedded buffers');
  function accessor(index){
    const a=json.accessors[index],b=json.bufferViews[a?.bufferView],Type=TYPES[a?.componentType],size=SIZES[a?.type];
    if(!a||!b||!Type||!size||a.sparse||b.buffer!==0||a.count<1||a.count>1000000)throw new Error('Unsupported weapon accessor');
    const bytes=Type.BYTES_PER_ELEMENT,stride=b.byteStride??size*bytes,offset=(b.byteOffset??0)+(a.byteOffset??0),end=offset+(a.count-1)*stride+size*bytes;
    if(stride<size*bytes||end>bin.byteLength||end>(b.byteOffset??0)+b.byteLength)throw new Error('Invalid weapon buffer layout');
    const result=a.normalized?new Float32Array(a.count*size):new Type(a.count*size),reader=new DataView(bin);
    const read=a.componentType===5126?'getFloat32':a.componentType===5125?'getUint32':a.componentType===5123?'getUint16':'getUint8';
    const divisor=a.normalized?(a.componentType===5121?255:a.componentType===5123?65535:4294967295):1;
    for(let i=0;i<a.count;i++)for(let k=0;k<size;k++)result[i*size+k]=reader[read](offset+i*stride+k*bytes,true)/divisor;
    return result;
  }
  const convertVectors=(values,scale=1)=>{
    const result=new Float32Array(values.length);
    for(let i=0;i<values.length;i+=3){result[i]=values[i]*scale;result[i+1]=-values[i+2]*scale;result[i+2]=values[i+1]*scale;}
    return result;
  };
  const skin=json.skins?.[0],joints=skin?.joints??[],nodeParents=new Map();
  (json.nodes??[]).forEach((node,i)=>node.children?.forEach(c=>nodeParents.set(c,i)));
  const bones=joints.map(index=>{
    const n=json.nodes[index],t=n.translation??[0,0,0],q=n.rotation??[0,0,0,1],s=n.scale??[1,1,1];
    if(n.matrix)throw new Error('Unexpected weapon bone matrix');
    return {name:n.name,parent:joints.indexOf(nodeParents.get(index)),t:[t[0]*100,-t[2]*100,t[1]*100],q:[q[0],-q[2],q[1],q[3]],s:[s[0],s[2],s[1]]};
  });
  const primitives=[];
  for(const mesh of json.meshes??[])for(const p of mesh.primitives){
    if((p.mode??4)!==4)throw new Error('Weapon primitive must use triangles');
    const position=convertVectors(accessor(p.attributes.POSITION),100),normal=convertVectors(accessor(p.attributes.NORMAL));
    const tangent=p.attributes.TANGENT===undefined?null:accessor(p.attributes.TANGENT);
    // Preserve the exported tangent direction in the native coordinate frame.
    if(tangent)for(let i=0;i<tangent.length;i+=4){const y=tangent[i+1];tangent[i+1]=-tangent[i+2];tangent[i+2]=y;}
    const uv=accessor(p.attributes.TEXCOORD_0),uv1=p.attributes.TEXCOORD_1===undefined?null:accessor(p.attributes.TEXCOORD_1),index=accessor(p.indices);
    const joint=p.attributes.JOINTS_0===undefined?null:accessor(p.attributes.JOINTS_0),weight=joint?accessor(p.attributes.WEIGHTS_0):null;
    if(position.length!==normal.length||uv.length!==position.length/3*2||index.length%3||index.some(i=>i>=position.length/3)||joint?.some(i=>i>=bones.length))throw new Error('Invalid weapon geometry');
    if(uv1&&uv1.length!==uv.length)throw new Error('Invalid secondary weapon UVs');
    if(tangent&&(tangent.length!==position.length/3*4||tangent.some(v=>!Number.isFinite(v))))throw new Error('Invalid weapon tangents');
    primitives.push(tangentFrame({position,normal,tangent,uv,uv1,index,joint,weight,material:p.material??0}));
  }
  if(!primitives.length)throw new Error('Empty weapon model');
  return {bones,primitives};
}

export function createWeaponModelLoader({skins=skinPacks,fetcher=(...args)=>fetch(...args),makeImage=()=>new Image(),timeoutMs=12000,cacheBytes=96*1024*1024}={}){
  let catalogue=null,initializing=null;
  const cache=new Map(),pending=new Map(),environmentCache=new Map(),environmentTasks=new Map();
  async function request(url,json=false){
    if(!validPath(url))throw new Error('Invalid local weapon asset path');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {const r=await fetcher(url,{signal:controller.signal});if(!r.ok)throw new Error('Weapon asset HTTP '+r.status);return json?await r.json():await r.arrayBuffer();}
    finally{clearTimeout(timer);}
  }
  function image(url){
    if(!validPath(url))throw new Error('Invalid local weapon texture');
    return new Promise((resolve,reject)=>{
      const img=makeImage();let settled=false;
      const done=(error)=>{if(settled)return;settled=true;clearTimeout(timer);img.onload=null;img.onerror=null;error?reject(error):resolve(img);};
      const timer=setTimeout(()=>done(new Error('Weapon texture timeout')),timeoutMs);
      img.onload=()=>{Promise.resolve(img.decode?.()).then(()=>done(),done);};
      img.onerror=()=>done(new Error('Weapon texture load failed'));img.src=url;
    });
  }
  async function initialize(){
    if(catalogue)return catalogue;
    return initializing??=(async()=>{
      const value=await request('/skin-packs/models/index.json',true);
      if(value.schemaVersion!==1||!value.models||typeof value.models!=='object')throw new Error('Invalid weapon catalogue');
      catalogue=value;return value;
    })().finally(()=>{initializing=null;});
  }
  async function environment(meta){
    const cached=environmentCache.get(meta.data);
    if(cached&&cached.width===meta.width&&cached.height===meta.height&&cached.type===meta.type){environmentCache.delete(meta.data);environmentCache.set(meta.data,cached);return cached;}
    if(environmentTasks.has(meta.data))return environmentTasks.get(meta.data);
    const task=(async()=>{
      const compressed=await request(meta.data),buffer=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const result=decodeWeaponEnvironment(meta,buffer);environmentCache.set(meta.data,result);
      while(environmentCache.size>4)environmentCache.delete(environmentCache.keys().next().value);
      return result;
    })();
    environmentTasks.set(meta.data,task);
    try{return await task;}finally{if(environmentTasks.get(meta.data)===task)environmentTasks.delete(meta.data);}
  }
  const selectionKey=weapon=>{
    const s=skins.selection(weapon);
    if(!WEAPONS.has(weapon)||s.collection==='default'||s.modelEnabled===false)return null;
    const base=`${s.collection}/${weapon}`;
    return catalogue?.variants?.[base]?.[s.theme]?base+'/'+s.theme:base;
  };
  async function load(stem){
    const weapon=weaponOf(stem);if(!WEAPONS.has(weapon))return null;
    await skins.initialize();if(!selectionKey(weapon))return null;
    try{await initialize();}catch(error){globalThis.console?.warn('Skin weapon catalogue unavailable',error);return null;}
    const key=selectionKey(weapon);if(!key)return null;
    if(cache.has(key)){const v=cache.get(key);cache.delete(key);cache.set(key,v);return v;}
    if(pending.has(key))return pending.get(key);
    const task=(async()=>{
      const [collection,,theme]=key.split('/'),base=collection+'/'+weapon;
      const url=theme?catalogue.variants?.[base]?.[theme]:catalogue.models[key];if(!url)throw new Error('Skin model unavailable: '+key);
      const manifest=await request(url,true);
      if(manifest.schemaVersion!==1||manifest.weapon!==weapon||`${manifest.collection}/${weapon}`!==base||theme&&manifest.theme!==theme||!Array.isArray(manifest.parts)||manifest.parts.length>6)throw new Error('Invalid weapon package');
      if(manifest.attachment&&(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(manifest.attachment.bone)||manifest.attachment.q&&(!Array.isArray(manifest.attachment.q)||manifest.attachment.q.length!==4||manifest.attachment.q.some(n=>!Number.isFinite(n))||Math.abs(Math.hypot(...manifest.attachment.q)-1)>.02)))throw new Error('Invalid weapon attachment');
      const pictures=new Map(),imageTasks=new Map();
      await Promise.all((manifest.effects?.textures??[]).map(async url=>{if(!imageTasks.has(url))imageTasks.set(url,image(url).then(img=>pictures.set(url,img)));return imageTasks.get(url);}));
      const motions=manifest.motions?{actions:manifest.motions.actions,clips:{}}:null;
      if(motions)await Promise.all(Object.entries(manifest.motions.clips).map(async([id,clip])=>{
        const compressed=await request(clip.data),buffer=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        motions.clips[id]=decodeWeaponMotion(clip,buffer);
      }));
      const decoded=await Promise.all(manifest.parts.map(async part=>{
        if(!['body','magazine','sight','silencer'].includes(part.role)||!Array.isArray(part.materials))throw new Error('Invalid weapon part');
        const data=decodeWeaponGlb(await request(part.url));
        await Promise.all(part.materials.flatMap(weaponMaterialTextures).map(url=>{
          if(!imageTasks.has(url))imageTasks.set(url,image(url).then(img=>pictures.set(url,img)));
          return imageTasks.get(url);
        }));
        if(data.primitives.some(p=>p.material>=part.materials.length))throw new Error('Missing weapon material slot');
        return {...part,data};
      }));
      if(decoded.filter(p=>p.role==='body').length!==1||decoded.filter(p=>p.role==='magazine').length!==(weapon==='melee'?0:1))throw new Error('Incomplete weapon model');
      const environments=new Map(),environmentSpecs=new Map(decoded.flatMap(part=>part.materials.filter(m=>!m.hidden&&m.environment).map(m=>[m.environment.data,m.environment])));
      await Promise.all([...environmentSpecs].map(async([url,meta])=>{
        try{environments.set(url,await environment(meta));}catch(error){globalThis.console?.warn('Skin HDR environment unavailable; retaining native lighting',error);}
      }));
      const result={key,weapon,parts:decoded,pictures,motions,environments,attachment:manifest.attachment};result.byteLength=weaponAssetBytes(result);cache.set(key,result);
      // Controllers retain their own image references; evicting raw assets never
      // disposes an in-use GPU texture, and old selections can be collected.
      let retained=[...cache.values()].reduce((sum,pack)=>sum+pack.byteLength,0);
      while(cache.size>1&&(cache.size>4||retained>cacheBytes)){const oldest=cache.keys().next().value;retained-=cache.get(oldest).byteLength;cache.delete(oldest);}
      return result;
    })();
    pending.set(key,task);
    try{return await task;}catch(error){globalThis.console?.warn('Skin weapon load failed; using the native model',error);return null;}
    finally{if(pending.get(key)===task)pending.delete(key);}
  }
  return {load,selectionKey,initialize,picture(url){for(const pack of cache.values()){const image=pack.pictures.get(url);if(image)return image;}return null;}};
}

export const weaponModels=createWeaponModelLoader();
export const loadWeaponModel=stem=>weaponModels.load(stem);
export const weaponEffectImage=url=>weaponModels.picture(url);

// All Three.js types come from the existing renderer. There is one renderer,
// one animation clock and one pair of hands, including left-handed viewmodels.
export function createWeaponAppearance({types,parent,baseRig,baseRest,armsRig,originals,stem,initial,environment,skins=skinPacks,loader=weaponModels}){
  const {Group,Geometry,Attribute,Bone,Skeleton,SkinnedMesh,Mesh,Material,Physical,Texture,DataTexture,half,rgba,equirect,linear,linearSrgb,Vector3,Quaternion,srgb,repeat}=types;
  const weapon=weaponOf(stem),nativeMeshes=originals.filter(Boolean);
  const armsScales=armsRig?.bones.map(b=>[b.scale.x,b.scale.y,b.scale.z]);
  let current=null,disposed=false,serial=0,key=null,requestedGun='vandal';
  const savedVisibility=new Map(nativeMeshes.map(m=>[m,m.visible]));
  function restore(){for(const [mesh,visible]of savedVisibility)mesh.visible=visible;}
  function visibility(){
    if(current)for(const mesh of nativeMeshes)mesh.visible=false;
    else{restore();const original=nativeMeshes.find(m=>m.name==='gun:vandal'),ak=nativeMeshes.find(m=>m.name==='gun:ak47');if(ak){ak.visible=requestedGun==='ak47';if(original)original.visible=!ak.visible;}}
  }
  function construct(assets){
    const group=new Group();group.name='skin:'+assets.key;
    let anchor=null;
    const geometries=new Set(),materials=new Set(),textures=createWeaponTextureLease(Texture),skeletons=new Set(),rigs=[],partMeshes=[];let motion=null;
    const clock={time:{value:0},heat:{value:0}};
    function dispose(){motion?.dispose();for(const mesh of partMeshes)mesh.parent?.remove(mesh);group.parent?.remove(group);anchor?.parent?.remove(anchor);for(const g of geometries)g.dispose();for(const m of materials)m.dispose();textures.dispose();for(const s of skeletons)s.dispose();}
    function tex(url,color){
      if(!url)return null;
      return textures.acquire(url+':'+color,()=>{
        const picture=assets.pictures.get(url);if(!picture)throw new Error('Texture not decoded');
        const t=new Texture(picture);t.flipY=false;t.wrapS=repeat;t.wrapT=repeat;t.anisotropy=8;if(color)t.colorSpace=srgb;t.needsUpdate=true;return t;
      });
    }
    function mats(part){return part.materials.map(m=>{
      const source=assets.environments?.get(m.environment?.data);
      const reflection=source&&DataTexture?textures.acquire('environment:'+source.data,()=>{
        const t=new DataTexture(source.pixels,source.width,source.height,rgba,half);t.mapping=equirect;t.colorSpace=linearSrgb;t.minFilter=linear;t.magFilter=linear;t.flipY=true;t.needsUpdate=true;return t;
      }):environment;
      const mat=createWeaponBodyMaterial(m,{Material,Physical,tex,environment:reflection,clock,hdr:!!source&&!!DataTexture});materials.add(mat);return mat;
    });}
    function geometry(p){
      const g=new Geometry();g.setAttribute('position',new Attribute(p.position,3));g.setAttribute('normal',new Attribute(p.normal,3));g.setAttribute('uv',new Attribute(p.uv,2));g.setAttribute('aimUv2',new Attribute(p.uv1??p.uv,2));g.setIndex(new Attribute(p.index,1));
      if(p.tangent)g.setAttribute('tangent',new Attribute(p.tangent,4));
      if(p.joint){g.setAttribute('skinIndex',new Attribute(p.joint,4));g.setAttribute('skinWeight',new Attribute(p.weight,4));}
      geometries.add(g);return g;
    }
    try{
      const body=assets.parts.find(p=>p.role==='body');
      const bones=body.data.bones.map(b=>{const n=new Bone();n.name=b.name;n.position.set(...b.t);n.quaternion.set(...b.q);n.scale.set(...b.s);return n;});
      if(!bones.length)throw new Error('Skin body must be rigged');
      body.data.bones.forEach((b,i)=>{(b.parent<0?group:bones[b.parent]).add(bones[i]);});
      const boneMap=new Map(bones.map(b=>[b.name,b])),skeleton=new Skeleton(bones);skeletons.add(skeleton);
      if(assets.attachment){
        const index=armsRig?.index.get(assets.attachment.bone),bone=armsRig?.bones[index];
        if(!bone)throw new Error('Skin hand attachment bone missing: '+assets.attachment.bone);
        anchor=new Group();anchor.name='skin:attachment';
        if(assets.attachment.q)anchor.quaternion.set(...assets.attachment.q);else anchor.quaternion.copy(parent.quaternion);
        bone.add(anchor);anchor.add(group);anchor.updateWorldMatrix(true,true);
      }else{parent.add(group);parent.updateWorldMatrix(true,true);}
      const bodyMaterials=mats(body);
      for(const p of body.data.primitives){const mesh=new SkinnedMesh(geometry(p),bodyMaterials[p.material]);mesh.name='skin:body';mesh.frustumCulled=false;group.add(mesh);mesh.bind(skeleton);}
      const bindings=body.data.bones.flatMap((b,i)=>{
        const baseIndex=baseRig.index.get(b.name);if(baseIndex===undefined)return[];
        const offset=baseIndex*3,qoffset=baseIndex*4;
        return [{skin:bones[i],base:baseRig.bones[baseIndex],rest:b.t,basePosition:baseRest.t.slice(offset,offset+3),
          restQ:new Quaternion(...b.q),baseInverse:new Quaternion(...baseRest.q.slice(qoffset,qoffset+4)).invert(),delta:new Quaternion()}];
      });
      rigs.push(...bindings);
      for(const part of assets.parts.filter(p=>p.role!=='body')){
        const attachment=part.role==='magazine'?(boneMap.get('Magazine_Main')??boneMap.get('Mag_Holder')):part.role==='sight'?boneMap.get('Reflex'):boneMap.get('Barrel');
        if(!attachment)throw new Error('Skin attachment bone missing: '+part.role);
        const partMaterials=mats(part);
        for(const p of part.data.primitives){
          if(p.joint)throw new Error('Skin attachments must be static exports');
          const g=geometry(p),mesh=new Mesh(g,partMaterials[p.material]);mesh.name='skin:'+part.role;mesh.frustumCulled=false;attachment.add(mesh);partMeshes.push(mesh);
          if(part.role==='magazine'&&baseRig.index.has('Magazine_Extra')){
            // Phantom/Sheriff skins omit the spare-magazine bone. Use the native
            // animated spare socket so its old default magazine never leaks.
            const extra=boneMap.get('Magazine_Extra')??baseRig.bones[baseRig.index.get('Magazine_Extra')];
            const spare=new Mesh(g,partMaterials[p.material]);spare.name='skin:magazineSpare';spare.frustumCulled=false;extra.add(spare);partMeshes.push(spare);
          }
        }
      }
      // Some spare sockets belong to the native rig, outside our group.
      motion=assets.motions&&armsRig?createWeaponMotionPlayer({motions:assets.motions,armsRig,armsScales,gunBones:bones,baseRig,Quaternion,weapon}):null;
      return {key:assets.key,group,bindings:rigs,bones,boneMap,rest:body.data.bones,skeleton,dispose,motion,clock,muzzle:boneMap.get('Muzzle')};
    }catch(error){dispose();throw error;}
  }
  function swap(assets){
    let next=null;
    try{if(assets)next=construct(assets);}catch(error){globalThis.console?.warn('Skin weapon construction failed; using the native model',error);}
    current?.dispose();current=next;visibility();
  }
  function update(state={},blocked=false){
    if(!current)return;
    current.clock.time.value=Number.isFinite(state.seconds)?state.seconds:0;
    const latestShot=state.shots?.at(-1),shotTime=typeof latestShot==='number'?latestShot:latestShot?.at;
    current.clock.heat.value=Number.isFinite(shotTime)?Math.exp(-Math.max(0,current.clock.time.value-shotTime)*5):0;
    current.bones.forEach((bone,i)=>{const rest=current.rest[i];bone.position.set(...rest.t);bone.quaternion.set(...rest.q);bone.scale.set(...rest.s);});
    for(const b of current.bindings){
      b.skin.position.set(b.rest[0]+b.base.position.x-b.basePosition[0],b.rest[1]+b.base.position.y-b.basePosition[1],b.rest[2]+b.base.position.z-b.basePosition[2]);
      b.delta.multiplyQuaternions(b.baseInverse,b.base.quaternion);b.skin.quaternion.multiplyQuaternions(b.restQ,b.delta).normalize();
    }
    const active=current.motion?.update(state,blocked);
    current.group.userData.motion=active?.action??'idle';
    // Skin actions can move the hand socket after the native rig was sampled.
    // Refresh its ancestors before uploading the skin's world-space bone data.
    current.group.updateWorldMatrix(true,true);current.skeleton.update();
  }
  async function refresh(){
    const next=loader.selectionKey(weapon);if(next===key||disposed)return;key=next;const version=++serial;
    if(!next){key=null;swap(null);return;}
    const assets=await loader.load(weapon);
    if(!disposed&&version===serial){key=loader.selectionKey(weapon);swap(assets?.key===key?assets:null);update();}
  }
  key=loader.selectionKey(weapon);if(initial?.key===key)swap(initial);
  const unsubscribe=skins.subscribe(()=>{void refresh();});
  // A loader may finish after the user's selection changed during scene setup.
  if(key&&!current){key=null;void refresh();}
  const point=new Vector3();
  return {update,setGun(value){requestedGun=value;visibility();},
    setVisible(visible){if(current)current.group.visible=visible;},
    get muzzle(){return current?.muzzle??null;},
    effectBone(name){return current?.boneMap.get(name)??null;},
    get active(){return !!current;},get key(){return current?.key??null;},
    measureMuzzle(camera){if(!current?.muzzle)return null;parent.updateWorldMatrix(true,true);current.muzzle.getWorldPosition(point);point.applyMatrix4(camera.matrixWorldInverse);return {x:point.x,y:point.y,z:point.z};},
    dispose(){if(disposed)return;disposed=true;++serial;unsubscribe();current?.dispose();current=null;restore();},
  };
}
