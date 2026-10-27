import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {beginTrainingGlStalls} from '../scripts/training-gl-stalls.mjs';

function fixture(){
 let clock=0,label='worldDraw';const calls=[];
 const prototype={
  drawElements(...args){assert.equal(this,gl);calls.push({method:'drawElements',args});clock+=3;return 42;},
  getProgramParameter(...args){assert.equal(this,gl);calls.push({method:'getProgramParameter',args});clock+=7;return 'ready';},
  isEnabled(...args){assert.equal(this,gl);calls.push({method:'isEnabled',args});clock+=.25;return true;},
  getParameter(){assert.fail('probe must not request additional GL state');},
 };
 const gl=Object.create(prototype),options={enabled:true,now:()=>clock,phase:()=>label,thresholdMs:1,maxRecords:64};
 return {gl,prototype,options,calls,advance:ms=>clock+=ms,setPhase:value=>label=value};
}

test('disabled and missing-context probes do not inspect or alter WebGL',()=>{
 const gl=new Proxy({}, {get(){assert.fail('disabled probe read gl');},defineProperty(){assert.fail('disabled probe altered gl');}});
 const disabled=beginTrainingGlStalls(gl),value=disabled.finish();assert.equal(value.enabled,false);assert.equal(disabled.finish(),value);
 assert.equal(beginTrainingGlStalls(null,{enabled:true}).finish().reason,'no-context');
});

test('native this, arguments, returns and individual call timings are preserved without extra GL queries',()=>{
 const f=fixture(),original=f.gl.drawElements,probe=beginTrainingGlStalls(f.gl,f.options),program={};
 assert.equal(f.gl.drawElements(4,120,5123,0),42);f.setPhase('viewModel');
 assert.equal(f.gl.getProgramParameter(program,35714),'ready');assert.equal(f.gl.isEnabled(2929),true);
 const result=probe.finish();assert.deepEqual(result.methods.drawElements,{calls:1,totalMs:3,maxMs:3,errors:0});
 assert.deepEqual(result.methods.isEnabled,{calls:1,totalMs:.25,maxMs:.25,errors:0});
 assert.deepEqual(result.slowCalls.map(({method,durationMs,phase,arguments:args})=>({method,durationMs,phase,args})),[
  {method:'drawElements',durationMs:3,phase:'worldDraw',args:[4,120,5123,0]},
  {method:'getProgramParameter',durationMs:7,phase:'viewModel',args:['[object]',35714]},
 ]);
 assert.equal(f.calls.length,3);assert.equal(f.calls[1].args[0],program);assert.equal(result.instrumentationMs,0);
 assert.equal(f.gl.drawElements,original);assert.equal(Object.hasOwn(f.gl,'drawElements'),false);assert.equal(probe.finish(),result);
});

test('wrappers are reused across frames, nested probes are inert, and records stay bounded',()=>{
 const f=fixture(),first=beginTrainingGlStalls(f.gl,{...f.options,maxRecords:1}),wrapper=f.gl.drawElements;
 const nested=beginTrainingGlStalls(f.gl,f.options);assert.equal(nested.finish().reason,'already-active');assert.equal(f.gl.drawElements,wrapper);
 f.gl.drawElements();f.gl.drawElements();f.gl.drawElements();const one=first.finish();
 assert.equal(one.slowCalls.length,1);assert.equal(one.droppedRecords,2);assert.equal(one.methods.drawElements.calls,3);
 const second=beginTrainingGlStalls(f.gl,f.options);assert.equal(f.gl.drawElements,wrapper);f.gl.drawElements();
 const two=second.finish();assert.equal(two.methods.drawElements.calls,1);assert.equal(two.slowCalls.length,1);assert.equal(one.methods.drawElements.calls,3);
});

test('native thrown errors and own descriptors survive; foreign replacement is not overwritten',()=>{
 const f=fixture(),error=new Error('native draw failure'),original=function(){f.advance(4);throw error;};
 Object.defineProperty(f.gl,'drawElements',{value:original,writable:false,configurable:true,enumerable:true});
 const descriptor=Object.getOwnPropertyDescriptor(f.gl,'drawElements'),probe=beginTrainingGlStalls(f.gl,f.options);
 assert.throws(()=>f.gl.drawElements(),caught=>caught===error);const value=probe.finish();
 assert.deepEqual(Object.getOwnPropertyDescriptor(f.gl,'drawElements'),descriptor);assert.equal(value.methods.drawElements.errors,1);assert.equal(value.slowCalls[0].error,error.message);
 const next=beginTrainingGlStalls(f.gl,f.options),foreign=()=>17;
 Object.defineProperty(f.gl,'drawElements',{value:foreign,configurable:true});next.finish();assert.equal(f.gl.drawElements,foreign);
});

test('unhookable methods remain native and probe overhead is separate from call durations',()=>{
 const f=fixture();Object.defineProperty(f.gl,'isEnabled',{value:f.gl.isEnabled,writable:false,configurable:false});
 let time=0;const options={...f.options,now:()=>time++,phase:()=>{time+=2;return 'worldDraw';}};
 const probe=beginTrainingGlStalls(f.gl,options);f.gl.drawElements();const value=probe.finish();
 assert.ok(value.hookFailures.includes('isEnabled'));assert.equal(value.methods.drawElements.totalMs,1);
 assert.ok(value.instrumentationMs>value.methods.drawElements.totalMs);
});

test('the function serializes without imports and measures isEnabled when threshold is zero',()=>{
 const standalone=vm.runInNewContext('('+beginTrainingGlStalls.toString()+')'),f=fixture();
 const probe=standalone(f.gl,{...f.options,thresholdMs:0});assert.equal(f.gl.isEnabled(2929),true);
 const value=probe.finish();assert.equal(value.slowCalls[0].method,'isEnabled');assert.equal(value.methods.isEnabled.calls,1);
});
