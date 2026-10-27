import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyGpuFencePollingPatch,applyWorldPerformancePatch} from '../patches/world-performance.mjs';

const original = fs.readFileSync(new URL('../site/js/aQOfOAp-.js', import.meta.url), 'utf8');
const originalTraining = fs.readFileSync(new URL('../site/js/CymPR-fm.js', import.meta.url), 'utf8');
const patched = applyGpuFencePollingPatch({'aQOfOAp-.js':original})['aQOfOAp-.js'];
const a = patched.indexOf('function gw('), b = patched.indexOf('const uA=', a);
assert.ok(a >= 0 && b > a);
const factory = vm.runInNewContext(`(${patched.slice(a,b)})`, {ym:3,mw:250});
function fixture() {
  let clock = 0, next = 0, lost = false;
  const states = new Map(), deleted = [], calls = [];
  const gl = {
    ALREADY_SIGNALED:0x911a, CONDITION_SATISFIED:0x911c, TIMEOUT_EXPIRED:0x911b, WAIT_FAILED:0x911d,
    SYNC_GPU_COMMANDS_COMPLETE:0x9117,
    isContextLost:()=>lost,
    fenceSync:()=>{const sync={id:++next};states.set(sync.id,gl.TIMEOUT_EXPIRED);return sync;},
    clientWaitSync:(sync,flags,timeout)=>{calls.push({id:sync.id,flags,timeout});return states.get(sync.id);},
    getSyncParameter(){throw new Error('Optional poll still performed getSyncParameter');},
    deleteSync:sync=>deleted.push(sync.id), flush(){},
  };
  const handle = factory(gl,()=>clock);
  handle.setMaxInFlight(2);
  return {gl,handle,states,deleted,calls,set time(value){clock=value;},set lost(value){lost=value;}};
}

test('zero-timeout polling retains the two-frame budget and both success statuses',()=>{
  const f=fixture();
  assert.equal(f.handle.ready(),true);
  f.handle.submitted();assert.equal(f.handle.ready(),true);
  f.handle.submitted();assert.equal(f.handle.ready(),false);
  f.states.set(1,f.gl.ALREADY_SIGNALED);assert.equal(f.handle.ready(),true);
  f.handle.submitted();assert.equal(f.handle.ready(),false);
  f.states.set(2,f.gl.CONDITION_SATISFIED);assert.equal(f.handle.ready(),true);
  assert.deepEqual(f.deleted,[1,2]);
  assert.ok(f.calls.every(call=>call.flags===0&&call.timeout===0));
});

test('an unsignaled fence retains the native 250ms retirement deadline',()=>{
  const f=fixture();f.handle.submitted();f.handle.submitted();
  f.time=249;assert.equal(f.handle.ready(),false);assert.deepEqual(f.deleted,[]);
  f.time=250;assert.equal(f.handle.ready(),true);assert.deepEqual(f.deleted,[1,2]);
  assert.equal(f.handle.stats().stale,2);
});

test('WAIT_FAILED never counts as ready and retires a persistently broken fence after 250ms',()=>{
  const f=fixture();f.handle.submitted();f.states.set(1,f.gl.WAIT_FAILED);
  assert.equal(f.handle.ready(),false);assert.deepEqual(f.deleted,[]);
  f.time=250;assert.equal(f.handle.ready(),false);assert.deepEqual(f.deleted,[1]);
  assert.equal(f.handle.stats().stale,1);
  assert.equal(f.handle.ready(),true);
});

test('disabled backpressure and context loss preserve native cleanup behavior',()=>{
  const f=fixture();f.handle.submitted();f.handle.setMaxInFlight(0);
  assert.deepEqual(f.deleted,[1]);assert.equal(f.handle.ready(),true);
  assert.equal(f.calls.length,0);
  f.handle.setMaxInFlight(2);f.handle.submitted();f.lost=true;
  assert.equal(f.handle.ready(),true);assert.equal(f.handle.stats().inFlight,0);
  f.handle.dispose();assert.equal(f.calls.length,0);
});

test('optional poll composes with the world patch and rejects repeated or unknown source',()=>{
  const base={'aQOfOAp-.js':original,'CymPR-fm.js':originalTraining};
  const combined=applyGpuFencePollingPatch(applyWorldPerformancePatch(base));
  assert.ok(combined['aQOfOAp-.js'].includes('__aimLocalLightSelection'));
  assert.ok(combined['aQOfOAp-.js'].includes('__aimFencePollStatus'));
  assert.equal(base['aQOfOAp-.js'],original);
  assert.throws(()=>applyGpuFencePollingPatch(combined),/already applied/);
  assert.throws(()=>applyGpuFencePollingPatch({}),/missing graphics/);
  assert.throws(()=>applyGpuFencePollingPatch({'aQOfOAp-.js':original.replace('n.getSyncParameter(o.sync,n.SYNC_STATUS)','unknownSyncStatus')}),/version mismatch/);
});
