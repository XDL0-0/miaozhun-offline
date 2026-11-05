import fs from 'node:fs';
import path from 'node:path';
import {applyInterpolationPatch} from '../../patches/interpolation.mjs';
import {applyFrameratePatch} from '../../patches/framerate.mjs';
import {applyPrewarmPatch} from '../../patches/prewarm.mjs';
import {applySkinPacksPatch} from '../../patches/skin-packs.mjs';
import {applyWeaponModelsPatch} from '../../patches/weapon-models.mjs';

const sourceNames=['CymPR-fm.js','aQOfOAp-.js','tmIeW3Ig.js','DCKWp-_u.js','DVK7uRSu.js','CFqO0zvx.js','index.C6F_bJRd.js'];
export const legacyPerformanceSourceFiles=Object.freeze(sourceNames.map(name=>new URL('../../site/js/'+name,import.meta.url)));
let modules;

// These diagnostics intentionally target the retained legacy engine. Assemble
// their real interpolation, readiness, skin-audio, and model bridge anchors in
// the same order as the legacy build, without reading or rebuilding dist, using
// temporary diagnostic backups, or requiring Git history. Other legacy build
// steps (assets, localization, map compaction, etc.) are outside these tests.
export function legacyPerformanceModules(){
  if(!modules){
    const source=Object.fromEntries(sourceNames.map((name,index)=>[name,fs.readFileSync(legacyPerformanceSourceFiles[index],'utf8')]));
    modules=Object.freeze([applyInterpolationPatch,applyFrameratePatch,applyPrewarmPatch,applySkinPacksPatch,applyWeaponModelsPatch]
      .reduce((current,apply)=>apply(current),source));
  }
  return modules;
}

// Only source-transform inputs are needed; this is not a deployable game copy.
export function writeLegacyPerformanceInput(directory){
  const source=legacyPerformanceModules();
  fs.mkdirSync(path.join(directory,'js'),{recursive:true});
  for(const name of ['CymPR-fm.js','CFqO0zvx.js','aQOfOAp-.js','index.C6F_bJRd.js'])
    fs.writeFileSync(path.join(directory,'js',name),source[name]);
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><html><head><script type="module" src="/js/index.C6F_bJRd.js"></script></head><body><div id="app"></div></body></html>');
  return directory;
}
