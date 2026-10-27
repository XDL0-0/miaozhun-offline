// Query-only diagnostics. Collect every native render pass without resetting
// Three's frame counter or changing its skeleton/update caching behavior.
// This function is also serialized into the temporary training fixture.
export function beginTrainingRenderStats(renderer,{gpuTiming=true}={}) {
 const info=renderer?.info,render=info?.render,reset=info?.reset;
 if(!render||typeof reset!=='function')return {finish:()=>null};
 const totals={calls:0,triangles:0,points:0,lines:0};
 let calls=render.calls,triangles=render.triangles,points=render.points,lines=render.lines;
 const frame=render.frame;
 let resets=0,finished=false,result=null;
 const capture=()=>{
  totals.calls+=render.calls-calls;totals.triangles+=render.triangles-triangles;
  totals.points+=render.points-points;totals.lines+=render.lines-lines;
 };
 const baseline=()=>{calls=render.calls;triangles=render.triangles;points=render.points;lines=render.lines;};
 function observedReset(...args){
  capture();resets++;
  try{return reset.apply(this,args)}finally{baseline()}
 }
 // Samples are polled before this frame starts. They describe earlier complete
 // yd() command segments, never the current CPU frame or compositor work.
 const gpuSamplesMs=[];
 let gpuTimingSupported=false,gpuDisjoint=false,gpuQueryStarted=false,gpuTimingError=null;
 let gpuState=null,gpuQuery=null;
 const states=beginTrainingRenderStats.gpuStates??=new WeakMap();
 beginTrainingRenderStats.dispose??=function(renderer){const state=beginTrainingRenderStats.gpuStates?.get(renderer);state?.dispose();beginTrainingRenderStats.gpuStates?.delete(renderer);};
 const drop=(gl,query)=>{try{gl.deleteQuery(query)}catch{}};
 try{if(gpuTiming){
  const gl=renderer.getContext?.();
  if(gl){
   gpuState=states.get(renderer);
   if(gpuState&&gpuState.gl!==gl){gpuState.dispose();states.delete(renderer);gpuState=null;}
   if(!gpuState){
    const ext=gl.getExtension?.('EXT_disjoint_timer_query_webgl2')??null;
    gpuState={gl,ext,pending:[],active:null,invalidActive:false,failed:false,dispose(){
     if(this.active){try{if(gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)===this.active)gl.endQuery(ext.TIME_ELAPSED_EXT)}catch{}drop(gl,this.active);this.active=null;}
     for(const query of this.pending)drop(gl,query);this.pending.length=0;
    }};
    states.set(renderer,gpuState);
   }
   const {ext}=gpuState;
   gpuTimingSupported=!!ext&&['createQuery','beginQuery','endQuery','deleteQuery','getQuery','getQueryParameter','getParameter'].every(name=>typeof gl[name]==='function');
   if(gpuTimingSupported&&!gpuState.failed){
    if(gl.isContextLost?.()){gpuState.dispose();gpuTimingError='webgl-context-lost';}
    else{
     gpuDisjoint=!!gl.getParameter(ext.GPU_DISJOINT_EXT);
     if(gpuDisjoint){
      for(const query of gpuState.pending)drop(gl,query);gpuState.pending.length=0;
      gpuState.invalidActive=!!gpuState.active;
     }else{
      for(let index=0;index<gpuState.pending.length;){
       const query=gpuState.pending[index];
       if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){index++;continue;}
       const elapsed=gl.getQueryParameter(query,gl.QUERY_RESULT);
       if(Number.isFinite(elapsed)&&elapsed>=0)gpuSamplesMs.push(elapsed/1e6);
       drop(gl,query);gpuState.pending.splice(index,1);
      }
      // Do not nest another timer's TIME_ELAPSED query. A bounded queue also
      // prevents unready/failed drivers from retaining unbounded GPU objects.
      if(!gpuState.active&&gpuState.pending.length<64&&!gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){
       gpuQuery=gl.createQuery();
       if(gpuQuery){gpuState.active=gpuQuery;gl.beginQuery(ext.TIME_ELAPSED_EXT,gpuQuery);gpuState.invalidActive=false;gpuQueryStarted=true;}
      }
     }
    }
   }
  }}
 }catch(error){
  gpuTimingError=String(error?.message??error);gpuState&&(gpuState.failed=true,gpuState.dispose());
  gpuQuery=null;
 }
 info.reset=observedReset;
 return {finish(){
  if(finished)return result;
  finished=true;capture();
  if(info.reset===observedReset)info.reset=reset;
  if(gpuQuery&&gpuState.active===gpuQuery){
   const {gl,ext}=gpuState;
   try{
    if(gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)!==gpuQuery)throw Error('GPU timer query replaced during native render');
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    if(gpuState.invalidActive)drop(gl,gpuQuery);else gpuState.pending.push(gpuQuery);
    gpuState.active=null;
   }catch(error){gpuTimingError=String(error?.message??error);gpuState.failed=true;gpuState.dispose();}
  }
  result={...totals,renderPasses:render.frame-frame,counterResets:resets,autoReset:info.autoReset,gpuTimingSupported,gpuSamplesMs,gpuDisjoint,gpuQueryStarted,...(gpuTimingError?{gpuTimingError}:{})};
  return result;
 }};
}
