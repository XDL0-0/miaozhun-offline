// Query-only instrumentation for the retained JD viewport renderer. Never
// apply this transform in prepare-offline.mjs or a production build.
export function reportTrainingGraphicsPhase(name) {
  try {
    if (typeof window !== 'undefined') window.__offlineTrainingFixtureRegistry?.graphicsPhase?.(name);
  } catch {
    // An observer must not change rendering, including its exception path.
  }
}

function replaceOne(source, before, after, label) {
  if (source.split(before).length !== 2) throw Error('Training graphics phase version mismatch: ' + label);
  return source.replace(before, after);
}

export function applyTrainingGraphicsPhases(sources) {
  const output = {...sources};
  let graphics = output['aQOfOAp-.js'];
  if (typeof graphics !== 'string') throw Error('Training graphics phases missing graphics source');
  if (graphics.includes('__aimGraphicsPhase')) throw Error('Training graphics phases already applied');
  graphics = replaceOne(graphics, 'function JD(n,e,t){',
    'function JD(n,e,t){const __aimGraphicsPhase=(' + reportTrainingGraphicsPhase.toString() + ');', 'JD scope');
  const before = 'render(){r.updateLocalLights(r.camera.position);const I=c.shadowMap.enabled&&c.shadowMap.needsUpdate;r.updateMapVisibility(r.camera,I),c.render(r.scene,r.camera),I&&c.shadowMap.needsUpdate&&(c.shadowMap.needsUpdate=!1),_(),m?.(c,r.camera),g?.render(c,r.camera),g&&A?.(c,r.camera)}';
  const after = `render(){
__aimGraphicsPhase("localLights");
try{
 r.updateLocalLights(r.camera.position);
 const I=c.shadowMap.enabled&&c.shadowMap.needsUpdate;
 __aimGraphicsPhase("mapVisibility");r.updateMapVisibility(r.camera,I);
 __aimGraphicsPhase("worldDraw");c.render(r.scene,r.camera);
 I&&c.shadowMap.needsUpdate&&(c.shadowMap.needsUpdate=!1);_();
 __aimGraphicsPhase("worldOverlay");m?.(c,r.camera);
 __aimGraphicsPhase("viewModelDraw");g?.render(c,r.camera);
 __aimGraphicsPhase("viewModelOverlay");g&&A?.(c,r.camera);
}finally{__aimGraphicsPhase(null)}
}`;
  graphics = replaceOne(graphics, before, after, 'JD.render body');
  graphics = replaceOne(graphics, 'gpuReady:()=>l?.ready()??!0,sceneTarget()',
    'gpuReady:()=>l?.ready()??!0,gpuBackpressureStats:()=>l?.stats()??null,sceneTarget()', 'read-only fence counters');
  output['aQOfOAp-.js'] = graphics;
  return output;
}
