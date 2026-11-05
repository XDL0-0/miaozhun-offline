// The 2026-11-05 client keeps the existing localStorage and IndexedDB contracts.
// Do not rename, delete, or eagerly rewrite user data when upgrading. In
// particular, the retired drill/test history and quick-start keys have no
// equivalent in the new scene-based UI and must remain available to backups.
export const upstreamStorageCompatibility = Object.freeze({
  preservedLegacyKeys: Object.freeze(['al-drill-runs-v1', 'al-hall-quick-start-v1', 'al-test-history-v3']),
  replay: Object.freeze({database: 'aimlab-replay', stores: Object.freeze({index: 'id', blob: 'id'}), retainedLimit: 50}),
  studio: Object.freeze({database: 'aimlab-studio', stores: Object.freeze({draft: null, scenes: 'id'}), draftKey: 'current', ownerKey: 'current-owner'}),
  oldReplayPlayback: 'Native keyframe interpolation on engine-version mismatch or detected kernel/keyframe drift; both releases use p7, so old recordings need not immediately enter interpolation and deterministic re-simulation is not promised.',
});

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Upstream storage version mismatch: ${label}`);
  return source.replace(before, after);
}

export function applyUpstreamStoragePatch(modules) {
  const filename = 'BUMqqtoc.js';
  let editor = modules[filename];
  if (typeof editor !== 'string') throw new Error(`Upstream storage module missing: ${filename}`);
  if (editor.includes('__aimFlushBeforeLanguage')) throw new Error('Upstream storage patch already applied');

  // Port the verified old editor hook to the new StudioShell bindings. Blur
  // commits the focused field, nextTick drains Vue updates, and read-after-write
  // catches the native storage adapter's otherwise silent failed writes. The
  // language runtime must await this hook before persisting/reloading.
  const beforeAutosave = 'At(()=>a.doc,()=>{window.clearTimeout(cl),cl=window.setTimeout(()=>{Rd()},VL)},{deep:!0});';
  const flush = 'const __aimFlushBeforeLanguage=async()=>{document.activeElement?.blur();await Hn();window.clearTimeout(cl);const invalid=Xn(a.doc);if(invalid!==null)throw new Error(invalid);const snapshot=JSON.stringify(a.doc);await H.save(a.doc);const saved=await H.load();if(JSON.stringify(saved)!==snapshot)throw new Error("Draft was not saved");a.markClean();await Nd()};globalThis.__aimBeforeLanguageChange=__aimFlushBeforeLanguage;';
  editor = replaceOnce(editor, beforeAutosave, flush + beforeAutosave, 'save committed draft before language switch');
  editor = replaceOnce(editor, 'ko(()=>{window.removeEventListener("keydown",ec)',
    'ko(()=>{if(globalThis.__aimBeforeLanguageChange===__aimFlushBeforeLanguage)delete globalThis.__aimBeforeLanguageChange;window.removeEventListener("keydown",ec)',
    'remove only this editor language hook on unmount');
  return {...modules, [filename]: editor};
}
