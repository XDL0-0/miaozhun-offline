// Every emitted frame rewrites a complete vertex prefix. Replacing pending
// ranges is safe even when the previous frame was culled: only the latest
// drawRange is consumed. Never clear a zero-count frame's pending ranges into
// an empty list, which Three interprets as a request for a full-buffer upload.
export function markMuzzleUploadRanges(slot, count) {
  if (count === 0) return;
  for (const attribute of slot.attrs) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }
  if (slot.mesh.material.userData.dyn === true) {
    const attribute = slot.dynAttr;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }
}

export function applyMuzzleUploadPerformancePatch(sources) {
  const output = {...sources};
  let source = output['CymPR-fm.js'];
  if (typeof source !== 'string') throw Error('Muzzle upload performance patch missing training source');
  if (source.includes('const __aimMuzzleUploadRanges=')) throw Error('Muzzle upload performance patch already applied');
  const generator = 'function Lv(e,t,n,o){let a=0;const s=new Float32Array(16),i=[0,0,0],l=[0,0,0],u=[0,0,0],r=[0,0,0],c=[0,0,0],p=[0,0,0],d=[0,0,0],h=[0,0,0],y=[0,0,0],f=[0,0,0],m=[0,0,0],x=[0,0,0],w=[0,0,0];for(const b of e){';
  if (source.split(generator).length !== 2) throw Error('Muzzle upload performance patch version mismatch: native particle generator');
  // Empty systems emit no particles or callbacks. Skip their scratch arrays
  // here so qv still hides old batches and completes its native render cleanup.
  source = source.replace(generator, generator.replace('{', '{if(e.length===0)return 0;'));
  const start = source.indexOf('function qv(e){'), end = source.indexOf('function Zv(e,t,n,o,a){', start);
  if (start < 0 || end <= start) throw Error('Muzzle upload performance patch version mismatch: effect factory');
  let effect = source.slice(start, end);
  const factory = 'q.frustumCulled=!1,q.matrixAutoUpdate=!1,{mesh:q,sink:{pos:K.array,uv:F.array,col:V.array,dyn:ne.array,capacity:ws},attrs:[K,F,V],dynAttr:ne,scene:null}';
  if (effect.split(factory).length !== 2) throw Error('Muzzle upload performance patch version mismatch: native batch state');
  const update = 'Ie.mesh.geometry.setDrawRange(0,Me);for(const We of Ie.attrs)We.needsUpdate=!0;Ie.mesh.material.userData.dyn===!0&&(Ie.dynAttr.needsUpdate=!0),B(Ie.sink,Me,ee)';
  if (effect.split(update).length !== 2) throw Error('Muzzle upload performance patch version mismatch: emitted batch uploads');
  effect = effect.replace(update, 'Ie.mesh.geometry.setDrawRange(0,Me);__aimMuzzleUploadRanges(Ie,Me),B(Ie.sink,Me,ee)');
  source = source.slice(0, start) + 'const __aimMuzzleUploadRanges=(' + markMuzzleUploadRanges.toString() + ');' + effect + source.slice(end);
  output['CymPR-fm.js'] = source;
  return output;
}
