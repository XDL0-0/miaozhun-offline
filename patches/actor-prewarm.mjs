// Reserve real first-wave actor instances without stepping the simulation/RNG.
export function actorWarmCounts(doc){
  const counts=new Map(),add=(id,count)=>{if(typeof id==='string'&&id)counts.set(id,(counts.get(id)??0)+count);};
  for(const spawner of doc.spawners??[])add(spawner.actorTemplateId,Number.isFinite(spawner.maxAlive)?Math.max(0,Math.floor(spawner.maxAlive)):1);
  // A dispatcher may pick any route repeatedly. Reserve its entire simultaneous
  // capacity for each candidate template, matching native j8's 1..8 bound.
  for(const dispatcher of doc.dispatchers??[]){
    const capacity=Math.max(1,Math.min(8,Number.isFinite(dispatcher.maxAlive)?Math.floor(dispatcher.maxAlive):1));
    for(const id of new Set((dispatcher.routes??[]).map(route=>route.templateId)))add(id,capacity);
  }
  for(const actor of doc.actors??[])if(!counts.has(actor.id))counts.set(actor.id,1);
  return counts;
}

export function createActorWarmPool(plan=actorWarmCounts){
  const states=new WeakMap();
  function restore(entry){for(const [mesh,culled]of entry.frustum)mesh.frustumCulled=culled;entry.frustum.length=0;}
  function detach(entry){entry.mesh.root.parent?.remove(entry.mesh.root);}
  function dispose(entry){restore(entry);detach(entry);entry.mesh.skin?.skeleton?.dispose();}
  return {
    reserve(scene,doc){
      let state=states.get(scene);if(!state){state={available:new Map(),closed:false};states.set(scene,state);}
      const pending=[],counts=plan(doc);let committed=false,finished=false;
      try{
        for(const [id,template]of scene.actorTemplates){
          const needed=Math.max(0,(counts.get(id)??1)-(state.available.get(id)?.length??0));
          for(let i=0;i<needed;i++){
            const mesh=template.spawn(),entry={id,mesh,frustum:[]};pending.push(entry);
            mesh.root.traverse?.(node=>{if(node.isMesh)entry.frustum.push([node,node.frustumCulled]);});
          }
        }
      }catch(error){for(const entry of pending)dispose(entry);throw error;}
      return {
        roots:pending.map(entry=>entry.mesh.root),
        commit(){
          if(finished)return;
          if(state.closed)throw Error('Actor warm pool scene disposed');
          for(const entry of pending){
            restore(entry);detach(entry);
            let list=state.available.get(entry.id);if(!list){list=[];state.available.set(entry.id,list);}list.push(entry);
          }
          committed=true;finished=true;
        },
        dispose(){
          if(committed||finished)return;finished=true;
          for(const entry of pending)dispose(entry);
        }
      };
    },
    take(scene,id){
      const state=states.get(scene);if(!state||state.closed)return null;
      const entry=state.available.get(id)?.pop();return entry?.mesh??null;
    },
    release(scene){
      const state=states.get(scene);if(!state)return;state.closed=true;states.delete(scene);
      for(const list of state.available.values())for(const entry of list)dispose(entry);
      state.available.clear();
    }
  };
}

function once(source,before,after,label){
  const count=source.split(before).length-1;
  if(count!==1)throw Error(`Actor-prewarm patch ${label}: expected 1 anchor, found ${count}`);
  return source.replace(before,after);
}

export function applyActorPrewarmPatch(sources){
  let renderer=sources['tmIeW3Ig.js'],training=sources['CymPR-fm.js'];
  if(typeof renderer!=='string'||typeof training!=='string')throw Error('Actor-prewarm patch: missing renderer/training module');
  if(renderer.includes('__aimActorWarmPool')||training.includes('__aimReserveActorWarmPool'))throw Error('Actor-prewarm patch already applied');
  renderer=once(renderer,'function Qn(A,g){const D=A.actorTemplates.get(g);return D?D.spawn():null}',
    'function Qn(A,g){const D=A.actorTemplates.get(g);return D?__aimActorWarmPool.take(A,g)??D.spawn():null}',
    'consume retained first-wave instance');
  renderer=once(renderer,'return{root:w,blocks:B,actorTemplates:I,fog:o,dispose(){w.clear(),B.clear(),I.clear(),D.dispose(),E?.dispose()}}',
    'return{root:w,blocks:B,actorTemplates:I,fog:o,dispose(){__aimActorWarmPool.release(this);w.clear(),B.clear(),I.clear(),D.dispose(),E?.dispose()}}',
    'scene pool disposal');
  renderer=once(renderer,'s=n=>{for(const G of n.mesh.parts)G.material.dispose();A.root.remove(n.mesh.root)};',
    's=n=>{n.mesh.skin?.skeleton?.dispose();for(const G of n.mesh.parts)G.material.dispose();A.root.remove(n.mesh.root)};',
    'active actor skeleton ownership');
  renderer=once(renderer,'clear(){for(const n of B.values())s(n);B.clear(),C=-1',
    'clear(){for(const n of B.values())s(n);__aimActorWarmPool.release(A);B.clear(),C=-1',
    'renderer pool disposal');
  renderer=once(renderer,'apply(n,G,h,U){e.length=0;',
    'warmActors(renderer){for(const entry of B.values()){const skeleton=entry.mesh.skin?.skeleton;if(!skeleton)continue;if(skeleton.boneTexture===null)skeleton.computeBoneTexture();skeleton.update();renderer.initTexture(skeleton.boneTexture)}},apply(n,G,h,U){e.length=0;',
    'existing preview actor bone uploads');
  renderer=`const __aimActorWarmCounts=(${actorWarmCounts.toString()});const __aimActorWarmPool=(${createActorWarmPool.toString()})(__aimActorWarmCounts);export const __aimReserveActorWarmPool=(scene,doc)=>__aimActorWarmPool.reserve(scene,doc);\n`+renderer;
  training=once(training,'const built=Nt,roots=[],skeletons=[];\n try{for(const template of built.actorTemplates.values()){const copy=template.spawn();roots.push(copy.root);if(copy.skin?.skeleton)skeletons.push(copy.skin.skeleton)}',
    'const built=Nt,roots=[],reservation=__aimReserveActorWarmPool(built,E);\n try{roots.push(...reservation.roots);',
    'retain first-wave warm roots');
  training=once(training,'roots,ctx.generation);ctx.check();\n }finally{for(const skeleton of skeletons)skeleton.dispose()}',
    'roots,ctx.generation);ctx.check();cn?.warmActors(i.renderer);reservation.commit();\n }finally{reservation.dispose()}',
    'commit GPU-ready actors or release cancelled batch');
  training='import{__aimReserveActorWarmPool}from"./tmIeW3Ig.js";\n'+training;
  return {...sources,'tmIeW3Ig.js':renderer,'CymPR-fm.js':training};
}
