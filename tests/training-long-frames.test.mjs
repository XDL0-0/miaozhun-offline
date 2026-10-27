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
 assert.deepEqual(observeTrainingLongFrames({Observer:null}).snapshot(),{supported:[],dropped:0,records:[]});
 class Reject{static supportedEntryTypes=['longtask'];observe(){throw Error('unavailable');}}
 assert.deepEqual(observeTrainingLongFrames({Observer:Reject}).snapshot().supported,[]);
 const clone=Function('return ('+observeTrainingLongFrames.toString()+')')();
 assert.deepEqual(clone({Observer:null}).snapshot().records,[]);
});
