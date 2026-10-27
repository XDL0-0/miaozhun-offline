import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {comparisonCases,readComparisonConfig,comparisonViewportOptions,comparisonMSAAEnabled,createComparisonWeaponBridge,executeComparisonQueue} from '../scripts/create-performance-comparison.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const repository=fileURLToPath(new URL('../',import.meta.url));
const config=name=>readComparisonConfig('?__offlineProfile=1&__performanceComparison=1&__comparisonCase='+name,true);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('graphics sweep has seven explicit cases while the default skin experiment stays unchanged',()=>{
  assert.deepEqual(comparisonCases(),['native','skin-full','skin-no-motion','skin-no-muzzle']);
  assert.deepEqual(comparisonCases(true),['gfx-default','gfx-no-msaa','gfx-75','gfx-50','gfx-low-tier','gfx-standard-no-msaa','gfx-no-shadows']);
  assert.equal(readComparisonConfig('?__offlineProfile=1&__performanceComparison=1',true).case,'gfx-default');
  assert.equal(readComparisonConfig('?__comparisonCase=gfx-50').case,'skin-full');
  assert.equal(config('native').case,'gfx-default','graphics mode cannot accidentally select the no-skin case');
});

test('resolution experiments clear explicit resolution, preserve latency, and never mutate display options',()=>{
  const resolution=Object.freeze({width:1920,height:1080}),gpu=Object.freeze({tier:'high'});
  const original=Object.freeze({renderScale:1,renderResolution:resolution,aspectRatio:'16:9',lowLatency:true,shadows:true,gpu});
  assert.equal(comparisonViewportOptions(original,config('gfx-default')),original);
  assert.equal(comparisonViewportOptions(original,config('gfx-no-msaa')),original,'MSAA is overridden in the native selector, not by changing lowLatency');
  for(const [name,scale]of [['gfx-75',.75],['gfx-50',.5]]){
    assert.deepEqual(comparisonViewportOptions(original,config(name)),{...original,renderScale:scale,renderResolution:null});
    assert.equal(comparisonViewportOptions(original,{...config(name),enabled:false}),original);
  }
  assert.deepEqual(comparisonViewportOptions(original,config('gfx-low-tier')),{...original,gpu:{tier:'low'}});
  assert.equal(original.renderResolution,resolution);assert.equal(original.gpu,gpu);
  for(const name of comparisonCases(true))assert.equal(comparisonMSAAEnabled(true,config(name)),['gfx-no-msaa','gfx-standard-no-msaa'].includes(name)?false:true);
  assert.equal(comparisonMSAAEnabled(false,config('gfx-default')),false);
  assert.equal(comparisonMSAAEnabled(true,{...config('gfx-no-msaa'),enabled:false}),true);
});

test('all graphics cases retain skin montages, gun models and muzzle frame/render',async()=>{
  for(const name of comparisonCases(true)){
    const cfg=config(name),pack={key:'champions-2023/vandal',motions:{clips:{retained:true}}},calls=[];
    const skins={async initialize(){},selection:()=>({collection:'champions-2023',theme:'default'}),subscribe:()=>()=>{},select(){assert.fail('No persistent skin selection is allowed');}};
    const bridge=createComparisonWeaponBridge({config:cfg,skins,state:{sampling:false,models:{}},createLoader:()=>({load:async()=>pack,picture:()=>null}),createAppearance:options=>options,normalLoad(){},normalImage(){}});
    assert.equal(await bridge.loadWeaponModel('viewmodel'),pack,name+' keeps the complete decoded skin asset');
    const effects=bridge.wrapMuzzle({frame(){calls.push('frame');},render(){calls.push('render');}});effects.frame();effects.render();
    assert.deepEqual(calls,['frame','render']);
  }
  const measured=[];
  await executeComparisonQueue({initialCase:'gfx-default',cases:comparisonCases(true),selectCase(){},async rebuildViewport(){},check(){},
    async measure(name){return {config:{case:name},reason:'completed-10s',scoreAndReplayDiscarded:true,errors:[]};},onReport:report=>measured.push(report.config.case)});
  assert.deepEqual(measured,comparisonCases(true));
});

test('additional graphics cases allow standard-no-msaa and no-shadows as initial queue cases',async()=>{
  for(const name of ['gfx-standard-no-msaa','gfx-no-shadows']){
    assert.equal(config(name).case,name);
    const measured=[];
    await executeComparisonQueue({initialCase:name,cases:comparisonCases(true),selectCase(){},async rebuildViewport(){},check(){},
      async measure(value){return {config:{case:value},reason:'completed-10s',scoreAndReplayDiscarded:true,errors:[]};},onReport:report=>measured.push(report.config.case)});
    assert.equal(measured[0],name);assert.equal(measured.length,7);assert.equal(new Set(measured).size,7);
  }
});

