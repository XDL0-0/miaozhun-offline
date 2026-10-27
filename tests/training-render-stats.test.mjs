import test from 'node:test';
import assert from 'node:assert/strict';
import {beginTrainingRenderStats} from '../scripts/training-render-stats.mjs';
const unsupported={gpuTimingSupported:false,gpuSamplesMs:[],gpuDisjoint:false,gpuQueryStarted:false};

function fixture(autoReset=true){
 const render={frame:10,calls:123,triangles:456,points:7,lines:8};
 const info={render,autoReset,reset(){assert.equal(this,info);Object.assign(render,{calls:0,triangles:0,points:0,lines:0});return 42;}};
 const reset=info.reset;
 const draw=({calls=1,triangles=0,points=0,lines=0}={})=>{render.calls+=calls;render.triangles+=triangles;render.points+=points;render.lines+=lines;};
 const pass=callback=>{render.frame++;if(info.autoReset)info.reset();callback();};
 return {renderer:{info},info,render,reset,draw,pass};
}

test('native multi-pass counters include every pass without changing reset or frame behavior',()=>{
 const f=fixture(),probe=beginTrainingRenderStats(f.renderer);
 f.pass(()=>f.draw({calls:1200,triangles:800000}));
 f.pass(()=>{f.draw({triangles:3000});f.draw({points:40,lines:12});});
 f.pass(()=>f.draw({calls:3,triangles:2}));
 const nativeEnd={...f.render},result=probe.finish();
 assert.deepEqual(result,{calls:1205,triangles:803002,points:40,lines:12,renderPasses:3,counterResets:3,autoReset:true,...unsupported});
 assert.equal(f.info.reset,f.reset);assert.equal(f.info.autoReset,true);
 assert.deepEqual(f.render,nativeEnd,'Collector must leave the final native pass counters intact');
 assert.equal(f.render.frame,13);assert.equal(f.render.calls,3);
 assert.equal(probe.finish(),result,'Finishing twice must not double-count');
});

test('autoReset=false accumulates deltas across frames while leaving skeleton frame keys native',()=>{
 const f=fixture(false),first=beginTrainingRenderStats(f.renderer);
 f.pass(()=>f.draw({triangles:100}));f.pass(()=>f.draw({points:5}));
 assert.deepEqual(first.finish(),{calls:2,triangles:100,points:5,lines:0,renderPasses:2,counterResets:0,autoReset:false,...unsupported});
 const second=beginTrainingRenderStats(f.renderer);
 f.pass(()=>f.draw({lines:4}));
 assert.deepEqual(second.finish(),{calls:1,triangles:0,points:0,lines:4,renderPasses:1,counterResets:0,autoReset:false,...unsupported});
 assert.equal(f.render.frame,13);assert.equal(f.render.calls,126);assert.equal(f.render.triangles,556);
 assert.equal(f.info.reset,f.reset);assert.equal(f.info.autoReset,false);
});

test('explicit reset return and exception identity survive and no-op frames report zero',()=>{
 const f=fixture(),probe=beginTrainingRenderStats(f.renderer),error=new Error('native draw error');
 try{
  assert.equal(f.info.reset('unused'),42);
  f.draw({triangles:9});throw error;
 }catch(caught){assert.equal(caught,error)}finally{assert.equal(probe.finish().triangles,9)}
 assert.equal(f.info.reset,f.reset);assert.equal(f.render.frame,10);
 const idle=beginTrainingRenderStats(f.renderer);
 assert.deepEqual(idle.finish(),{calls:0,triangles:0,points:0,lines:0,renderPasses:0,counterResets:0,autoReset:true,...unsupported});
 assert.equal(beginTrainingRenderStats({info:{}}).finish(),null);
});

function gpuFixture({supported=true}={}){
 const f=fixture(),ext={TIME_ELAPSED_EXT:'elapsed',GPU_DISJOINT_EXT:'disjoint'},queries=[],deleted=[],resultReads=[];
 let active=null,extensionCalls=0,begins=0,ends=0,disjoint=false;
 const gl={CURRENT_QUERY:'current',QUERY_RESULT_AVAILABLE:'available',QUERY_RESULT:'result',
  getExtension(name){assert.equal(name,'EXT_disjoint_timer_query_webgl2');extensionCalls++;return supported?ext:null;},
  getParameter(name){assert.equal(name,ext.GPU_DISJOINT_EXT);return disjoint;},
  getQuery(target,name){assert.equal(target,ext.TIME_ELAPSED_EXT);assert.equal(name,this.CURRENT_QUERY);return active;},
  createQuery(){const query={id:queries.length+1,ready:false,ns:8500000};queries.push(query);return query;},
  beginQuery(target,query){assert.equal(target,ext.TIME_ELAPSED_EXT);assert.equal(active,null,'Elapsed queries must not nest');active=query;begins++;},
  endQuery(target){assert.equal(target,ext.TIME_ELAPSED_EXT);assert.ok(active);active=null;ends++;},
  getQueryParameter(query,name){if(name===this.QUERY_RESULT_AVAILABLE)return query.ready;assert.equal(name,this.QUERY_RESULT);assert.equal(query.ready,true,'Never read a result until available');resultReads.push(query);return query.ns;},
  deleteQuery(query){deleted.push(query);},
  finish(){assert.fail('GPU timing must never introduce gl.finish');},
  isContextLost:()=>false,
 };
 f.renderer.getContext=()=>gl;
 return {...f,gl,ext,queries,deleted,resultReads,active:()=>active,stats:()=>({begins,ends,extensionCalls}),setDisjoint(value){disjoint=value;},setForeign(query){active=query;}};
}

