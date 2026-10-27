// Native additive tracer/impact effects keep their simulation, geometry and
// blend/depth settings. Recycle their short-lived presentation objects instead
// of allocating/discarding materials and atlas textures on every shot.
function once(source,before,after,label){
 if(source.split(before).length!==2)throw Error('Impact/tracer pool version mismatch: '+label);
 return source.replace(before,after);
}
function section(source,begin,end,patch){
 const at=source.indexOf(begin),stop=source.indexOf(end,at+begin.length);
 if(at<0||stop<=at)throw Error('Impact/tracer pool version mismatch: '+begin);
 return source.slice(0,at)+patch(source.slice(at,stop))+source.slice(stop);
}

export function applyImpactTracerPoolingPatch(sources){
 const output={...sources};let training=output['CymPR-fm.js'];
 if(typeof training!=='string')throw Error('Impact/tracer pool missing training source');
 if(training.includes('__aimTracerPool')||training.includes('__aimImpactPool'))throw Error('Impact/tracer pool already applied');
 training=section(training,'function Lh(e,t){','const mn=',body=>{
  body=once(body,'function Lh(e,t){let n=null;',
   'function Lh(e,t){const __aimTracerPool=[],__aimTracerAll=new Set,__aimTracerOrigin=new Pe;let __aimTracerDisposed=false,n=null;', 'tracer ownership');
  body=once(body,'v=>{v.colorSpace=ya,n=v;for(const A of a)A.mesh.material.map=v}',
   'v=>{if(__aimTracerDisposed){v.dispose();return}v.colorSpace=ya,n=v;for(const A of __aimTracerAll){A.mesh.material.map=v;A.mesh.material.needsUpdate=true}}','tracer image completion');
  body=once(body,'w=v=>{e.remove(v.mesh),v.mesh.material.dispose()}',
   'w=v=>{e.remove(v.mesh);v.mesh.visible=false;if(!__aimTracerDisposed&&__aimTracerPool.length<64)__aimTracerPool.push(v);else{__aimTracerAll.delete(v);v.mesh.material.dispose()}}','tracer release');
  body=once(body,'depthWrite:!1,depthTest:!1});return{spawn(v,A,z){',
   `depthWrite:!1,depthTest:!1});
function __aimMakeTracer(){const entry={mesh:new yt(o,M()),from:new Pe,dir:new Pe,span:0,impactAge:0,dieAge:0,bornTick:0};__aimTracerAll.add(entry);return entry}
function __aimTakeTracer(){const entry=__aimTracerPool.pop()??__aimMakeTracer();entry.mesh.visible=true;entry.mesh.frustumCulled=true;entry.mesh.material.opacity=rt.alpha;return entry}
return{spawn(v,A,z){if(__aimTracerDisposed)return;`, 'tracer allocation');
  body=once(body,'const g=s.clone().addScaledVector(d,f.x)',
   'const g=__aimTracerOrigin.copy(s).addScaledVector(d,f.x)','tracer origin scratch');
  body=once(body,'C={mesh:new yt(o,M()),from:g,dir:l.clone(),span:O,impactAge:k,dieAge:Math.min(rt.lifeSeconds,k+rt.postImpactSeconds),bornTick:z};C.mesh.renderOrder=9',
   'C=__aimTakeTracer();C.from.copy(g),C.dir.copy(l),C.span=O,C.impactAge=k,C.dieAge=Math.min(rt.lifeSeconds,k+rt.postImpactSeconds),C.bornTick=z,C.mesh.renderOrder=9','tracer live fields');
  body=once(body,'warmUp(){return[new yt(o,M())]},',
   'warmUp(){if(__aimTracerDisposed)return[];while(__aimTracerAll.size<16)__aimTracerPool.push(__aimMakeTracer());for(const entry of __aimTracerPool)entry.mesh.visible=true;return __aimTracerPool.map(entry=>entry.mesh)},','tracer preparation');
  body=once(body,'update(v){a=a.filter(A=>{const z=Math.max(0,(v-A.bornTick)*he);if(z>=A.dieAge)return w(A),!1;const g=Math.min(rt.speedMs*z,A.span),_=Math.max(0,g-rt.lengthM),O=z<=A.impactAge?1:Math.max(0,1-(z-A.impactAge)/(rt.postImpactSeconds*rt.postImpactFade));return A.mesh.material.opacity=rt.alpha*O,b(A,g,_,Math.min(1,z/rt.lifeSeconds)),!0})}',
   'update(v){let count=0;for(let index=0;index<a.length;index++){const A=a[index],z=Math.max(0,(v-A.bornTick)*he);if(z>=A.dieAge){w(A);continue}const g=Math.min(rt.speedMs*z,A.span),_=Math.max(0,g-rt.lengthM),O=z<=A.impactAge?1:Math.max(0,1-(z-A.impactAge)/(rt.postImpactSeconds*rt.postImpactFade));A.mesh.material.opacity=rt.alpha*O,b(A,g,_,Math.min(1,z/rt.lifeSeconds)),a[count++]=A}a.length=count}', 'tracer update compaction');
  body=once(body,'dispose(){for(const v of a)w(v);a=[],o.dispose(),n?.dispose()}',
   'dispose(){if(__aimTracerDisposed)return;__aimTracerDisposed=true;for(const v of __aimTracerAll){v.mesh.removeFromParent();v.mesh.material.dispose()}__aimTracerAll.clear(),__aimTracerPool.length=0,a=[],o.dispose(),n?.dispose()}', 'tracer final disposal');
  return body;
 });
 training=section(training,'function Oh(e,t){','const Nh=',body=>{
  body=once(body,'function Oh(e,t){let n=null;',
   'function Oh(e,t){const __aimImpactPool=[],__aimImpactAll=new Set,__aimImpactAtlas=[];let __aimImpactDisposed=false,n=null;', 'impact ownership');
  body=once(body,'d=>{n=d;for(const h of s)u(h.star,h.seed)}',
   'd=>{if(__aimImpactDisposed){d.dispose();return}n=d;for(let frame=0;frame<nn*nn;frame++)__aimImpactFrame(frame);for(const h of __aimImpactAll)u(h.star,h.seed)}','impact image completion');
  body=once(body,'l=d=>{e.remove(d.star),e.remove(d.glow),d.star.material.map?.dispose(),d.star.material.dispose(),d.glow.material.dispose()}',
   'l=d=>{e.remove(d.star),e.remove(d.glow);d.star.visible=d.glow.visible=false;if(!__aimImpactDisposed&&__aimImpactPool.length<64)__aimImpactPool.push(d);else{__aimImpactAll.delete(d);d.star.material.dispose(),d.glow.material.dispose()}}','impact release');
  body=once(body,'u=(d,h)=>{if(!n)return;const y=n.clone(),f=Math.floor(xl(h,1)*nn*nn)%(nn*nn);y.repeat.set(1/nn,1/nn),y.offset.set(f%nn/nn,Math.floor(f/nn)/nn),y.needsUpdate=!0,d.material.map?.dispose(),d.material.map=y,d.material.needsUpdate=!0}',
   'u=(d,h)=>{if(!n)return;const f=Math.floor(xl(h,1)*nn*nn)%(nn*nn),y=__aimImpactFrame(f),hadMap=!!d.material.map;d.material.map=y;if(!hadMap)d.material.needsUpdate=true}', 'impact atlas texture sharing');
  body=once(body,'d.glow.material.opacity=mn.glowAlpha*m};return{warmUp:()=>{const d=r(n??null,1),h=r(a,1);return[d,h]},spawn(d,h,y){if(!bd())return;const f=Fh(y,d),m=r(null,1),x=r(a,mn.glowAlpha);m.renderOrder=12,x.renderOrder=11,u(m,f)',
   `d.glow.material.opacity=mn.glowAlpha*m};
function __aimImpactFrame(frame){let texture=__aimImpactAtlas[frame];if(!texture&&n){texture=n.clone();texture.repeat.set(1/nn,1/nn);texture.offset.set(frame%nn/nn,Math.floor(frame/nn)/nn);texture.needsUpdate=true;__aimImpactAtlas[frame]=texture}return texture??null}
function __aimMakeImpact(){const entry={star:r(null,1),glow:r(a,mn.glowAlpha),zone:'body',roll:0,seed:0,bornTick:0};entry.star.renderOrder=12;entry.glow.renderOrder=11;__aimImpactAll.add(entry);u(entry.star,entry.seed);return entry}
return{warmUp:()=>{if(__aimImpactDisposed)return[];while(__aimImpactAll.size<16)__aimImpactPool.push(__aimMakeImpact());return __aimImpactPool.flatMap(entry=>{entry.star.visible=entry.glow.visible=true;return[entry.star,entry.glow]})},spawn(d,h,y){if(__aimImpactDisposed||!bd())return;const f=Fh(y,d),w=__aimImpactPool.pop()??__aimMakeImpact(),m=w.star,x=w.glow;m.visible=x.visible=true;m.frustumCulled=x.frustumCulled=true;u(m,f)`, 'impact allocation and preparation');
  body=once(body,'const w={star:m,glow:x,zone:h,roll:xl(f,2)*Math.PI*2,seed:f,bornTick:y};s.push(w),c(w,0)',
   'w.zone=h,w.roll=xl(f,2)*Math.PI*2,w.seed=f,w.bornTick=y,s.push(w),c(w,0)','impact live fields');
  body=once(body,'update(d){s=s.filter(h=>{const y=(d-h.bornTick)*he,f=mn.lifeSeconds[h.zone];return y>=f?(l(h),!1):(c(h,y/f),!0)})}',
   'update(d){let count=0;for(let index=0;index<s.length;index++){const h=s[index],y=(d-h.bornTick)*he,f=mn.lifeSeconds[h.zone];if(y>=f){l(h);continue}c(h,y/f),s[count++]=h}s.length=count}', 'impact update compaction');
  body=once(body,'dispose(){for(const d of s)l(d);s=[],o.dispose(),a.dispose(),n?.dispose()}',
   'dispose(){if(__aimImpactDisposed)return;__aimImpactDisposed=true;for(const d of __aimImpactAll){d.star.removeFromParent(),d.glow.removeFromParent(),d.star.material.dispose(),d.glow.material.dispose()}__aimImpactAll.clear(),__aimImpactPool.length=0,s=[];for(const texture of __aimImpactAtlas)texture?.dispose();__aimImpactAtlas.length=0,o.dispose(),a.dispose(),n?.dispose()}', 'impact final disposal');
  return body;
 });
 output['CymPR-fm.js']=training;return output;
}