test('additional graphics overrides isolate standard context and shadows while retaining source quality settings',()=>{
  const original=Object.freeze({renderScale:1,renderResolution:Object.freeze({width:1920,height:1080}),lowLatency:true,shadows:true,gpu:Object.freeze({tier:'high'})});
  const standard=comparisonViewportOptions(original,config('gfx-standard-no-msaa'));
  assert.deepEqual(standard,{...original,lowLatency:false});assert.equal(comparisonMSAAEnabled(true,config('gfx-standard-no-msaa')),false);
  const noShadows=comparisonViewportOptions(original,config('gfx-no-shadows'));
  assert.deepEqual(noShadows,{...original,shadows:false});assert.equal(comparisonMSAAEnabled(true,config('gfx-no-shadows')),true);
  assert.equal(comparisonMSAAEnabled(false,config('gfx-no-shadows')),false);
  for(const name of ['gfx-standard-no-msaa','gfx-no-shadows']){
    assert.equal(comparisonViewportOptions(original,{...config(name),enabled:false}),original);
    assert.equal(comparisonMSAAEnabled(true,{...config(name),enabled:false}),true);
  }
  assert.equal(original.lowLatency,true);assert.equal(original.shadows,true);
});

test('graphics CLI combines with spatial overlay and disables MSAA on both native context paths only in its own case',t=>{
  const base=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(base,'aim-graphics-sweep-test-')),output=path.join(directory,'overlay');
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(directory)),base);assert.ok(path.basename(directory).startsWith('aim-graphics-sweep-test-'));fs.rmSync(directory,{recursive:true,force:true});});
  const protectedFiles=['index.html','js/CymPR-fm.js','js/CFqO0zvx.js','js/aQOfOAp-.js'].map(name=>path.join(repository,'dist',name)),before=protectedFiles.map(hash);
  const generated=spawnSync(process.execPath,['scripts/create-performance-comparison.mjs','--input',path.join(repository,'dist'),'--output',output,'--graphics-sweep','--spatial-cell-size','24'],{cwd:repository,encoding:'utf8',windowsHide:true});
  assert.equal(generated.status,0,generated.stderr);assert.deepEqual(protectedFiles.map(hash),before);
  const manifest=JSON.parse(generated.stdout),graphics=fs.readFileSync(path.join(output,'dist/js/aQOfOAp-.js'),'utf8');
  assert.deepEqual(manifest.cases,comparisonCases(true));assert.equal(manifest.experiments.spatialInstancing.cellSize,24);assert.equal(manifest.experiments.graphicsSweep.enabled,true);
  assert.equal(manifest.experiments.graphicsSweep.module,'js/aQOfOAp-.js');assert.match(manifest.url,/gfx-default$/);assert.equal(manifest.measured,false);
  assert.ok(graphics.includes('window.__aimPerformanceComparison?.config'),'MSAA selector reads the live shared queue config');
  const native=fs.readFileSync(protectedFiles[3],'utf8');assert.equal(graphics.split('cR=4').length,native.split('cR=4').length,'global sample count is retained');
  const start=graphics.indexOf('a=__aimComparisonMSAAEnabled('),end=graphics.indexOf(';c.outputColorSpace',start);assert.ok(start>0&&end>start);
  const constructor=graphics.slice(start,end);
  for(const lowLatency of [false,true])for(const name of ['gfx-default','gfx-no-msaa','gfx-75']){
    const contexts=[],sandbox={window:{__aimPerformanceComparison:{config:config(name)}},s:{msaa:true,maxPixelRatio:2},n:{},t:{lowLatency},rR:2,aR:()=>1,lR:()=>true,
      hR(value){contexts.push(value);return {canvas:{},context:{}};},Dp:class{constructor(options){this.options=options;}}};
    vm.runInNewContext('const __aimComparisonMSAAEnabled='+comparisonMSAAEnabled.toString()+';const '+constructor+';globalThis.result={a,options:c.options};',sandbox);
    assert.equal(sandbox.result.a,name!=='gfx-no-msaa');assert.equal(sandbox.result.options.antialias,name!=='gfx-no-msaa');
    assert.deepEqual(contexts,lowLatency?[name!=='gfx-no-msaa']:[],'hR and default context share the same MSAA decision');
  }
  for(const name of ['js/aQOfOAp-.js','js/CymPR-fm.js','js/aim-comparison-weapon-models.mjs','__performance-comparison.mjs'])parse(fs.readFileSync(path.join(output,'dist',name),'utf8'),{ecmaVersion:'latest',sourceType:'module'});
  const runtime=fs.readFileSync(path.join(output,'dist/__performance-comparison.mjs'),'utf8');assert.ok(runtime.includes('一键运行全部'));assert.ok(runtime.includes('graphicsExperiment'));
  const game=fs.readFileSync(path.join(output,'dist/js/CymPR-fm.js'),'utf8');assert.ok(game.includes('a(e,nl(0),__aimComparisonViewportOptions({renderScale:'));
});
