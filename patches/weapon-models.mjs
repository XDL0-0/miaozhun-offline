function replaceOne(text,before,after,label){
  if(text.split(before).length!==2)throw new Error('Weapon model patch version mismatch: '+label);
  return text.replace(before,after);
}
export function applyWeaponModelsPatch(modules){
  const result={...modules};let view=result['CFqO0zvx.js'];
  if(typeof view!=='string'||view.includes('__aimAppearance'))throw new Error('Weapon viewmodel module missing or already patched');
  view=replaceOne(view,"return{'manifest':J,'blob':K,'gunTexture':N", "return{'stem':F,'appearance':await __aimLoadWeaponModel(F),'manifest':J,'blob':K,'gunTexture':N",'preload real models before native GPU prewarm');
  view=replaceOne(view,"function qn(J){const {manifest:P,blob:R}=J,", "function qn(J){let __aimAppearance=null;const {manifest:P,blob:R}=J,",'appearance ownership');
  view=replaceOne(view,"'setGun'(bf){if(!ay)return;const bg=bf==='ak47';ay['visible']=bg,af['visible']=!bg;}","'setGun'(bf){if(ay){const bg=bf==='ak47';ay['visible']=bg,af['visible']=!bg;}__aimAppearance?.setGun(bf);}",'skin and native model selection');
  view=replaceOne(view,"const bx=aO(bf,bg?.['detained']===!0x0);", "__aimAppearance?.update();const bx=aO(bf,bg?.['detained']===!0x0);",'one native animation clock');
  view=replaceOne(view,"'measureMuzzle'(bf='vandal'){a0['updateMatrixWorld']", "'measureMuzzle'(bf='vandal'){const skin=__aimAppearance?.measureMuzzle(a1);if(skin)return skin;a0['updateMatrixWorld']",'skin muzzle measurement');
  view=replaceOne(view,"'dispose'(){ab['geometry']['dispose'](),af['geometry']['dispose']()", "'dispose'(){__aimAppearance?.dispose();__aimAppearance=null;ab['geometry']['dispose'](),af['geometry']['dispose']()",'dispose skin GPU resources');
  view=replaceOne(view,"return bb;}export{Tn as a,qn as c,En as l};", "__aimAppearance=__aimCreateWeaponAppearance({types:{Group:p,Geometry:b,Attribute:c,Bone:w,Skeleton:t,SkinnedMesh:r,Mesh:d,Material:s,Texture:__aimWeaponTexture,Vector3:f,Quaternion:q,srgb:u,repeat:v},parent:ah,baseRig:ad,baseRest:P.gun.skeleton,originals:[af,ay,ao,ap,aq,av,aw,...as],stem:J.stem,initial:J.appearance,environment:ac});return bb;}export{Tn as a,qn as c,En as l};",'construct appearance with existing Three types');
  result['CFqO0zvx.js']='import{c3 as __aimWeaponTexture}from"./aQOfOAp-.js";import{loadWeaponModel as __aimLoadWeaponModel,createWeaponAppearance as __aimCreateWeaponAppearance}from"./aim-weapon-models.mjs";\n'+view;
  return result;
}
