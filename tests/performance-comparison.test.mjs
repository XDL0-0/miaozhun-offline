import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readComparisonConfig,readComparisonSequence,readCompactionSequence,createComparisonWeaponBridge,writePerformanceComparison,executeComparisonQueue,comparisonDomButton,summarizeTrainingRenderSamples} from '../scripts/create-performance-comparison.mjs';
const {parse}=createRequire(import.meta.url)('../scripts/vendor/acorn.cjs');
const repository=fileURLToPath(new URL('../',import.meta.url));
const digest=file=>fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
const query=name=>readComparisonConfig('?__offlineProfile=1&__performanceComparison=1&__comparisonCase='+name);

test('compaction A/B sequence is explicit, boolean and bounded',()=>{
 assert.equal(readCompactionSequence(''),null);
 assert.deepEqual(readCompactionSequence('?__compactionSequence=off,on,off,on'),[false,true,false,true]);
 for(const value of ['', 'on','on,unknown',Array(9).fill('off').join(',')])assert.throws(()=>readCompactionSequence('?__compactionSequence='+value),/2-8 on\/off/);
});

test('interleaved same-scene sequence accepts only bounded known cases and keeps repeated entries',()=>{
 assert.equal(readComparisonSequence(''),null);
 assert.deepEqual(readComparisonSequence('?__comparisonSequence=skin-full,native,skin-full,native'),['skin-full','native','skin-full','native']);
 assert.deepEqual(readComparisonSequence('?__comparisonSequence=gfx-default,gfx-no-msaa',true),['gfx-default','gfx-no-msaa']);
 for(const raw of ['','skin-full','skin-full,unknown','skin-full,native,'.repeat(8),'gfx-default,gfx-no-msaa'])assert.throws(()=>readComparisonSequence('?__comparisonSequence='+raw),/2-8 known cases/);
});

test('explicit same-viewport repetitions reset the fixture and rebuild only when the case changes',async()=>{
 const events=[];
 await executeComparisonQueue({initialCase:'skin-full',cases:['skin-full','skin-full','native','native','skin-full'],reuseCurrentViewport:true,check(){},selectCase(name){events.push('select:'+name);},async rebuildViewport(name){events.push('rebuild:'+name);},async measure(name){events.push('measure:'+name);return{reason:'completed-10s',scoreAndReplayDiscarded:true,errors:[]};},onReport(){}});
 assert.deepEqual(events.filter(x=>x.startsWith('rebuild:')),['rebuild:native','rebuild:skin-full']);
 assert.equal(events.filter(x=>x.startsWith('measure:')).length,5);
});

function harness(name,{saved={collection:'kuronami',theme:'default',modelEnabled:true},enabled=true}={}){
  const calls=[],pack={key:saved.collection+'/vandal',motions:{clips:{original:{}}},parts:[{mesh:'unchanged'}]},state={sampling:true,models:{},record:(name,value)=>calls.push({name,value})};
  const skins={async initialize(){},selection:()=>({...saved}),subscribe:()=>()=>{},select(){assert.fail('Comparison must not persist a selection');}};
  let captured;
  const bridge=createComparisonWeaponBridge({config:{...query(name),enabled},skins,state,
    createLoader({skins:privateSkins}){captured=privateSkins;return {async load(){return privateSkins.selection('vandal').collection==='default'?null:pack;},picture:url=>'private:'+url};},
    createAppearance:options=>({options}),normalLoad:stem=>'normal:'+stem,normalImage:url=>'normal:'+url});
  return {bridge,state,calls,pack,skins,privateSkins:()=>captured};
}

test('comparison requires both diagnostic flags and accepts only known cases and bounded overrides',()=>{
  assert.equal(readComparisonConfig('?__performanceComparison=1').enabled,false);
  assert.equal(readComparisonConfig('?__offlineProfile=1').enabled,false);
  assert.equal(query('native').enabled,true);
  const invalid=readComparisonConfig('?__offlineProfile=1&__performanceComparison=1&__comparisonCase=oops&__comparisonCollection=../x&__comparisonTheme=<script>&__comparisonWeapon=no');
  assert.equal(invalid.case,'skin-full');assert.equal(invalid.collection,null);assert.equal(invalid.theme,null);assert.equal(invalid.weapon,'vandal');
});

