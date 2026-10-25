import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeaponSelectionGate} from '../patches/weapon-models-runtime.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('preparation waits for the latest skin and drains an obsolete decode before publishing ready',async()=>{
  let selected='a',started=[],applied=[],settled=false;
  const a=deferred(),b=deferred(),gate=createWeaponSelectionGate({selectionKey:()=>selected,load(){const key=selected;started.push(key);return (key==='a'?a:b).promise;},apply:asset=>applied.push(asset?.key??null)});
  const ready=gate.ready().then(value=>{settled=true;return value;});await tick();const before=gate.revision;
  selected='b';gate.refresh();assert.ok(gate.revision>before,'an in-flight selection invalidates an existing GPU prewarm immediately');await tick();
  b.resolve({key:'b'});await tick();assert.equal(settled,false,'obsolete loading work cannot spill into the new round');assert.deepEqual(applied,['b']);
  a.resolve({key:'a'});const revision=await ready;assert.equal(revision,gate.revision);assert.deepEqual(applied,['b']);assert.deepEqual(started,['a','b']);
});

test('default selection is restored immediately while readiness waits for a cancelled skin load',async()=>{
  let selected='a',applied=[],done=false;const a=deferred(),gate=createWeaponSelectionGate({selectionKey:()=>selected,load:()=>a.promise,apply:asset=>applied.push(asset)});
  gate.refresh();await tick();selected=null;await gate.refresh();assert.deepEqual(applied,[null]);
  const ready=gate.ready().then(()=>{done=true;});await tick();assert.equal(done,false);
  a.resolve({key:'a'});await ready;assert.deepEqual(applied,[null]);
});

test('an obsolete skin decode failure cannot fail an already prepared replacement',async()=>{
  let selected='a',applied=[];const a=deferred(),b=deferred();
  const gate=createWeaponSelectionGate({selectionKey:()=>selected,load:()=>selected==='a'?a.promise:b.promise,apply:asset=>applied.push(asset?.key??null)});
  const ready=gate.ready();await tick();selected='b';gate.refresh();await tick();
  b.resolve({key:'b'});await tick();a.reject(Error('old skin timed out'));
  assert.equal(await ready,gate.revision);assert.deepEqual(applied,['b']);
});

test('a preloaded skin does no duplicate load and a failed preparation can be retried',async()=>{
  let selected='a',calls=0,fail=true;const gate=createWeaponSelectionGate({initialKey:'a',selectionKey:()=>selected,async load(){calls++;if(fail)throw Error('decode failed');return {key:selected};},apply(){}});
  assert.equal(await gate.ready(),0);assert.equal(calls,0);
  selected='b';await assert.rejects(gate.ready(),/decode failed/);fail=false;const revision=await gate.ready();assert.ok(revision>0);assert.equal(calls,2);
});

test('disposed model preparation cannot complete or attach a late appearance',async()=>{
  let applied=0;const load=deferred(),gate=createWeaponSelectionGate({selectionKey:()=> 'a',load:()=>load.promise,apply(){applied++;}});
  const ready=gate.ready();await tick();gate.dispose();load.resolve({key:'a'});await assert.rejects(ready,/cancelled/);assert.equal(applied,0);await assert.rejects(gate.ready(),/cancelled/);
});
