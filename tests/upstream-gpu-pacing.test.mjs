import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {applyUpstreamGpuPacingPatch,revertUpstreamGpuPacingPatch} from '../patches/upstream-gpu-pacing.mjs';

const worldName='CqM6URxy.js';
const original=fs.readFileSync(new URL('../upstream/aimpro-2026-11-05/client/js/CqM6URxy.js',import.meta.url),'utf8');
const patched=applyUpstreamGpuPacingPatch({[worldName]:original})[worldName];
function extract(source){
  const start=source.indexOf('const sb=3,H0=2,LP='),end=source.indexOf('const V0=',start);
  assert.ok(start>=0&&end>start);
  return vm.runInNewContext(`${source.slice(start,end)};({create:UP,readLimit:B5})`);
}
const native=extract(original),candidate=extract(patched);
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(runtime=candidate){
  let clock=0,next=0,lost=false,missingFence=false;
  const states=new Map(),deleted=[],polls=[],submissions=[];
  const gl={
    ALREADY_SIGNALED:0x911a,CONDITION_SATISFIED:0x911c,TIMEOUT_EXPIRED:0x911b,WAIT_FAILED:0x911d,
    SYNC_GPU_COMMANDS_COMPLETE:0x9117,SYNC_STATUS:0x9114,SIGNALED:0x9119,UNSIGNALED:0x9118,
    isContextLost:()=>lost,
    fenceSync(condition,flags){
      submissions.push({method:'fenceSync',condition,flags});
      if(missingFence)return null;
      const sync={id:++next};states.set(sync.id,gl.TIMEOUT_EXPIRED);return sync;
    },
    clientWaitSync(sync,flags,timeout){polls.push({id:sync.id,flags,timeout});return states.get(sync.id);},
    getSyncParameter(sync,pname){
      if(runtime!==native)throw Error('Candidate used getSyncParameter');
      assert.equal(pname,gl.SYNC_STATUS);polls.push({id:sync.id});
      const status=states.get(sync.id);
      return status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED?gl.SIGNALED:
        status===gl.WAIT_FAILED?null:gl.UNSIGNALED;
    },
    deleteSync(sync){deleted.push(sync.id);},
    flush(){submissions.push({method:'flush'});},
  };
  const handle=runtime.create(gl,()=>clock);
  handle.setMaxInFlight(runtime.readLimit(null));
  return {gl,handle,states,deleted,polls,submissions,set time(value){clock=value;},set lost(value){lost=value;},set missingFence(value){missingFence=value;}};
}

test('actual native configuration retains its two-frame default and three-frame maximum',()=>{
  for(const value of [null,'','  ','invalid','-1','Infinity'])
    assert.equal(candidate.readLimit({getItem:()=>value}),2);
  assert.equal(candidate.readLimit({getItem(){throw Error('storage unavailable');}}),2);
  for(const [value,expected] of [['0',0],['1.9',1],['2',2],['99',3]])
    assert.equal(candidate.readLimit({getItem:()=>value}),expected);
  const f=fixture();assert.equal(f.handle.stats().maxInFlight,2);
  f.handle.setMaxInFlight(99);assert.equal(f.handle.stats().maxInFlight,3);
  f.handle.setMaxInFlight(1.9);assert.equal(f.handle.stats().maxInFlight,1);
});

test('both successful wait statuses retire fences under the native two-frame budget',()=>{
  const f=fixture();assert.equal(f.handle.ready(),true);
  f.handle.submitted();assert.equal(f.handle.ready(),true);
  f.handle.submitted();assert.equal(f.handle.ready(),false);
  f.states.set(1,f.gl.ALREADY_SIGNALED);assert.equal(f.handle.ready(),true);
  f.handle.submitted();assert.equal(f.handle.ready(),false);
  f.states.set(2,f.gl.CONDITION_SATISFIED);assert.equal(f.handle.ready(),true);
  assert.deepEqual(f.deleted,[1,2]);
  assert.deepEqual(plain(f.handle.stats()),{maxInFlight:2,inFlight:1,blocked:2,stale:0});
  assert.ok(f.polls.length>0);assert.ok(f.polls.every(poll=>poll.flags===0&&poll.timeout===0));
  assert.deepEqual(f.submissions,Array.from({length:3},()=>[
    {method:'fenceSync',condition:f.gl.SYNC_GPU_COMMANDS_COMPLETE,flags:0},{method:'flush'},
  ]).flat());
});

