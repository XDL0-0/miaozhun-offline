// Version-pinned world changes. Keep the retained client and all lighting values.
function replaceOne(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`World performance patch version mismatch: ${label}`);
  return source.replace(before, after);
}

export function applyWorldPerformancePatch(sources) {
  const output = {...sources};
  let graphics = output['aQOfOAp-.js'];
  let training = output['CymPR-fm.js'];
  if (typeof graphics !== 'string') throw new Error('World performance patch missing graphics source');
  if (typeof training !== 'string') throw new Error('World performance patch missing training source');
  if (graphics.includes('__aimLocalLightSelection')) throw new Error('World performance patch already applied');

  const begin = graphics.indexOf('function ew(n,e=Iu){');
  const end = graphics.indexOf('const tw=.45,', begin);
  if (begin < 0 || end < begin) throw new Error('World performance patch version mismatch: local lights');
  let lights = graphics.slice(begin, end);
  // Retain the source-order tie break of the native stable sort. Only the
  // brightest fixed number of slots is needed; avoid allocating a score object
  // for every map light and sorting the entire map after each movement threshold.
  lights = replaceOne(lights,
    'function l(h,u,f,d){const p=u.map(g=>({light:g,score:ZI(g,f)})).filter(g=>g.score>0).sort((g,m)=>m.score-g.score).slice(0,h.length);',
    `const __aimLocalLightSelection=[],__aimLocalLightScores=[];
function l(h,u,f,d){
const __aimLimit=h.length;let __aimCount=0;
for(const __aimLight of u){
 const __aimScore=ZI(__aimLight,f);if(!(__aimScore>0)||__aimLimit===0)continue;
 let __aimAt=__aimCount;
 if(__aimAt===__aimLimit){if(__aimScore<=__aimLocalLightScores[__aimAt-1])continue;__aimAt--}
 while(__aimAt>0&&__aimScore>__aimLocalLightScores[__aimAt-1]){
  __aimLocalLightSelection[__aimAt]=__aimLocalLightSelection[__aimAt-1];
  __aimLocalLightScores[__aimAt]=__aimLocalLightScores[__aimAt-1];__aimAt--;
 }
 __aimLocalLightSelection[__aimAt]=__aimLight;__aimLocalLightScores[__aimAt]=__aimScore;
 if(__aimCount<__aimLimit)__aimCount++;
}
__aimLocalLightSelection.length=__aimCount;__aimLocalLightScores.length=__aimCount;
const p=__aimLocalLightSelection;`, 'bounded stable local-light selection');
  lights = replaceOne(lights, 'const{light:E}=A;', 'const E=A;', 'selected source light');
  graphics = graphics.slice(0, begin) + lights + graphics.slice(end);

  // An inactive transparent canvas still spans the entire CSS viewport. Keep
  // its existing effect renderer, but remove that layer from compositing until
  // the native visibility conditions say that the effect has content to paint.
  const effectBegin = training.indexOf('function ym(e){');
  const effectEnd = training.indexOf('const gm=', effectBegin);
  if (effectBegin < 0 || effectEnd < effectBegin) throw new Error('World performance patch version mismatch: Jett screen effect');
  let effect = training.slice(effectBegin, effectEnd);
  effect = replaceOne(effect, 'pointerEvents:"none"}', 'pointerEvents:"none",display:"none"}', 'idle Jett canvas hidden initially');
  effect = replaceOne(effect,
    'r=()=>{!o||!n||(n.clearRect(0,0,t.width,t.height),o=!1)};',
    'r=()=>{!o||!n||(n.clearRect(0,0,t.width,t.height),o=!1);t.style.display!=="none"&&(t.style.display="none")};',
    'hide Jett canvas after its final clear');
  effect = replaceOne(effect,
    'if(n.clearRect(0,0,x,w),o=!0,m&&h)',
    'if(o||(t.style.display="block"),n.clearRect(0,0,x,w),o=!0,m&&h)',
    'show Jett canvas only when native effect draws');
  training = training.slice(0, effectBegin) + effect + training.slice(effectEnd);
  output['aQOfOAp-.js'] = graphics;
  output['CymPR-fm.js'] = training;
  return output;
}

// Optional A/B transform, intentionally separate from the production world
// patch until a real-browser comparison demonstrates a benefit. Zero timeout
// never requests a GPU wait; both Chromium entry points can share a status cache.
export function applyGpuFencePollingPatch(sources) {
  const output = {...sources};
  const graphics = output['aQOfOAp-.js'];
  if (typeof graphics !== 'string') throw new Error('GPU fence polling patch missing graphics source');
  if (graphics.includes('__aimFencePollStatus')) throw new Error('GPU fence polling patch already applied');
  output['aQOfOAp-.js'] = replaceOne(graphics,
    'if(!(n.getSyncParameter(o.sync,n.SYNC_STATUS)===n.SIGNALED)){if(e()-o.at<mw)break;s++}',
    `const __aimFencePollStatus=n.clientWaitSync(o.sync,0,0);
if(__aimFencePollStatus===n.WAIT_FAILED){
 i++;if(e()-o.at>=mw){s++;n.deleteSync(o.sync);r.shift()}return!1;
}
if(__aimFencePollStatus!==n.ALREADY_SIGNALED&&__aimFencePollStatus!==n.CONDITION_SATISFIED){if(e()-o.at<mw)break;s++}`,
    'nonblocking fence status polling');
  return output;
}

