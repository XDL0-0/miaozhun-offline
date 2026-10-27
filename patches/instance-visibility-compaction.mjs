// Optional A/B optimization for the retained static map batches. Keep one
// InstancedMesh and its full bounds/PVS identity; upload only visible instances.
export function createInstanceVisibilityCompactor(mesh, spheres, {minBatchTriangles=50000,knownMaterialHook=null,onReject=null}={}) {
  const reject=(reason,detail=null)=>{onReject?.(reason,detail);return null;};
  const geometry=mesh?.geometry,count=mesh?.count,world=mesh?.matrixWorld?.elements;
  if(!mesh?.isInstancedMesh)return reject('not-instanced');
  if(!Number.isFinite(minBatchTriangles)||minBatchTriangles<0||!Number.isInteger(count)||count<2)return reject('invalid-count');
  if(mesh.matrixAutoUpdate!==false)return reject('matrix-auto-update');
  if(!geometry?.isBufferGeometry||typeof geometry.clone!=='function'||typeof geometry.dispose!=='function')return reject('unsupported-geometry');
  if(!world||world.length!==16)return reject('missing-world-matrix');
  if(Array.isArray(mesh.material)||typeof knownMaterialHook!=='function'||mesh.material?.onBeforeCompile!==knownMaterialHook)return reject('unregistered-material-hook');
  if(mesh.material?.displacementMap||mesh.material?.isShaderMaterial||mesh.material?.isRawShaderMaterial)return reject('deforming-material');
  if(mesh.morphTexture||Object.values(geometry.morphAttributes??{}).some(value=>value?.length))return reject('morphs');
  if(geometry.groups?.length)return reject('geometry-groups');
  if(!spheres||spheres.length!==count*4)return reject('missing-instance-spheres');
  const vertices=geometry.index?.count??geometry.attributes?.position?.count;
  if(!Number.isFinite(vertices)||vertices*count/3<minBatchTriangles)return reject('below-triangle-threshold');
  for(let index=0;index<spheres.length;index++)if(!Number.isFinite(spheres[index])||index%4===3&&spheres[index]<0)return reject('invalid-instance-spheres');
  const supported=attribute=>attribute?.isInstancedBufferAttribute===true&&attribute.meshPerAttribute===1&&
    !attribute.isInterleavedBufferAttribute&&ArrayBuffer.isView(attribute.array)&&typeof attribute.array.subarray==='function'&&
    Number.isInteger(attribute.itemSize)&&attribute.itemSize>0&&attribute.count>=count&&attribute.array.length>=count*attribute.itemSize;
  if(!supported(mesh.instanceMatrix)||mesh.instanceMatrix.itemSize!==16||mesh.instanceColor&&!supported(mesh.instanceColor))return reject('unsupported-matrix-or-color');
  if(mesh.boundingSphere==null){
    if(typeof mesh.computeBoundingSphere!=='function')return reject('missing-full-bounds');
    try{mesh.computeBoundingSphere();}catch{return reject('full-bounds-failed');}
  }
  if(!mesh.boundingSphere)return reject('missing-full-bounds');
  // Native Sphere.applyMatrix4 uses max column length, which underbounds shear.
  // Frobenius norm bounds every direction, including rotated nonuniform scales.
  // Expand only these per-instance tests; retain original full batch bounds/PVS.
  const sphereData=new Float64Array(spheres);
  for(let instance=0;instance<count;instance++){
    const offset=instance*16,matrix=mesh.instanceMatrix.array;let sum=0,maxColumn=0;
    for(let column=0;column<3;column++){
      const at=offset+column*4,x=matrix[at],y=matrix[at+1],z=matrix[at+2];
      const a=world[0]*x+world[4]*y+world[8]*z,b=world[1]*x+world[5]*y+world[9]*z,c=world[2]*x+world[6]*y+world[10]*z;
      const squared=a*a+b*b+c*c;sum+=squared;maxColumn=Math.max(maxColumn,squared);
    }
    if(!Number.isFinite(sum))return reject('invalid-instance-transform');
    const at=instance*4,radius=spheres[at+3]*(maxColumn>0?Math.sqrt(sum/maxColumn):1);
    sphereData[at+3]=radius+(Math.abs(spheres[at])+Math.abs(spheres[at+1])+Math.abs(spheres[at+2])+radius+1)*1e-6;
  }
  for(const[name,attribute]of Object.entries(geometry.attributes??{})){
    const array=attribute?.isInterleavedBufferAttribute?attribute.data?.array:attribute?.array;
    if(!attribute||!ArrayBuffer.isView(array)||typeof array.subarray!=='function'||typeof attribute.clone!=='function'||
      attribute.isGLBufferAttribute||attribute.data?.isInstancedInterleavedBuffer||
      attribute.isInstancedBufferAttribute&&!supported(attribute))return reject('unsupported-attribute',{
        name,type:attribute?.constructor?.name??null,arrayType:array?.constructor?.name??null,
        isInterleaved:attribute?.isInterleavedBufferAttribute===true,isInstanced:attribute?.isInstancedBufferAttribute===true,
        dataIsInstanced:attribute?.data?.isInstancedInterleavedBuffer===true});
  }
  if(geometry.index&&(!ArrayBuffer.isView(geometry.index.array)||typeof geometry.index.clone!=='function'||geometry.index.isGLBufferAttribute))return reject('unsupported-index');
  // HB clones mesh objects but shares their geometry. Own every geometry buffer
  // before rewriting instance attributes, so another map/replay stays intact.
  let ownedGeometry;try{ownedGeometry=geometry.clone();}catch{return reject('geometry-clone-failed');}
  if(!ownedGeometry||ownedGeometry===geometry)return reject('geometry-clone-alias');
  for(const[name,attribute]of Object.entries(geometry.attributes??{})){
    const cloned=ownedGeometry.attributes?.[name],array=attribute.isInterleavedBufferAttribute?attribute.data.array:attribute.array;
    const clonedArray=cloned?.isInterleavedBufferAttribute?cloned.data?.array:cloned?.array;
    if(!cloned||!clonedArray||clonedArray===array||clonedArray.buffer===array.buffer){ownedGeometry.dispose();return reject('attribute-clone-alias');}
  }
  if(geometry.index&&ownedGeometry.index?.array===geometry.index.array){ownedGeometry.dispose();return reject('index-clone-alias');}
  const attributes=[mesh.instanceMatrix,...(mesh.instanceColor?[mesh.instanceColor]:[]),
    ...Object.values(ownedGeometry.attributes).filter(attribute=>attribute.isInstancedBufferAttribute)];
  const streams=attributes.map(attribute=>({attribute,target:attribute.array,original:attribute.array.slice(),size:attribute.itemSize}));
  const metadata=[];
  for(const key of ['alInstanceNames','alInstanceMaterials']){
    const target=mesh.userData?.[key];
    if(Array.isArray(target)&&target.length>=count)metadata.push({target,original:target.slice()});
  }
  const originalWorld=Array.from(world),previousPlanes=new Float64Array(24).fill(NaN);
  let indices=new Uint32Array(count),scratch=new Uint32Array(count),visibleCount=count,full=true,disposed=false,disabled=false,havePlanes=false;
  for(let index=0;index<count;index++)indices[index]=index;
  let classifications=0,uploads=0;
  mesh.geometry=ownedGeometry;
  function dirty(attribute,length){
    // Hidden suffix data is unused until restore() uploads the complete prefix.
    attribute.clearUpdateRanges?.();
    if(length>0)attribute.addUpdateRange?.(0,length);
    attribute.needsUpdate=true;uploads++;
  }
  function apply(nextCount,selection){
    for(const stream of streams){
      if(!selection)stream.target.set(stream.original);
      else for(let index=0;index<nextCount;index++){
        const from=selection[index]*stream.size,to=index*stream.size;
        for(let component=0;component<stream.size;component++)stream.target[to+component]=stream.original[from+component];
      }
      if(nextCount>0)dirty(stream.attribute,nextCount*stream.size);
    }
    for(const stream of metadata)for(let index=0;index<nextCount;index++)stream.target[index]=stream.original[selection?selection[index]:index];
    mesh.count=nextCount;full=nextCount===count;
  }
  function restore(){if(disposed)return count;if(!full)apply(count,null);return count;}
  return {
    compact(planes){
      if(disposed||disabled)return count;
      let moved=false;for(let index=0;index<16;index++)if(mesh.matrixWorld.elements[index]!==originalWorld[index]){moved=true;break;}
      if(mesh.geometry!==ownedGeometry||mesh.material?.onBeforeCompile!==knownMaterialHook||mesh.matrixAutoUpdate!==false||!planes||planes.length!==6||moved){
        restore();disabled=true;return count;
      }
      let same=havePlanes;
      for(let plane=0;plane<6;plane++){
        const current=planes[plane],normal=current?.normal,offset=plane*4;
        if(!normal||!Number.isFinite(normal.x)||!Number.isFinite(normal.y)||!Number.isFinite(normal.z)||!Number.isFinite(current.constant)){restore();return count;}
        if(previousPlanes[offset]!==normal.x||previousPlanes[offset+1]!==normal.y||previousPlanes[offset+2]!==normal.z||previousPlanes[offset+3]!==current.constant)same=false;
      }
      if(same){if(full&&visibleCount<count)apply(visibleCount,indices);return visibleCount;}
      let nextCount=0;classifications++;
      next:for(let index=0;index<count;index++){
        const offset=index*4,x=sphereData[offset],y=sphereData[offset+1],z=sphereData[offset+2],radius=sphereData[offset+3];
        for(let plane=0;plane<6;plane++){
          const p=planes[plane],n=p.normal;
          if(n.x*x+n.y*y+n.z*z+p.constant < -radius)continue next;
        }
        scratch[nextCount++]=index;
      }
      let changed=nextCount!==visibleCount;
      if(!changed)for(let index=0;index<nextCount;index++)if(scratch[index]!==indices[index]){changed=true;break;}
      const old=indices;indices=scratch;scratch=old;visibleCount=nextCount;
      for(let plane=0;plane<6;plane++){
        const current=planes[plane],offset=plane*4;
        previousPlanes[offset]=current.normal.x;previousPlanes[offset+1]=current.normal.y;
        previousPlanes[offset+2]=current.normal.z;previousPlanes[offset+3]=current.constant;
      }
      havePlanes=true;
      if(changed||full&&nextCount<count)apply(nextCount,indices);
      return nextCount;
    },
    restore,
    stats:()=>({fullCount:count,visibleCount:mesh.count,trianglesPerInstance:vertices/3,classifications,uploads,disabled,disposed}),
    dispose(){
      if(disposed)return;restore();disposed=true;
      if(mesh.geometry===ownedGeometry)mesh.geometry=geometry;
      ownedGeometry.dispose();
    }
  };
}

