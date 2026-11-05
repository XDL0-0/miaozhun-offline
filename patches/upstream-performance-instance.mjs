import {createHash} from 'node:crypto';
import {createInstanceVisibilityCompactor} from './instance-visibility-compaction.mjs';

const WORLD='CqM6URxy.js';

function requireOne(source,anchor,label){
  if(source.split(anchor).length!==2)throw Error('Upstream instance performance version mismatch: '+label);
}
function replaceOne(source,before,after,label){
  requireOne(source,before,label);return source.replace(before,after);
}

// Native KF clones retain the cache's geometry, material, atlas and depth material.
// The caller still owns the keep list for unmounted clones. Mounted viewports add
// a reference-counted lease so releaseMapAssets cannot dispose their resources.
function leaseMapVisual(root,leases){
  const name=root?.name;
  if(typeof name!=='string'||!name.startsWith('map:')||name.length===4)return()=>{};
  const id=name.slice(4);leases.set(id,(leases.get(id)??0)+1);let released=false;
  return()=>{if(released)return;released=true;const remaining=leases.get(id)-1;remaining>0?leases.set(id,remaining):leases.delete(id);};
}

export function applyUpstreamInstancePerformancePatch(modules,{minBatchTriangles=50000}={}){
  if(!Number.isFinite(minBatchTriangles)||minBatchTriangles<0)throw Error('Upstream instance performance requires nonnegative finite minBatchTriangles');
  const output={...modules};let world=output[WORLD];
  if(typeof world!=='string')throw Error('Upstream instance performance missing world source');
  if(world.includes('__aimCreateInstanceCompactor'))throw Error('Upstream instance performance already applied');

  // Only the audited, non-deforming native material hooks may lease a snapshot.
  // Pin their implementation, including the shared vertex and depth helpers.
  const shaderPins=[
    ['function aC(t){','function vL(t,e,n,i,r){','1d92d4e60c3a28e7ce0b614a52894495d1d006753479d68dd824850af11582dc'],
    ['function vL(t,e,n,i,r){','function _L(t,e,n,i,r){','dd418dd4902ca73388a68346910c51505a13a9a9ffbba1f93e0219697ebd8c77'],
    ['function _L(t,e,n,i,r){','function yf(t,e){','4bc1647d8cae1713c092d66074d40f10f64b0d2f47a9ccf3cad1c368395baac7'],
    ['function nC(t,e,n){','const iC=','457d908cb42bc924072df117c4c7056a5ef5f6dacffcdb3c890634d0fcc1e5d1'],
    ['function Kb(t,e){','function Jb(t,e){','cac2cd587b6ecc1953d985e30fa6f263da5162fda8807c8cde38b181408db930'],
    ['function AL(t,e){','function Zb(t){','7581fec97f04fb0078c00a3bcbcba4386ffb6b20ee4d1749c8e8e8ef591eae5e'],
  ];
  for(const[start,end,hash]of shaderPins){
    requireOne(world,start,'material start '+start);requireOne(world,end,'material end '+end);
    const at=world.indexOf(start),stop=world.indexOf(end,at+start.length);
    if(stop<=at||createHash('sha256').update(world.slice(at,stop)).digest('hex')!==hash)throw Error('Upstream instance performance unknown map vertex material: '+start);
  }
  requireOne(world,'o.name=`map:${t}`,o.updateMatrixWorld(!0)','native map resource identity');
  requireOne(world,'function KF(t){return SC(t).then(e=>{const n=e.clone(!0);return Zb(n),n})}','native shared map clone');
  world=replaceOne(world,'const o=vL(t,e,n,i,r);return eC(e,s,o),o}',
    'const o=vL(t,e,n,i,r);return __aimKnownStaticMapMaterials.set(o,o.onBeforeCompile),eC(e,s,o),o}','known native lightmap material');
  world=replaceOne(world,'o.alphaTest>0&&AL(o,f),eC(e,s,o),o}',
    'o.alphaTest>0&&AL(o,f),__aimKnownStaticMapMaterials.set(o,o.onBeforeCompile),eC(e,s,o),o}','known native texture-array material');
  world=replaceOne(world,'function sU(t,e){',
    'const __aimKnownStaticMapMaterials=new WeakMap;const __aimCreateInstanceCompactor=('+createInstanceVisibilityCompactor.toString()+');const __aimMapResourceLeases=new Map;const __aimLeaseMapVisual=('+leaseMapVisual.toString()+');function sU(t,e){let __aimCompactionEnabled=true;','map visibility factory');
  world=replaceOne(world,'for(const c of t.children){const l=c;l.isMesh&&n.push({object:c,bits:e?.bitsOf.get(c)??null,spheres:aU(l,i,r)})}',
    'for(const c of t.children){const l=c;if(l.isMesh){const entry={object:c,bits:e?.bitsOf.get(c)??null,spheres:aU(l,i,r)};entry.compactor=__aimCreateInstanceCompactor(l,entry.spheres,{minBatchTriangles:'+minBatchTriangles+',knownMaterialHook:__aimKnownStaticMapMaterials.get(l.material),onReject:(reason,detail)=>{entry.compactionRejection=reason;entry.compactionRejectionDetail=detail}});n.push(entry)}}','own static batch snapshots');
  world=replaceOne(world,'return{stats:o,update(c,l){if(l){for(const d of n)d.object.visible=!0;',
    `return{stats:o,setCompactionEnabled(value){__aimCompactionEnabled=!!value;if(!__aimCompactionEnabled)for(const entry of n)entry.compactor?.restore()},compactionStats(){
const result={enabled:__aimCompactionEnabled,eligibleBatches:0,visibleBatches:0,fullInstances:0,currentInstances:0,drawnFullInstances:0,drawnInstances:0,drawnFullTriangles:0,drawnTriangles:0,classifications:0,attributeUploads:0,disabledBatches:0,rejections:{},rejectionSamples:[]};
for(const entry of n){if(entry.compactionRejection)result.rejections[entry.compactionRejection]=(result.rejections[entry.compactionRejection]??0)+1;if(entry.compactionRejectionDetail&&result.rejectionSamples.length<8)result.rejectionSamples.push({batch:entry.object.name??null,reason:entry.compactionRejection,...entry.compactionRejectionDetail});const value=entry.compactor?.stats();if(!value||value.disposed)continue;
result.eligibleBatches++;result.fullInstances+=value.fullCount;result.currentInstances+=value.visibleCount;result.classifications+=value.classifications;result.attributeUploads+=value.uploads;result.disabledBatches+=value.disabled?1:0;
if(entry.object.visible){result.visibleBatches++;result.drawnFullInstances+=value.fullCount;result.drawnInstances+=value.visibleCount;result.drawnFullTriangles+=value.fullCount*value.trianglesPerInstance;result.drawnTriangles+=value.visibleCount*value.trianglesPerInstance}}
return result},dispose(){for(const d of n)d.compactor?.dispose()},update(c,l){if(l){for(const d of n){d.compactor?.restore();d.object.visible=!0}`, 'full shadow/prewarm visibility');
  world=replaceOne(world,'d.object.visible=m}o.pvsHidden=f,o.frustumHidden=h',
    'd.object.visible=m;m&&__aimCompactionEnabled&&d.compactor?.compact(A)}o.pvsHidden=f,o.frustumHidden=h','compact after native conservative PVS/frustum');
  world=replaceOne(world,'function bU(t,e){',
    'function bU(t,e){let __aimMapCompactionEnabled=true,__aimReleaseMapLease=null,__aimViewportDisposed=false;','viewport-local diagnostic toggle and lease');
  world=replaceOne(world,'setMapVisual(E){if(p&&i.remove(p),p=E,m=null,g=null,E)',
    'setMapVisual(E){g?.dispose?.();__aimReleaseMapLease?.();__aimReleaseMapLease=__aimLeaseMapVisual(E,__aimMapResourceLeases);if(p&&i.remove(p),p=E,m=null,g=null,E)','map replacement releases owned geometry and resources');
  world=replaceOne(world,'mapBatches(){return p?.children??[]},updateMapVisibility(E,y){',
    'mapBatches(){return p?.children??[]},setMapCompactionEnabled(E){__aimMapCompactionEnabled=!!E;g?.setCompactionEnabled?.(__aimMapCompactionEnabled)},mapCompactionStats:()=>g?.compactionStats?.()??null,updateMapVisibility(E,y){','viewport toggle and read-only counters');
  world=replaceOne(world,'g=sU(E,m)}u(),f()',
    'g=sU(E,m),g.setCompactionEnabled(__aimMapCompactionEnabled)}u(),f()','map replacement retains the viewport toggle');
  world=replaceOne(world,'dispose(){i.clear(),d=null}}}function O5(t,e,n){',
    'dispose(){if(__aimViewportDisposed)return;__aimViewportDisposed=true;g?.dispose?.();__aimReleaseMapLease?.();__aimReleaseMapLease=null;l.keyLight.shadow.dispose();l.dispose();i.environment=null;i.clear(),d=null}}}function O5(t,e,n){','viewport disposal releases owned geometry, lighting and resources');
  world=replaceOne(world,'if(e.has(r)||La.has(r)||Fa.has(r)||Sc.has(r))continue;Us.delete(r),Ns.delete(r);',
    'if(e.has(r)||__aimMapResourceLeases.has(r)||La.has(r)||Fa.has(r)||Sc.has(r))continue;Us.delete(r),Ns.delete(r);','active viewport resources survive native releaseMapAssets');
  output[WORLD]=world;return output;
}
