// The simulation already supports timed reloads with unlimited ammunition.
// Let normal reload input reach it, so the HUD, weapon animation and replay
// share that simulation clock instead of adding a separate cosmetic action.
export function applyManualReloadPatch(modules) {
  const output = {...modules};
  const source = output['CymPR-fm.js'];
  const before = 'Us=()=>Tt?.limitedAmmo===!0||t.reloadAnyAmmo?.current===!0';
  const after = 'Us=()=>Xc(qe()).canFire';
  if (typeof source !== 'string') throw new Error('Manual reload patch module missing');
  if (source.includes(after)) throw new Error('Manual reload patch already applied');
  if (source.split(before).length !== 2) throw new Error('Manual reload patch version mismatch');
  output['CymPR-fm.js'] = source.replace(before, after);
  return output;
}