function replaceOne(source,before,after,label){
  if(source.split(before).length!==2)throw Error('Instance visibility compaction version mismatch: '+label);
  return source.replace(before,after);
}

export function applyInstanceVisibilityCompactionPatch(sources,{minBatchTriangles=50000}={}){
  if(!Number.isFinite(minBatchTriangles)||minBatchTriangles<0)throw Error('Instance visibility compaction requires nonnegative finite minBatchTriangles');
  const output={...sources};let graphics=output['aQOfOAp-.js'];
  if(typeof graphics!=='string')throw Error('Instance visibility compaction missing graphics source');
  if(graphics.includes('__aimCreateInstanceCompactor'))throw Error('Instance visibility compaction already applied');
  const shaderPins=[
    ['function OT(n,e,t,i,s){','function QT(n,e,t,i,s){',['47a34dc5cf593e049b11c63e9c08b6a946c946c359bc359365d4278c797e5891']],
    ['function QT(n,e,t,i,s){','function Hh(n,e){',['5bf9d7dc32d74fd3dc6666bb4de50567922b44d41e51ced36594c0597e8669fe']],
    ['function xg(n,e,t){','const yg=',['6975056675590bb9c4dc23d29ef4b85969b373653b224f6aaafa2d795a9d67b0']],
    ['function pg(n,e){','function mg(',['678b84598fcdf53f9652fc180d76bc1ef6f152f48e28674b0db68c80510fb40c','c07d6fa91b1ee5830848dcc943a4d0a410ee68d65c1fe65af19b17e940782927']],
  ];
  for(const[start,end,hashes]of shaderPins){
    const at=graphics.indexOf(start),stop=graphics.indexOf(end,at+start.length);
    if(at<0||stop<=at||!hashes.includes(createHash('sha256').update(graphics.slice(at,stop)).digest('hex')))throw Error('Instance visibility compaction unknown map vertex material: '+start);
  }
  graphics=replaceOne(graphics,'const o=OT(n,e,t,i,s);return or.set(r,o),o}',
    'const o=OT(n,e,t,i,s);return __aimKnownStaticMapMaterials.set(o,o.onBeforeCompile),or.set(r,o),o}','known native lightmap material');
  graphics=replaceOne(graphics,'o.alphaTest>0&&IT(o,f),or.set(r,o),o}',
    'o.alphaTest>0&&IT(o,f),__aimKnownStaticMapMaterials.set(o,o.onBeforeCompile),or.set(r,o),o}','known native texture-array material');
  graphics=replaceOne(graphics,'function jB(n,e){',
    'const __aimKnownStaticMapMaterials=new WeakMap;const __aimCreateInstanceCompactor=('+createInstanceVisibilityCompactor.toString()+');function jB(n,e){let __aimCompactionEnabled=true;','map visibility factory');
  graphics=replaceOne(graphics,'for(const c of n.children){const l=c;l.isMesh&&t.push({object:c,bits:e?.bitsOf.get(c)??null,spheres:$B(l,i,s)})}',
    'for(const c of n.children){const l=c;if(l.isMesh){const entry={object:c,bits:e?.bitsOf.get(c)??null,spheres:$B(l,i,s)};entry.compactor=__aimCreateInstanceCompactor(l,entry.spheres,{minBatchTriangles:'+minBatchTriangles+',knownMaterialHook:__aimKnownStaticMapMaterials.get(l.material),onReject:(reason,detail)=>{entry.compactionRejection=reason;entry.compactionRejectionDetail=detail}});t.push(entry)}}','own static batch snapshots');
  graphics=replaceOne(graphics,'return{stats:o,update(c,l){if(l){for(const p of t)p.object.visible=!0;',
    `return{stats:o,setCompactionEnabled(value){__aimCompactionEnabled=!!value;if(!__aimCompactionEnabled)for(const entry of t)entry.compactor?.restore()},compactionStats(){
const result={enabled:__aimCompactionEnabled,eligibleBatches:0,visibleBatches:0,fullInstances:0,currentInstances:0,drawnFullInstances:0,drawnInstances:0,drawnFullTriangles:0,drawnTriangles:0,classifications:0,attributeUploads:0,disabledBatches:0,rejections:{},rejectionSamples:[]};
for(const entry of t){if(entry.compactionRejection)result.rejections[entry.compactionRejection]=(result.rejections[entry.compactionRejection]??0)+1;if(entry.compactionRejectionDetail&&result.rejectionSamples.length<8)result.rejectionSamples.push({batch:entry.object.name??null,reason:entry.compactionRejection,...entry.compactionRejectionDetail});const value=entry.compactor?.stats();if(!value||value.disposed)continue;
result.eligibleBatches++;result.fullInstances+=value.fullCount;result.currentInstances+=value.visibleCount;result.classifications+=value.classifications;result.attributeUploads+=value.uploads;result.disabledBatches+=value.disabled?1:0;
if(entry.object.visible){result.visibleBatches++;result.drawnFullInstances+=value.fullCount;result.drawnInstances+=value.visibleCount;result.drawnFullTriangles+=value.fullCount*value.trianglesPerInstance;result.drawnTriangles+=value.visibleCount*value.trianglesPerInstance}}
return result},dispose(){for(const p of t)p.compactor?.dispose()},update(c,l){if(l){for(const p of t){p.compactor?.restore();p.object.visible=!0}`, 'full shadow/prewarm visibility');
  graphics=replaceOne(graphics,'p.object.visible=g}o.pvsHidden=f,o.frustumHidden=d',
    'p.object.visible=g;g&&__aimCompactionEnabled&&p.compactor?.compact(h)}o.pvsHidden=f,o.frustumHidden=d','compact after native conservative PVS/frustum');
  graphics=replaceOne(graphics,'function uR(n,e){',
    'function uR(n,e){let __aimMapCompactionEnabled=true;','viewport-local diagnostic toggle');
  graphics=replaceOne(graphics,'setMapVisual(E){if(A&&i.remove(A),A=E,g=null,m=null,E)',
    'setMapVisual(E){m?.dispose?.();if(A&&i.remove(A),A=E,g=null,m=null,E)','map replacement releases owned geometry');
  graphics=replaceOne(graphics,'mapBatches(){return A?.children??[]},updateMapVisibility(E,x){',
    'mapBatches(){return A?.children??[]},setMapCompactionEnabled(E){__aimMapCompactionEnabled=!!E;m?.setCompactionEnabled?.(__aimMapCompactionEnabled)},mapCompactionStats:()=>m?.compactionStats?.()??null,updateMapVisibility(E,x){','viewport toggle and read-only batch compaction counters');
  graphics=replaceOne(graphics,'m=jB(E,g)}u(),f()',
    'm=jB(E,g),m.setCompactionEnabled(__aimMapCompactionEnabled)}u(),f()','map replacement retains the viewport-local toggle');
  graphics=replaceOne(graphics,'dispose(){i.clear(),p=null}}}function JD(n,e,t){',
    'dispose(){m?.dispose?.();i.clear(),p=null}}}function JD(n,e,t){','viewport disposal releases owned geometry');
  output['aQOfOAp-.js']=graphics;return output;
}
import {createHash} from 'node:crypto';