test('missing timer extension is cached without introducing queries or changing native counters',()=>{
 const f=gpuFixture({supported:false});
 for(let index=0;index<2;index++){
  const probe=beginTrainingRenderStats(f.renderer);f.pass(()=>f.draw({triangles:10}));
  const value=probe.finish();assert.equal(value.gpuTimingSupported,false);assert.deepEqual(value.gpuSamplesMs,[]);assert.equal(value.calls,1);
 }
 assert.deepEqual(f.stats(),{begins:0,ends:0,extensionCalls:1});
 beginTrainingRenderStats.dispose(f.renderer);
});

test('gpuTiming=false keeps draw counters without even obtaining a WebGL context',()=>{
 const f=fixture();f.renderer.getContext=()=>assert.fail('GPU timing was explicitly disabled');
 const probe=beginTrainingRenderStats(f.renderer,{gpuTiming:false});
 f.pass(()=>f.draw({triangles:12}));const result=probe.finish();
 assert.equal(result.calls,1);assert.equal(result.triangles,12);assert.equal(result.gpuTimingSupported,false);assert.deepEqual(result.gpuSamplesMs,[]);assert.equal(f.info.reset,f.reset);
});

test('GPU results arrive asynchronously on later frames only after availability, in milliseconds',()=>{
 const f=gpuFixture();
 const first=beginTrainingRenderStats(f.renderer);assert.ok(f.active());
 f.pass(()=>f.draw({calls:1200,triangles:800000}));f.pass(()=>f.draw({triangles:3000}));
 const a=first.finish();assert.equal(a.gpuTimingSupported,true);assert.equal(a.gpuQueryStarted,true);assert.deepEqual(a.gpuSamplesMs,[]);assert.equal(a.calls,1201);assert.equal(f.active(),null);
 const second=beginTrainingRenderStats(f.renderer);assert.deepEqual(second.finish().gpuSamplesMs,[]);assert.equal(f.resultReads.length,0);
 f.queries[0].ready=true;
 const third=beginTrainingRenderStats(f.renderer),c=third.finish();
 assert.deepEqual(c.gpuSamplesMs,[8.5]);assert.deepEqual(f.resultReads,[f.queries[0]]);assert.deepEqual(f.deleted,[f.queries[0]]);
 assert.equal(third.finish(),c);assert.equal(f.stats().ends,3);
 beginTrainingRenderStats.dispose(f.renderer);assert.equal(f.deleted.length,3);assert.equal(f.active(),null);
});

test('disjoint invalidates all pending results, including queries not yet ready',()=>{
 const f=gpuFixture();beginTrainingRenderStats(f.renderer).finish();beginTrainingRenderStats(f.renderer).finish();
 f.queries[0].ready=true;f.setDisjoint(true);
 const invalid=beginTrainingRenderStats(f.renderer).finish();
 assert.equal(invalid.gpuDisjoint,true);assert.equal(invalid.gpuQueryStarted,false);assert.deepEqual(invalid.gpuSamplesMs,[]);
 assert.equal(f.resultReads.length,0);assert.equal(f.deleted.length,2);
 f.setDisjoint(false);const next=beginTrainingRenderStats(f.renderer).finish();
 assert.equal(next.gpuQueryStarted,true);assert.deepEqual(next.gpuSamplesMs,[]);
 beginTrainingRenderStats.dispose(f.renderer);
});

test('an existing elapsed query is left active and nested collectors do not end the outer query',()=>{
 const f=gpuFixture(),foreign={id:'foreign'};f.setForeign(foreign);
 assert.equal(beginTrainingRenderStats(f.renderer).finish().gpuQueryStarted,false);
 assert.equal(f.active(),foreign);assert.equal(f.stats().ends,0);
 f.setForeign(null);const outer=beginTrainingRenderStats(f.renderer),own=f.active(),inner=beginTrainingRenderStats(f.renderer);
 assert.equal(inner.finish().gpuQueryStarted,false);assert.equal(f.active(),own);
 outer.finish();assert.equal(f.stats().begins,1);assert.equal(f.stats().ends,1);
 beginTrainingRenderStats.dispose(f.renderer);
});

test('native render exceptions and timer API failures restore hooks and clean queries',()=>{
 const f=gpuFixture(),probe=beginTrainingRenderStats(f.renderer),error=new Error('native render');
 assert.throws(()=>{try{throw error}finally{probe.finish()}},caught=>caught===error);
 assert.equal(f.active(),null);assert.equal(f.info.reset,f.reset);
 beginTrainingRenderStats.dispose(f.renderer);assert.equal(f.deleted.length,1);
 const broken=gpuFixture(),begin=broken.gl.beginQuery;
 broken.gl.beginQuery=function(...args){begin.apply(this,args);throw Error('timer begin failed')};
 const value=beginTrainingRenderStats(broken.renderer).finish();
 assert.match(value.gpuTimingError,/timer begin failed/);assert.equal(broken.active(),null);assert.equal(broken.deleted.length,1);assert.equal(broken.info.reset,broken.reset);
 beginTrainingRenderStats.dispose(broken.renderer);
});

test('pending query ownership is bounded and disposing active timing permits a fresh run',()=>{
 const f=gpuFixture();for(let index=0;index<65;index++)beginTrainingRenderStats(f.renderer).finish();
 assert.equal(f.stats().begins,64);assert.equal(f.queries.length,64);
 beginTrainingRenderStats.dispose(f.renderer);assert.equal(f.deleted.length,64);
 const next=beginTrainingRenderStats(f.renderer);assert.ok(f.active());
 beginTrainingRenderStats.dispose(f.renderer);assert.equal(f.active(),null);assert.equal(f.deleted.length,65);
 next.finish();assert.equal(f.deleted.length,65);assert.equal(f.info.reset,f.reset);
});
