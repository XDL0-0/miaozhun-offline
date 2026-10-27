// Optional A/B transform. Keep native emitter generation and each emitter's
// capacity decision, then join only consecutive draws that have identical state.
// Do not batch at begin(): exposing the remaining capacity would truncate a
// later emitter differently from the retained particle renderer.
export function coalesceMuzzleBatches(slots, used, capacity) {
  let previous = null, previousCount = 0, merged = 0;
  for (let index = 0; index < used; index++) {
    const slot = slots[index], mesh = slot.mesh, geometry = mesh.geometry;
    const count = geometry.drawRange.count;
    if (!mesh.visible || count === 0) continue;
    // Native qv meshes have unindexed triangle buffers, one material, identity
    // transforms and forceSinglePass ShaderMaterials. Refuse broader states.
    if (!Number.isFinite(count) || count < 0 || geometry.drawRange.start !== 0 || geometry.index != null ||
        geometry.groups?.length || mesh.material?.forceSinglePass === false) {
      previous = null;
      continue;
    }
    if (previous && previous.scene === slot.scene &&
        previous.mesh.material === mesh.material &&
        previousCount + count <= capacity) {
      previous.sink.pos.set(slot.sink.pos.subarray(0, count * 3), previousCount * 3);
      previous.sink.uv.set(slot.sink.uv.subarray(0, count * 2), previousCount * 2);
      previous.sink.col.set(slot.sink.col.subarray(0, count * 4), previousCount * 4);
      previous.sink.dyn.set(slot.sink.dyn.subarray(0, count * 4), previousCount * 4);
      previousCount += count;
      previous.mesh.geometry.setDrawRange(0, previousCount);
      for (const attribute of previous.attrs) attribute.needsUpdate = true;
      if (previous.mesh.material.userData.dyn === true) previous.dynAttr.needsUpdate = true;
      mesh.visible = false;
      geometry.setDrawRange(0, 0);
      merged++;
    } else {
      previous = slot;
      previousCount = count;
    }
  }
  return merged;
}

export function applyMuzzleBatchPerformancePatch(sources) {
  const output = {...sources};
  let source = output['CymPR-fm.js'];
  if (typeof source !== 'string') throw Error('Muzzle batch performance patch missing training source');
  if (source.includes('__aimCoalesceMuzzleBatches')) throw Error('Muzzle batch performance patch already applied');
  const start = source.indexOf('function qv(e){'), end = source.indexOf('function Zv(e,t,n,o,a){', start);
  if (start < 0 || end <= start) throw Error('Muzzle batch performance patch version mismatch: effect factory');
  let effect = source.slice(start, end);
  const nativeFactory = 'q.frustumCulled=!1,q.matrixAutoUpdate=!1,{mesh:q,sink:{pos:K.array,uv:F.array,col:V.array,dyn:ne.array,capacity:ws},attrs:[K,F,V],dynAttr:ne,scene:null}';
  if (effect.split(nativeFactory).length !== 2) throw Error('Muzzle batch performance patch version mismatch: native batch state');
  const anchor = '}),de=D;for(let Me=D;Me<k.length;Me++)';
  if (effect.split(anchor).length !== 2) throw Error('Muzzle batch performance patch version mismatch: completed native emitter batches');
  effect = effect.replace(anchor, '}),de=D;__aimCoalesceMuzzleBatches(k,D,ws);for(let Me=D;Me<k.length;Me++)');
  source = source.slice(0, start) + 'const __aimCoalesceMuzzleBatches=(' + coalesceMuzzleBatches.toString() + ');' + effect + source.slice(end);
  output['CymPR-fm.js'] = source;
  return output;
}
