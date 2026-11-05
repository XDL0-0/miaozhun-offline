// Reviewed 2026-11-05 actor renderer. Snapshot creation and retained poses stay
// native: the startup capture precedes Pm's warmup step and cannot share va.
const RENDERER='Do4sYkfr.js';

function once(source,before,after,label){
  const count=source.split(before).length-1;
  if(count!==1)throw Error(`Upstream render allocation version mismatch (${label}): expected 1, found ${count}`);
  return source.replace(before,after);
}

export function applyUpstreamRenderAllocationPatch(modules){
  let renderer=modules[RENDERER];
  if(typeof renderer!=='string')throw Error('Upstream render allocation missing actor renderer');
  if(renderer.includes('__aimActorIds'))throw Error('Upstream render allocation already applied');
  // et is pure scalar interpolation. Keep the same ce calls and their order,
  // but write their results directly instead of allocating a short-lived xyz.
  const interpolation='const et=(A,g,w)=>({x:ce(A.x,g.x,w),y:ce(A.y,g.y,w),z:ce(A.z,g.z,w)}),oi=';
  if(renderer.split(interpolation).length!==2)throw Error('Upstream render allocation version mismatch (scalar interpolation)');
  renderer=once(renderer,
    'function v0(A,g,w,D){const B=new Map;let C=-1,e=null,Q=null;',
    'function v0(A,g,w,D){const B=new Map,__aimActorIds=new Set;let C=-1,e=null,Q=null;',
    'renderer-local actor IDs');
  renderer=once(renderer,
    'C=M.tick;const p=new Set;for(const H of M.actors){',
    'C=M.tick;const p=__aimActorIds;p.clear();for(const H of M.actors){',
    'reuse actor ID scratch');
  renderer=once(renderer,
    'const $=et(x.previous,x.current,d);x.mesh.root.position.set($.x,$.y,$.z)',
    'x.mesh.root.position.set(ce(x.previous.x,x.current.x,d),ce(x.previous.y,x.current.y,d),ce(x.previous.z,x.current.z,d))',
    'actor interpolation output');
  renderer=once(renderer,
    'const T=et(e,Q,d);g.position.set(T.x,T.y,T.z);',
    'g.position.set(ce(e.x,Q.x,d),ce(e.y,Q.y,d),ce(e.z,Q.z,d));',
    'camera interpolation output');
  renderer=once(renderer,
    'B.clear(),C=-1,e=null,t=0,n=null,Q=null',
    'B.clear(),__aimActorIds.clear(),C=-1,e=null,t=0,n=null,Q=null',
    'release actor IDs on clear');
  return {...modules,[RENDERER]:renderer};
}