test('pending head blocks FIFO retirement and is polled only once per ready call',()=>{
  const f=fixture();f.handle.submitted();f.handle.submitted();
  f.states.set(2,f.gl.ALREADY_SIGNALED);
  for(let count=0;count<3;count++)assert.equal(f.handle.ready(),false);
  assert.deepEqual(f.polls.map(poll=>poll.id),[1,1,1]);assert.deepEqual(f.deleted,[]);
  f.states.set(1,f.gl.CONDITION_SATISFIED);assert.equal(f.handle.ready(),true);
  assert.deepEqual(f.deleted,[1,2]);assert.equal(f.handle.stats().stale,0);
});

test('250ms retirement uses each native submission timestamp',()=>{
  const f=fixture();f.handle.submitted();f.time=100;f.handle.submitted();
  f.time=249;assert.equal(f.handle.ready(),false);assert.deepEqual(f.deleted,[]);
  f.time=250;assert.equal(f.handle.ready(),true);assert.deepEqual(f.deleted,[1]);
  assert.deepEqual(plain(f.handle.stats()),{maxInFlight:2,inFlight:1,blocked:1,stale:1});
  f.time=349;assert.equal(f.handle.ready(),true);assert.deepEqual(f.deleted,[1]);
  f.time=350;assert.equal(f.handle.ready(),true);assert.deepEqual(f.deleted,[1,2]);
  assert.equal(f.handle.stats().stale,2);
});

test('WAIT_FAILED never signals completion and follows native error retirement semantics',()=>{
  const f=fixture();f.handle.submitted();f.states.set(1,f.gl.WAIT_FAILED);
  assert.equal(f.handle.ready(),true,'one queued failed fence still leaves one native budget slot');
  assert.equal(f.handle.stats().inFlight,1);assert.deepEqual(f.deleted,[]);
  f.handle.submitted();f.states.set(2,f.gl.WAIT_FAILED);
  f.time=249;assert.equal(f.handle.ready(),false);assert.deepEqual(f.deleted,[]);
  f.time=250;assert.equal(f.handle.ready(),true);assert.deepEqual(f.deleted,[1,2]);
  assert.equal(f.handle.stats().stale,2);
});

test('unrecognized polling results cannot release a fence as completed',()=>{
  for(const status of [undefined,null,0,0x9119]){
    const f=fixture();f.handle.submitted();f.handle.submitted();f.states.set(1,status);
    assert.equal(f.handle.ready(),false);assert.deepEqual(f.deleted,[]);
    f.time=250;assert.equal(f.handle.ready(),true);assert.equal(f.handle.stats().stale,2);
  }
});

test('context loss abandons invalid handles without querying, deleting, or submitting',()=>{
  const f=fixture();f.handle.submitted();f.handle.submitted();f.lost=true;
  assert.equal(f.handle.ready(),true);assert.equal(f.handle.stats().inFlight,0);
  f.handle.submitted();f.handle.dispose();f.handle.dispose();
  assert.deepEqual(f.polls,[]);assert.deepEqual(f.deleted,[]);assert.equal(f.submissions.length,4);
  f.lost=false;f.handle.submitted();f.states.set(3,f.gl.ALREADY_SIGNALED);
  assert.equal(f.handle.ready(),true);assert.deepEqual(f.deleted,[3]);
});

test('native disposal and explicit zero budget delete live handles exactly once',()=>{
  const f=fixture();f.handle.submitted();f.handle.submitted();
  f.handle.dispose();f.handle.dispose();assert.deepEqual(f.deleted,[1,2]);
  assert.equal(f.handle.ready(),true);assert.equal(f.handle.stats().inFlight,0);
  f.handle.submitted();f.handle.setMaxInFlight(0);assert.deepEqual(f.deleted,[1,2,3]);
  f.handle.submitted();assert.equal(f.handle.ready(),true);f.handle.dispose();
  assert.deepEqual(f.polls,[]);assert.equal(f.submissions.length,6);
  f.handle.setMaxInFlight(2);f.handle.submitted();assert.equal(f.handle.stats().inFlight,1);
});