test('private loader uses the existing skin first and never alters source assets or persistent selections',async()=>{
  const full=harness('skin-full');assert.equal(await full.bridge.loadWeaponModel('viewmodel'),full.pack);
  assert.equal(full.privateSkins().selection('vandal').collection,'kuronami');
  assert.equal(full.state.models.viewmodel.loadedKey,'kuronami/vandal');
  const native=harness('native');assert.equal(await native.bridge.loadWeaponModel('viewmodel'),null);
  assert.equal(native.privateSkins().selection('vandal').modelEnabled,false);
  assert.equal(native.skins.selection('vandal').collection,'kuronami','user selection stays intact');
  const empty=harness('skin-full',{saved:{collection:'default',theme:'default'}});await empty.bridge.loadWeaponModel('viewmodel');
  assert.equal(empty.privateSkins().selection('vandal').collection,'champions-2023');
});

test('no-motion strips only optional montages, including later selection-gate loads',async()=>{
  const h=harness('skin-no-motion'),loaded=await h.bridge.loadWeaponModel('viewmodel');
  assert.equal(loaded.motions,null);assert.equal(loaded.parts,h.pack.parts);assert.ok(h.pack.motions,'decoded source package is unchanged');
  const appearance=h.bridge.createWeaponAppearance({initial:loaded,stem:'viewmodel'});
  assert.equal((await appearance.options.loader.load('viewmodel')).motions,null);
  assert.equal(h.state.models.viewmodel.skinMotion,false);
});

test('muzzle suppression preserves preparation and model rendering; other cases preserve returns and timing',()=>{
  for(const name of ['native','skin-full','skin-no-motion','skin-no-muzzle']){
    const h=harness(name),calls=[];
    const effects=h.bridge.wrapMuzzle({prepare(){calls.push('prepare');return 1;},frame(value){calls.push(value);return 2;},render(value){calls.push(value);return 3;}});
    assert.equal(effects.prepare(),1);
    assert.equal(effects.frame('frame'),name==='skin-no-muzzle'?undefined:2);
    assert.equal(effects.render('render'),name==='skin-no-muzzle'?undefined:3);
    assert.deepEqual(calls,name==='skin-no-muzzle'?['prepare']:['prepare','frame','render']);
    const model=h.bridge.wrapNativeViewModel({update(){return 4;},render(){return 5;}},'viewmodel');
    assert.equal(model.update({}),4);assert.equal(model.render({},{}),5);
    assert.ok(h.calls.some(event=>event.name==='viewmodel.update:viewmodel'));
  }
  const disabled=harness('skin-no-muzzle',{enabled:false});const model={update(){return 7;}};
  assert.equal(disabled.bridge.wrapNativeViewModel(model),model);assert.equal(disabled.bridge.loadWeaponModel('knife') instanceof Promise,true);
  assert.equal(disabled.privateSkins(),undefined,'query-off does not create an alternate loader');
});

test('same-page queue measures its current viewport first, then rebuilds every other case before measuring',async()=>{
  const config=query('skin-full'),steps=[],reports=[];
  await executeComparisonQueue({initialCase:config.case,check(){},selectCase(name){config.case=name;steps.push('select:'+name);},
    async rebuildViewport(name){assert.equal(config.case,name);steps.push('rebuild:'+name);},
    async measure(name){steps.push('measure:'+name);return {config:{...config},reason:'completed-10s',scoreAndReplayDiscarded:true,errors:[]};},
    onReport(report){reports.push(report);}});
  assert.deepEqual(reports.map(report=>report.config.case),['skin-full','native','skin-no-motion','skin-no-muzzle']);
  assert.deepEqual(steps.slice(0,2),['select:skin-full','measure:skin-full']);
  for(const name of ['native','skin-no-motion','skin-no-muzzle'])assert.ok(steps.indexOf('rebuild:'+name)<steps.indexOf('measure:'+name));
  const failed=[];
  await assert.rejects(executeComparisonQueue({initialCase:'native',check(){},selectCase(){},async rebuildViewport(){},
    async measure(name){return {config:{case:name},reason:name==='native'?'completed-10s':'start-error',scoreAndReplayDiscarded:true,errors:[]};},onReport:value=>failed.push(value)}),/未正常完成/);
  assert.equal(failed.length,1,'a failed reentry stops the remaining queue and keeps previous reports');
});

