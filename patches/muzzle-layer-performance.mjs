// Preserve particle simulation and native draw order. Layer participation must
// be decided after geometry emission, which can reject every particle.
export function applyMuzzleLayerPerformancePatch(sources) {
 const output={...sources};
 let training=output['CymPR-fm.js'];
 if(typeof training!=='string')throw Error('Muzzle layer performance patch missing training source');
 if(training.includes('__aimMuzzleVisibleLayers'))throw Error('Muzzle layer performance patch already applied');
 const start=training.indexOf('function qv(e){'),end=training.indexOf('function Zv(e,t,n,o,a){',start);
 if(start<0||end<=start)throw Error('Muzzle layer performance patch version mismatch: effect factory');
 let effect=training.slice(start,end);
 const replace=(before,after,label)=>{
  if(effect.split(before).length!==2)throw Error('Muzzle layer performance patch version mismatch: '+label);
  effect=effect.replace(before,after);
 };
 replace('it.mesh.renderOrder=D,it.mesh.visible=!0,Lt===q.lightScene?I.light=!0:I.flash=!0,fe=it,it.sink',
  'it.mesh.renderOrder=D,it.mesh.visible=!0,fe=it,it.sink','defer layer participation until emission ends');
 replace('B(Ie.sink,Me,ee),Me===0&&(Ie.mesh.visible=!1),fe=null',
  'B(Ie.sink,Me,ee),/*__aimMuzzleVisibleLayers__*/Me>0?(Ie.scene===q.lightScene?I.light=!0:I.flash=!0):(Ie.mesh.visible=!1),fe=null','mark only nonempty light and flash layers');
 output['CymPR-fm.js']=training.slice(0,start)+effect+training.slice(end);
 return output;
}
