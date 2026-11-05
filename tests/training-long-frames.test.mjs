import test from 'node:test';
import assert from 'node:assert/strict';
import {observeTrainingLongFrames} from '../scripts/training-long-frames.mjs';
test('query attribution is bounded, window-aligned, and preserves script timing without observers changing behavior',()=>{
 const instances=[];
 class Observer{
  static supportedEntryTypes=['longtask','long-animation-frame'];
  constructor(callback){this.callback=callback;this.queue=[];this.closed=0;instances.push(this);}
  observe(options){this.options=options;}
  takeRecords(){const list=this.queue;this.queue=[];return list;}
  disconnect(){this.closed++;}
 }
 const probe=observeTrainingLongFrames({Observer,maxRecords:2});
 assert.deepEqual(instances.map(x=>x.options),[{type:'longtask',buffered:false},{type:'long-animation-frame',buffered:false}]);
 instances[0].queue.push({entryType:'longtask',startTime:10,duration:60});
 instances[1].callback({getEntries:()=>[{entryType:'long-animation-frame',startTime:100,duration:80,blockingDuration:20,scripts:[{startTime:110,duration:65,sourceFunctionName:'render',sourceURL:'http://127.0.0.1/game.js',sourceCharPosition:20}]}]});
 const result=probe.snapshot(50,200);
 assert.equal(result.records.length,2);assert.equal(result.records[0].scripts[0].sourceFunctionName,'render');
 instances[0].queue.push({entryType:'longtask',startTime:300,duration:60});
 assert.equal(probe.snapshot().dropped,1);assert.equal(probe.snapshot(200,400).records.length,0);
 probe.dispose();probe.dispose();assert.ok(instances.every(x=>x.closed===1));
});
test('unsupported or rejecting observers are optional and serialized function remains self contained',()=>{
 const absent=observeTrainingLongFrames({Observer:null}).snapshot();assert.deepEqual(absent.supported,[]);assert.deepEqual(absent.unsupported,['longtask','long-animation-frame']);assert.deepEqual(absent.records,[]);assert.equal(absent.dropped,0);
 class Reject{static supportedEntryTypes=['longtask'];observe(){throw Error('unavailable');}}
 const rejected=observeTrainingLongFrames({Observer:Reject}).snapshot();assert.deepEqual(rejected.supported,[]);assert.deepEqual(rejected.failures,[{type:'longtask',operation:'observe'}]);
 const clone=Function('return ('+observeTrainingLongFrames.toString()+')')();
 assert.deepEqual(clone({Observer:null}).snapshot().records,[]);
});

test('nested script metadata and record capacities are bounded and disposed callbacks are inert',()=>{
 let observer;
 class Observer{
  static supportedEntryTypes=['long-animation-frame'];
  constructor(callback){this.callback=callback;observer=this;}
  observe(){} takeRecords(){return [];} disconnect(){}
 }
 const probe=observeTrainingLongFrames({Observer,maxRecords:1,maxScriptsPerFrame:2});
 const entry={entryType:'long-animation-frame',startTime:1,duration:80,scripts:Array.from({length:8},()=>({sourceURL:'x'.repeat(2000)}))};
 observer.callback({getEntries:()=>[entry,entry]});
 const result=probe.snapshot();assert.equal(result.records.length,1);assert.equal(result.dropped,1);assert.equal(result.droppedScripts,6);
 assert.equal(result.records[0].scripts.length,2);assert.equal(result.records[0].scripts[0].sourceURL.length,512);
 probe.dispose();observer.callback({getEntries:()=>[entry]});assert.deepEqual(probe.snapshot(),result);
 assert.equal(observeTrainingLongFrames({Observer:null,maxRecords:Infinity}).snapshot().maxRecords,256);
 assert.equal(observeTrainingLongFrames({Observer:null,maxRecords:99999}).snapshot().maxRecords,4096);
 assert.equal(observeTrainingLongFrames({Observer:null,maxRecords:-1}).snapshot().maxRecords,0);
});

test('observer drain and disconnect failures are recorded without breaking fixture teardown',()=>{
 class Observer{
  static supportedEntryTypes=['longtask'];
  observe(){} takeRecords(){throw Error('drain');} disconnect(){throw Error('close');}
 }
 const probe=observeTrainingLongFrames({Observer});probe.snapshot();probe.snapshot();probe.dispose();probe.dispose();
 assert.deepEqual(probe.snapshot().failures,[{type:'longtask',operation:'takeRecords'},{type:'longtask',operation:'disconnect'}]);
});