test('repeat-current queue retains repeated rounds and rebuilds between them',async()=>{
  const steps=[];
  await executeComparisonQueue({initialCase:'skin-full',cases:['skin-full','skin-full','skin-full'],check(){},
    selectCase:(name,index)=>steps.push('select:'+index),rebuildViewport:async()=>steps.push('rebuild'),
    measure:async()=>({reason:'completed-10s',scoreAndReplayDiscarded:true,errors:[]}),onReport:()=>steps.push('report')});
  assert.deepEqual(steps,['select:0','report','select:1','rebuild','report','select:2','rebuild','report']);
});

test('mutable shared configuration reaches the loader and muzzle controls without storage or navigation',async()=>{
  const config=query('native'),state={config,models:{},sampling:false},pack={key:'champions-2023/vandal',motions:{original:true}};
  const bridge=createComparisonWeaponBridge({config:state.config,state,skins:{selection:()=>({collection:'champions-2023'}),subscribe:()=>()=>{},async initialize(){}},
    createLoader({skins}){return {async load(){return skins.selection('vandal').modelEnabled?pack:null;},picture:()=>null};},createAppearance:options=>options,normalLoad(){},normalImage(){}});
  assert.equal(await bridge.loadWeaponModel('viewmodel'),null);
  config.case='skin-full';assert.equal(await bridge.loadWeaponModel('viewmodel'),pack);
  config.case='skin-no-motion';assert.equal((await bridge.loadWeaponModel('viewmodel')).motions,null);
  let calls=0;const effects=bridge.wrapMuzzle({frame(){calls++;},render(){calls++;}});
  config.case='skin-no-muzzle';effects.frame();effects.render();assert.equal(calls,0);
  config.case='skin-full';effects.frame();effects.render();assert.equal(calls,2);
});

test('DOM reentry selects the topmost actually visible matching card, ignoring hidden and offscreen duplicates',()=>{
  const node=(text,top=10,style={},children=[])=>({innerText:text,disabled:false,style:{display:'block',visibility:'visible',...style},
    closest:()=>null,getBoundingClientRect:()=>({top,bottom:top+50,left:10,right:110,width:100,height:50}),querySelectorAll:()=>children});
  const hiddenStart=node('开始',10,{display:'none'}),start=node('开始游玩：测试场景',30),lowerStart=node('开始',300);
  const cards=[node('NO.B212F6',-100,{},[node('开始',-100)]),node('NO.B212F6',10,{display:'none'},[hiddenStart]),node('NO.B212F6',300,{},[lowerStart]),node('NO.B212F6',20,{},[start])];
  const exit=node('退出训练 Q'),documentRef={querySelectorAll:selector=>selector==='article'?cards:[node('退出训练',0,{display:'none'}),exit]};
  const windowRef={innerHeight:1080,innerWidth:1920,getComputedStyle:element=>element.style};
  assert.equal(comparisonDomButton(documentRef,windowRef,'start'),start);
  assert.equal(comparisonDomButton(documentRef,windowRef,'exit'),exit);
  const direct=node('返回训练清单'),directDocument={querySelectorAll:selector=>selector==='button[data-action="exit-train"]'?[direct]:documentRef.querySelectorAll(selector)};
  assert.equal(comparisonDomButton(directDocument,windowRef,'exit'),direct,'prefer the direct outer-layer exit over a visible pause menu button');
  cards.length=0;assert.equal(comparisonDomButton(documentRef,windowRef,'start'),null);
});

