import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {beginTrainingDrawBreakdown} from '../scripts/training-draw-breakdown.mjs';

const zero=()=>({calls:0,triangles:0,points:0,lines:0});
function fixture(){
 const render={frame:12,...zero()},calls=[],info={render,autoReset:true,reset(){Object.assign(render,zero());}};
 const renderer={info,renderBufferDirect(camera,scene,geometry,material,object,group){
  assert.equal(this,renderer);calls.push({camera,scene,geometry,material,object,group});
  for(const field of ['calls','triangles','points','lines'])render[field]+=group.delta[field]??0;
  if(group.error)throw group.error;return group.value;
 }};
 const original=renderer.renderBufferDirect,reset=info.reset;
 const draw=(object,delta,scene={},extra={})=>renderer.renderBufferDirect({camera:true},scene,object.geometry,{material:true},object,{delta,...extra});
 return {render,info,renderer,original,reset,calls,draw};
}
const node=(geometry,children=[])=>({geometry,children,traverse(callback){callback(this);for(const child of children)child.traverse?child.traverse(callback):callback(child);}});

test('one-frame categories use actual grouped and instanced counter deltas without estimating geometry',()=>{
 const f=fixture(),map=node({index:{count:3},instanceCount:999}),bodyGeometry={},body=node(bodyGeometry),weapon=node({}),viewScene=node(null,[node(bodyGeometry)]),other=node({});
 const actorTemplates=new Map([['bot',{parts:[body],root:node(null,[body,weapon])}]]);
 const probe=beginTrainingDrawBreakdown(f.renderer,{mapBatches:[map],actorTemplates,viewModel:{fxLayer:()=>({scene:viewScene})}});
 assert.equal(f.draw(map,{calls:1,triangles:123456},null,{value:42}),42);
 // Two groups, of which one native update counts multiple draw calls.
 f.draw(body,{calls:2,triangles:13});f.draw(body,{calls:1,triangles:7});
 f.draw(weapon,{calls:1,triangles:8000});f.draw(viewScene.children[0],{calls:1,triangles:21},viewScene);
 f.draw(other,{calls:1,points:10,lines:3});
 const result=probe.finish(f.render);
 assert.deepEqual(result.categories.map,{calls:1,triangles:123456,points:0,lines:0});
 assert.deepEqual(result.categories.targetBody,{calls:3,triangles:20,points:0,lines:0});
 assert.deepEqual(result.categories.targetWeapon,{calls:1,triangles:8000,points:0,lines:0});
 assert.deepEqual(result.categories.viewModel,{calls:1,triangles:21,points:0,lines:0});
 assert.deepEqual(result.categories.other,{calls:1,triangles:0,points:10,lines:3});
 assert.deepEqual(result.residual,zero());assert.equal(result.directCalls,6);assert.equal(result.counterDiscontinuities,0);
 assert.equal(f.renderer.renderBufferDirect,f.original);assert.equal(f.info.reset,f.reset);assert.equal(f.info.autoReset,true);assert.equal(f.render.frame,12);
 assert.equal(probe.finish(),result,'finish must be idempotent');
});

test('body geometry wins over weapon geometry and new viewmodel meshes win over both',()=>{
 const f=fixture(),shared={},body=node(shared),weapon=node(shared),viewScene=node(null);
 const probe=beginTrainingDrawBreakdown(f.renderer,{actorTemplates:new Map([['bot',{parts:[body],root:node(null,[body,weapon])}]]),viewModel:{fxLayer:()=>({scene:viewScene})}});
 f.draw(weapon,{calls:1,triangles:10});
 f.draw(node(shared),{calls:1,triangles:20},viewScene);
 const result=probe.finish(f.render);
 assert.equal(result.categories.targetBody.triangles,10);assert.equal(result.categories.targetWeapon.triangles,0);assert.equal(result.categories.viewModel.triangles,20);
});

test('multiple native render resets are untouched, unknown draws remain other, and residual identifies unhooked draws',()=>{
 const f=fixture(),probe=beginTrainingDrawBreakdown(f.renderer);
 f.draw(node({}),{calls:1,triangles:100});f.info.reset();f.render.frame++;
 f.draw(node({}),{calls:1,lines:5});
 const result=probe.finish({calls:3,triangles:100,points:4,lines:5});
 assert.deepEqual(result.categories.other,{calls:2,triangles:100,points:0,lines:5});
 assert.deepEqual(result.residual,{calls:1,triangles:0,points:4,lines:0});
 assert.equal(f.info.reset,f.reset);assert.equal(f.info.autoReset,true);assert.equal(f.render.frame,13);
 assert.deepEqual(f.render,{frame:13,calls:1,triangles:0,points:0,lines:5});
});

test('throwing native draws preserve exception identity and the finally cleanup restores the hook',()=>{
 const f=fixture(),probe=beginTrainingDrawBreakdown(f.renderer),error=new Error('native draw failed');
 try{assert.throws(()=>f.draw(node({}),{calls:1,triangles:3},{},{error}),caught=>caught===error)}finally{probe.finish(f.render)}
 assert.equal(f.renderer.renderBufferDirect,f.original);assert.deepEqual(probe.finish().total,{calls:1,triangles:3,points:0,lines:0});
 const draws=f.calls.length;f.draw(node({}),{calls:1,triangles:10});assert.equal(f.calls.length,draws+1);assert.equal(probe.finish().total.triangles,3,'hook must not remain active after the selected frame');
});

test('nested renderBufferDirect calls do not double count and a foreign replacement is preserved',()=>{
 const f=fixture(),outer=node({}),inner=node({}),original=f.original;
 f.renderer.renderBufferDirect=function(...args){if(args[4]===outer)this.renderBufferDirect(args[0],args[1],inner.geometry,args[3],inner,{delta:{calls:1,triangles:7}});return original.apply(this,args);};
 const restore=f.renderer.renderBufferDirect,probe=beginTrainingDrawBreakdown(f.renderer,{mapBatches:[outer]});
 f.draw(outer,{calls:1,triangles:10});const result=probe.finish(f.render);
 assert.equal(result.total.triangles,17);assert.equal(result.categories.map.triangles,10);assert.equal(result.categories.other.triangles,7);assert.equal(result.nestedDirectCalls,1);assert.deepEqual(result.residual,zero());assert.equal(f.renderer.renderBufferDirect,restore);
 const second=beginTrainingDrawBreakdown(f.renderer),foreign=()=>88;f.renderer.renderBufferDirect=foreign;
 assert.equal(second.finish().hookRestored,false);assert.equal(f.renderer.renderBufferDirect,foreign);
});

test('the helper serializes without dependencies and unsupported renderers are inert',()=>{
 const standalone=vm.runInNewContext('('+beginTrainingDrawBreakdown.toString()+')');
 const f=fixture(),probe=standalone(f.renderer);f.draw(node({}),{calls:1,triangles:6});
 assert.equal(probe.finish(f.render).total.triangles,6);assert.equal(f.renderer.renderBufferDirect,f.original);
 assert.equal(standalone({info:{render:{}}}).finish(),null);
});