test('failed fence creation preserves native submission flush without queueing null',()=>{
  const f=fixture();f.missingFence=true;f.handle.submitted();
  assert.equal(f.handle.stats().inFlight,0);assert.equal(f.handle.ready(),true);
  assert.deepEqual(f.submissions,[{method:'fenceSync',condition:f.gl.SYNC_GPU_COMMANDS_COMPLETE,flags:0},{method:'flush'}]);
  assert.deepEqual(f.polls,[]);f.handle.dispose();assert.deepEqual(f.deleted,[]);
});

test('actual candidate and native factories agree across mixed completion, error, and cleanup events',()=>{
  function run(runtime){
    const f=fixture(runtime),snapshots=[];
    const snapshot=()=>snapshots.push({ready:f.handle.ready(),stats:plain(f.handle.stats()),deleted:[...f.deleted],polls:f.polls.map(poll=>poll.id)});
    snapshot();f.handle.submitted();snapshot();f.handle.submitted();snapshot();
    f.states.set(1,f.gl.WAIT_FAILED);f.states.set(2,f.gl.CONDITION_SATISFIED);snapshot();
    f.time=250;snapshot();f.handle.submitted();f.states.set(3,f.gl.ALREADY_SIGNALED);snapshot();
    f.handle.submitted();f.handle.setMaxInFlight(1);snapshot();f.handle.dispose();snapshot();
    f.handle.submitted();f.lost=true;snapshot();f.lost=false;f.handle.submitted();snapshot();
    f.handle.setMaxInFlight(0);snapshot();
    return snapshots;
  }
  assert.deepEqual(run(candidate),run(native));
});

test('transform is immutable, exactly reversible, and syntax-valid as a complete module',()=>{
  const input={[worldName]:original,'other.js':'unchanged'},output=applyUpstreamGpuPacingPatch(input);
  assert.equal(input[worldName],original);assert.equal(output['other.js'],'unchanged');assert.notEqual(input,output);
  assert.deepEqual(revertUpstreamGpuPacingPatch(output),input);
  const before=original.indexOf('const sb=3,H0=2,LP='),after=original.indexOf('const V0=',before);
  const patchedAfter=patched.indexOf('const V0=',before);
  assert.equal(patched.slice(0,before),original.slice(0,before));
  assert.equal(patched.slice(patchedAfter),original.slice(after),'all renderer, visual, and pacing call sites are untouched');
  const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:patched,encoding:'utf8',windowsHide:true});
  assert.equal(checked.status,0,checked.stderr);
});

test('transform fails closed on missing, duplicate, changed, or already patched pacing policy',()=>{
  assert.throws(()=>applyUpstreamGpuPacingPatch({}),/missing world/);
  assert.throws(()=>applyUpstreamGpuPacingPatch({[worldName]:42}),/missing world/);
  assert.throws(()=>applyUpstreamGpuPacingPatch({[worldName]:patched}),/already applied/);
  for(const [before,after] of [
    ['const sb=3,H0=2','const sb=3,H0=3'],['const FP=250','const FP=100'],
    ['t.getSyncParameter(o.sync,t.SYNC_STATUS)','changedStatus(o.sync)'],
    ['if(t.isContextLost())return s.length=0,!0','if(t.isContextLost())return!0'],
    ['dispose:a}}const V0=','dispose:()=>{}}}const V0='],
  ])assert.throws(()=>applyUpstreamGpuPacingPatch({[worldName]:original.replace(before,after)}),/version mismatch/);
  assert.throws(()=>applyUpstreamGpuPacingPatch({[worldName]:original+'function UP(){}'}),/version mismatch/);
  assert.throws(()=>revertUpstreamGpuPacingPatch({[worldName]:original}),/version mismatch/);
  assert.throws(()=>revertUpstreamGpuPacingPatch({[worldName]:patched.replace('clientWaitSync(o.sync,0,0)','clientWaitSync(o.sync,0,1)')}),/version mismatch/);
});