test('render report aggregates native draw counters and delayed finite GPU samples independently',()=>{
  const stats=values=>values.length?{samples:values.length,mean:values.reduce((sum,value)=>sum+value,0)/values.length}:null;
  const result=summarizeTrainingRenderSamples({tick:[{duration:1}],render:[
    {duration:2,drawStats:{calls:10,triangles:100,lines:2,points:3,renderPasses:4,gpuTimingSupported:true,gpuSamplesMs:[5,NaN]}},
    {duration:3,drawStats:{calls:20,triangles:200,lines:4,points:5,renderPasses:6,gpuSamplesMs:[7],gpuDisjoint:true}}]},stats);
  assert.deepEqual(result.gpuSamplesMs,[5,7]);assert.equal(result.gpuDrawMs.mean,6);assert.equal(result.drawStats.calls.mean,15);
  assert.equal(result.drawStats.renderPasses.mean,5);assert.equal(result.gpuTimingSupported,true);assert.equal(result.gpuDisjoint,true);
  assert.match(result.gpuMethod,/later frames/);
});

test('clean current production modules generate a separate overlay with fixture persistence guards and valid ESM',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aim-performance-test-')),output=path.join(directory,'overlay');
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('aim-performance-test-'));fs.rmSync(directory,{recursive:true,force:true});});
  const input=path.join(repository,'dist'),protectedFiles=['index.html','js/CymPR-fm.js','js/CFqO0zvx.js'].map(file=>path.join(input,file));
  protectedFiles.push(path.join(repository,'qa-artifacts/training-profile-runtime.json'),path.join(repository,'qa-artifacts/training-profile-original-runtime.js'));
  const before=protectedFiles.map(digest),manifest=writePerformanceComparison({inputDir:input,outputDir:output});
  assert.deepEqual(protectedFiles.map(digest),before,'production modules and existing diagnostic backups are untouched');
  assert.equal(manifest.measured,false);assert.deepEqual(manifest.cases,['native','skin-full','skin-no-motion','skin-no-muzzle']);
  for(const file of ['js/CymPR-fm.js','js/CFqO0zvx.js','js/aim-comparison-weapon-models.mjs','__performance-comparison.mjs']){
    const source=fs.readFileSync(path.join(output,'dist',file),'utf8');parse(source,{ecmaVersion:'latest',sourceType:'module'});
  }
  const native=fs.readFileSync(path.join(output,'dist/js/CymPR-fm.js'),'utf8');
  assert.ok(native.includes('if(__aimFixture||__aimFixtureTainted)'),'original fixture intercepts result writes even after stopping');
  assert.ok(native.includes('nt=null;'),'fixture discards its replay recorder');
  const html=fs.readFileSync(path.join(output,'dist/index.html'),'utf8');assert.ok(html.includes('await import("/__performance-comparison.mjs")'));
  const runtime=fs.readFileSync(path.join(output,'dist/__performance-comparison.mjs'),'utf8');
  assert.ok(runtime.includes('scoreAndReplayDiscarded'));assert.ok(!runtime.includes('localStorage'));
  assert.ok(runtime.includes('performance-comparison-all-json'));assert.ok(runtime.includes('event.isTrusted'));
  assert.ok(runtime.includes('requestFullscreen()'));assert.ok(runtime.includes('document.hasFocus()'));assert.ok(runtime.includes("['focus','blur']"));
  const models=fs.readFileSync(path.join(output,'dist/js/aim-comparison-weapon-models.mjs'),'utf8');assert.ok(models.includes('const config=state?.config??readComparisonConfig'));
  assert.throws(()=>writePerformanceComparison({inputDir:input,outputDir:input}),/separate/);
  assert.throws(()=>writePerformanceComparison({inputDir:input,outputDir:output}),/already exists/);
});
