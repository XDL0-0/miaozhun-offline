import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {applyTrainingGraphicsPhases,reportTrainingGraphicsPhase} from '../scripts/training-graphics-phases.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const original=fs.readFileSync(new URL('../site/js/aQOfOAp-.js',import.meta.url),'utf8');
const patched=applyTrainingGraphicsPhases({'aQOfOAp-.js':original})['aQOfOAp-.js'];

function renderMethod(source){
  const start=source.indexOf('render(){r.updateLocalLights(',source.indexOf('function JD('));
  const instrumentedStart=source.indexOf('render(){\n__aimGraphicsPhase(',source.indexOf('function JD('));
  const at=start<0?instrumentedStart:start;
  assert.ok(at>=0,'actual JD render method found');
  const end=source.indexOf(',prewarm(',at);
  assert.ok(end>at);
  return source.slice(at,end);
}

function run(source,{shadow=true,worldOverlay=true,viewModel=true,viewModelOverlay=true,failAt=null,observerError=false,observer=true}={}){
  const calls=[],phases=[],scene={},camera={position:{x:1,y:2,z:3}};
  const invoke=name=>(...args)=>{calls.push({name,args});if(failAt===name)throw Error('draw failed: '+name);};
  const c={shadowMap:{enabled:shadow,needsUpdate:true},render:invoke('worldDraw')};
  const r={scene,camera,updateLocalLights:invoke('localLights'),updateMapVisibility:invoke('mapVisibility')};
  const scope={r,c,g:viewModel?{render:invoke('viewModelDraw')}:null,m:worldOverlay?invoke('worldOverlay'):null,A:viewModelOverlay?invoke('viewModelOverlay'):null,_:invoke('retainPrograms'),
    window:observer?{__offlineTrainingFixtureRegistry:{graphicsPhase(name){phases.push(name);if(observerError)throw Error('observer failed');}}}:undefined};
  const setup='const __aimGraphicsPhase=('+reportTrainingGraphicsPhase.toString()+');';
  const fn=vm.runInNewContext(setup+'({'+renderMethod(source)+'}).render',scope);
  let error=null;try{assert.equal(fn(),undefined);}catch(value){error=value.message;}
  return {calls,phases,error,shadowNeedsUpdate:c.shadowMap.needsUpdate,scene,camera};
}

test('actual JD rendering retains order, arguments and shadow state with query-only phase markers',()=>{
  for(const shadow of [true,false])for(const worldOverlay of [true,false])for(const viewModel of [true,false])for(const viewModelOverlay of [true,false]){
    const options={shadow,worldOverlay,viewModel,viewModelOverlay},before=run(original,options),after=run(patched,options);
    assert.equal(after.error,before.error);
    assert.deepEqual(after.calls.map(c=>c.name),before.calls.map(c=>c.name));
    assert.equal(after.shadowNeedsUpdate,before.shadowNeedsUpdate);
    assert.deepEqual(after.phases,['localLights','mapVisibility','worldDraw','worldOverlay','viewModelDraw','viewModelOverlay',null]);
    assert.deepEqual(after.calls.find(c=>c.name==='localLights').args,[after.camera.position]);
    assert.deepEqual(after.calls.find(c=>c.name==='mapVisibility').args,[after.camera,shadow]);
    assert.deepEqual(after.calls.find(c=>c.name==='worldDraw').args,[after.scene,after.camera]);
    assert.equal(after.calls.some(c=>c.name==='viewModelOverlay'),viewModel&&viewModelOverlay);
  }
});

test('an original render failure is preserved and always ends the active graphics phase',()=>{
  for(const failAt of ['localLights','mapVisibility','worldDraw','retainPrograms','worldOverlay','viewModelDraw','viewModelOverlay']){
    const before=run(original,{failAt}),after=run(patched,{failAt});
    assert.equal(after.error,before.error);
    assert.deepEqual(after.calls.map(c=>c.name),before.calls.map(c=>c.name));
    assert.equal(after.shadowNeedsUpdate,before.shadowNeedsUpdate);
    assert.equal(after.phases.at(-1),null);
  }
});

test('missing or throwing observers cannot alter native rendering',()=>{
  const before=run(original);
  for(const options of [{observer:false},{observerError:true}]){
    const after=run(patched,options);
    assert.equal(after.error,null);
    assert.deepEqual(after.calls.map(c=>c.name),before.calls.map(c=>c.name));
    assert.equal(after.shadowNeedsUpdate,before.shadowNeedsUpdate);
  }
});

test('graphics source parses and unknown or duplicate versions fail closed',()=>{
  parse(patched,{ecmaVersion:'latest',sourceType:'module'});
  assert.throws(()=>applyTrainingGraphicsPhases({}),/missing graphics source/);
  assert.throws(()=>applyTrainingGraphicsPhases({'aQOfOAp-.js':original.replace('function JD(n,e,t){','function Other(n,e,t){')}),/version mismatch/);
  assert.throws(()=>applyTrainingGraphicsPhases({'aQOfOAp-.js':patched}),/already applied/);
});