// Optional A/B transform. Split the large texture-array instance batches, which
// otherwise span the entire map. Keep the separate 48m small-mesh merge policy,
// the original PVS identities, and YT's material/atlas attribute construction.
export function applySpatialInstancingPatch(sources, {cellSize = 24, minBatchTriangles = 0} = {}) {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Spatial instancing patch requires a positive finite cellSize');
  if (!Number.isFinite(minBatchTriangles) || minBatchTriangles < 0) throw new Error('Spatial instancing patch requires a nonnegative finite minBatchTriangles');
  const output = {...sources};
  let graphics = output['aQOfOAp-.js'];
  if (typeof graphics !== 'string') throw new Error('Spatial instancing patch missing graphics source');
  if (graphics.includes('__aimSpatialWorld')) throw new Error('Spatial instancing patch already applied');
  graphics = replaceOne(graphics, 'for(const d of XT(l,o))n.add(d);',
    'for(const d of XT(l,o,n.matrixWorld))n.add(d);', 'spatial batch world transform');
  graphics = replaceOne(graphics, 'function XT(n,e){',
    'function XT(n,e,__aimSpatialWorld){', 'spatial batch transform argument');
  if (minBatchTriangles > 0) {
    // Threshold the final native batch rather than each input descriptor: the
    // texture-array merger can join several source materials into one draw.
    graphics = replaceOne(graphics, 'function XT(n,e,__aimSpatialWorld){',
      'function XT(n,e,__aimSpatialWorld){const __aimSpatialBatchTriangles=new Map;' +
      'for(const[o,c]of n){const l=o.matrices.length,f=l<=VT&&l*(So(o.geometry)/3)<=WT;' +
      'if(l>=2&&!f){const g=o.matrices[0].determinant()<0,m=`${o.geometry.uuid}|${c.key}|${g?"m":"+"}|${o.atlas??"-"}`;' +
      '__aimSpatialBatchTriangles.set(m,(__aimSpatialBatchTriangles.get(m)??0)+l*So(o.geometry)/3)}}',
      'native instance batch triangle totals');
  }
  const before = 'if(l>=2&&!f){const g=o.matrices[0].determinant()<0,m=`${o.geometry.uuid}|${c.key}|${g?"m":"+"}|${o.atlas??"-"}`;let A=i.get(m);A||(A={slot:c,atlas:o.atlas,items:[],castShadow:!1,receiveShadow:!1,geometry:o.geometry,mirrored:g},i.set(m,A));for(let E=0;E<l;E++)A.items.push(u(E));A.castShadow||=o.castShadow,A.receiveShadow||=o.receiveShadow;continue}';
  const selective = minBatchTriangles > 0 ?
    'const __aimSpatialBatchKey=`${o.geometry.uuid}|${c.key}|${o.matrices[0].determinant()<0?"m":"+"}|${o.atlas??"-"}`;' +
    'if(__aimSpatialBatchTriangles.get(__aimSpatialBatchKey)<' + minBatchTriangles + '){' + before.slice('if(l>=2&&!f){'.length, -1) + '}' : '';
  const after = 'if(l>=2&&!f){' + selective + 'o.geometry.boundingSphere||o.geometry.computeBoundingSphere();const g=o.matrices[0].determinant()<0;for(let E=0;E<l;E++){' +
    'r.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrices[E]).applyMatrix4(__aimSpatialWorld);' +
    'const __aimSpatialCell=`${Math.floor(r.x/' + cellSize + ')},${Math.floor(r.y/' + cellSize + ')},${Math.floor(r.z/' + cellSize + ')}`,' +
    'm=`${o.geometry.uuid}|${c.key}|${g?"m":"+"}|${o.atlas??"-"}|${__aimSpatialCell}`;' +
    'let A=i.get(m);A||(A={slot:c,atlas:o.atlas,items:[],castShadow:!1,receiveShadow:!1,geometry:o.geometry,mirrored:g},i.set(m,A));' +
    'A.items.push(u(E));A.castShadow||=o.castShadow,A.receiveShadow||=o.receiveShadow;}continue}';
  graphics = replaceOne(graphics, before, after, 'world-space large instance grouping');
  output['aQOfOAp-.js'] = graphics;
  return output;
}
