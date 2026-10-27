import crypto from 'node:crypto';

// Optional A/B transform. Keep the native union clear, mask and RT draws;
// only trim the two final composites to their own projected layer bounds.
const shaderHashes={
 Wv:'a5f236ccf12c99b67e9ee41fa500170f18e7f5d8caecb0b59b7dd344e98a9351',
 Gv:'00f40a560d7d216592d2eba9192e668e56a02b8d93a247db45185896008a1639',
 Iu:'3aedad959e6a04f470ef977770c6a2f50c0b74930597b952b52d877188a35b58',
};
function once(source,before,after,label){
 if(source.split(before).length!==2)throw Error('Muzzle composite scissor version mismatch: '+label);
 return source.replace(before,after);
}
export function applyMuzzleCompositeScissorPatch(sources){
 const output={...sources};let source=output['CymPR-fm.js'];
 if(typeof source!=='string')throw Error('Muzzle composite scissor missing training source');
 if(source.includes('__aimMuzzleCompositeBounds'))throw Error('Muzzle composite scissor already applied');
 for(const[name,hash]of Object.entries(shaderHashes)){
  const start=source.indexOf(name+'=`'),end=source.indexOf('`',start+name.length+2);
  if(start<0||end<0||crypto.createHash('sha256').update(source.slice(start+name.length+2,end)).digest('hex')!==hash)
   throw Error('Muzzle composite scissor version mismatch: neutral composite shader '+name);
 }
 const start=source.indexOf('function qv(e){'),end=source.indexOf('function Zv(e,t,n,o,a){',start);
 if(start<0||end<=start)throw Error('Muzzle composite scissor version mismatch: effect factory');
 let effect=source.slice(start,end);
 const bounds='const I={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0,light:!1,flash:!1};';
 effect=once(effect,bounds,bounds+
  'const __aimMuzzleCompositeBounds={light:{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},flash:{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0}},__aimMuzzleBoundsLayers=[__aimMuzzleCompositeBounds.light,__aimMuzzleCompositeBounds.flash],__aimMuzzleLightRect=[0,0,0,0],__aimMuzzleFlashRect=[0,0,0,0];let __aimMuzzleCompositeNear=false;','layer bounds ownership');
 const project=effect.indexOf('function B(S,K,F){'),rect=effect.indexOf('function U(S,K){',project),afterRect=effect.indexOf('const Y=new po',rect);
 if(project<0||rect<=project||afterRect<=rect)throw Error('Muzzle composite scissor version mismatch: native bounds helpers');
 let projection=effect.slice(project,rect);
 projection=once(projection,'function B(S,K,F){','function B(S,K,F,__aimBounds=I){','projection arguments');
 projection=projection.replaceAll('I.minX','__aimBounds.minX').replaceAll('I.minY','__aimBounds.minY').replaceAll('I.maxX','__aimBounds.maxX').replaceAll('I.maxY','__aimBounds.maxY');
 projection=once(projection,'if(W<=1e-6){','if(W<=1e-6){__aimMuzzleCompositeNear=true;','preserve near-camera fallback');
 let rectangle=effect.slice(rect,afterRect);
 rectangle=once(rectangle,'function U(S,K){','function U(S,K,__aimBounds=I,__aimOut=null){','rectangle arguments');
 rectangle=rectangle.replaceAll('I.minX','__aimBounds.minX').replaceAll('I.minY','__aimBounds.minY').replaceAll('I.maxX','__aimBounds.maxX').replaceAll('I.maxY','__aimBounds.maxY');
 rectangle=once(rectangle,'?[F,V,ne-F,q-V]:null',
  '?(__aimOut?(__aimOut[0]=F,__aimOut[1]=V,__aimOut[2]=ne-F,__aimOut[3]=q-V,__aimOut):[F,V,ne-F,q-V]):null','reuse layer rectangle arrays');
 effect=effect.slice(0,project)+projection+rectangle+effect.slice(afterRect);
 effect=once(effect,'I.minX=I.minY=1/0,I.maxX=I.maxY=-1/0,I.light=I.flash=!1;',
  '__aimMuzzleCompositeNear=false;for(const __aimBounds of __aimMuzzleBoundsLayers){__aimBounds.minX=__aimBounds.minY=1/0;__aimBounds.maxX=__aimBounds.maxY=-1/0}I.minX=I.minY=1/0,I.maxX=I.maxY=-1/0,I.light=I.flash=!1;','reset both bounds');
 effect=once(effect,'B(Ie.sink,Me,ee),','B(Ie.sink,Me,ee,Ie.scene===q.lightScene?__aimMuzzleCompositeBounds.light:__aimMuzzleCompositeBounds.flash),','one projection per native emitted vertex');
 effect=once(effect,'}),de=D;for(let Me=D;Me<k.length;Me++)',
  '}),de=D;I.minX=Math.min(__aimMuzzleCompositeBounds.light.minX,__aimMuzzleCompositeBounds.flash.minX);I.minY=Math.min(__aimMuzzleCompositeBounds.light.minY,__aimMuzzleCompositeBounds.flash.minY);I.maxX=Math.max(__aimMuzzleCompositeBounds.light.maxX,__aimMuzzleCompositeBounds.flash.maxX);I.maxY=Math.max(__aimMuzzleCompositeBounds.light.maxY,__aimMuzzleCompositeBounds.flash.maxY);for(let Me=D;Me<k.length;Me++)','recover native union bounds once');
 effect=once(effect,'if(!Me||!Ie)return;const We=S.getPixelRatio()||1;',
  'if(!Me||!Ie)return;let __aimLightComposite=Ie,__aimFlashComposite=Ie;'+
  // The UE black toe is nonzero only far below RGBA8 quantization. External
  // floating point targets retain their exact original union-scissor path.
  // Native finally restores only the test flag, leaving the union rectangle.
  // An already-scissored caller must therefore retain that same rectangle.
  'if(ze===null&&!tt&&I.light&&I.flash&&!__aimMuzzleCompositeNear){const __aimL=U(G.x,G.y,__aimMuzzleCompositeBounds.light,__aimMuzzleLightRect),__aimF=U(G.x,G.y,__aimMuzzleCompositeBounds.flash,__aimMuzzleFlashRect);if(__aimL&&__aimF){__aimLightComposite=__aimL;__aimFlashComposite=__aimF}}const We=S.getPixelRatio()||1;','main-output two-layer fast path');
 effect=once(effect,'S.autoClear=!1;try{',
  'let __aimMuzzleUnionRestore=null,__aimMuzzleUnionRatio=1;S.autoClear=!1;try{','native final union ownership');
 effect=once(effect,'const it=Lt=>{S.setRenderTarget(ze),S.setScissorTest(!0),S.setScissor(Ie[0]/We,Ie[1]/We,Ie[2]/We,Ie[3]/We),',
  'const it=Lt=>{const __aimRect=Lt===q.lightPass?__aimLightComposite:__aimFlashComposite;S.setRenderTarget(ze),S.setScissorTest(!0),S.setScissor(__aimRect[0]/We,__aimRect[1]/We,__aimRect[2]/We,__aimRect[3]/We),__aimRect!==Ie&&(__aimMuzzleUnionRestore=Ie,__aimMuzzleUnionRatio=We),','only final composite scissor');
 effect=once(effect,'finally{xe.scissorTest=!1,S.setRenderTarget(ze),S.setScissorTest(tt),',
  'finally{xe.scissorTest=!1,S.setRenderTarget(ze);if(__aimMuzzleUnionRestore)S.setScissor(__aimMuzzleUnionRestore[0]/__aimMuzzleUnionRatio,__aimMuzzleUnionRestore[1]/__aimMuzzleUnionRatio,__aimMuzzleUnionRestore[2]/__aimMuzzleUnionRatio,__aimMuzzleUnionRestore[3]/__aimMuzzleUnionRatio);S.setScissorTest(tt),','restore native final union after trimmed composites');
 output['CymPR-fm.js']=source.slice(0,start)+effect+source.slice(end);return output;
}
