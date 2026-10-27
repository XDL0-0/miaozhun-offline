// Generate an overlay for a separate test copy. Never changes production dist.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {installTrainingFixture} from './training-profile-fixture.mjs';
import {applySpatialInstancingPatch} from '../patches/world-performance.mjs';
import {applyTrainingGraphicsPhases} from './training-graphics-phases.mjs';
const {parse}=createRequire(import.meta.url)('./vendor/acorn.cjs');
const repository=fileURLToPath(new URL('../',import.meta.url));
const syntax=source=>parse(source,{ecmaVersion:'latest',sourceType:'module'});

export function comparisonCases(graphicsSweep=false){
  return graphicsSweep?['gfx-default','gfx-no-msaa','gfx-75','gfx-50','gfx-low-tier','gfx-standard-no-msaa','gfx-no-shadows']:['native','skin-full','skin-no-motion','skin-no-muzzle'];
}

export function readComparisonConfig(search,graphicsSweep=false){
  const query=new URLSearchParams(search),cases=comparisonCases(graphicsSweep);
  return {
    enabled:query.get('__performanceComparison')==='1'&&query.get('__offlineProfile')==='1',
    graphicsSweep,
    case:cases.includes(query.get('__comparisonCase'))?query.get('__comparisonCase'):graphicsSweep?'gfx-default':'skin-full',
    collection:/^[a-z0-9-]{1,64}$/.test(query.get('__comparisonCollection')??'')?query.get('__comparisonCollection'):null,
    theme:/^[a-z0-9-]{1,64}$/.test(query.get('__comparisonTheme')??'')?query.get('__comparisonTheme'):null,
    weapon:['vandal','phantom','sheriff','operator','melee'].includes(query.get('__comparisonWeapon'))?query.get('__comparisonWeapon'):'vandal',
    label:(query.get('__comparisonLabel')??'').slice(0,160)
  };
}

export function comparisonViewportOptions(options,config){
  if(!config?.enabled||!config.graphicsSweep)return options;
  if(config.case==='gfx-75'||config.case==='gfx-50')return {...options,renderScale:config.case==='gfx-75'?.75:.5,renderResolution:null};
  if(config.case==='gfx-low-tier')return {...options,gpu:{tier:'low'}};
  if(config.case==='gfx-standard-no-msaa')return {...options,lowLatency:false};
  if(config.case==='gfx-no-shadows')return {...options,shadows:false};
  return options;
}

export function comparisonMSAAEnabled(nativeValue,config){
  return config?.enabled&&config.graphicsSweep&&(config.case==='gfx-no-msaa'||config.case==='gfx-standard-no-msaa')?false:nativeValue;
}

export async function executeComparisonQueue({initialCase,cases:availableCases=comparisonCases(),selectCase,rebuildViewport,measure,onReport,check}){
  const first=availableCases.indexOf(initialCase);
  const cases=[initialCase,...availableCases.filter((name,index)=>index!==first)];
  for(let index=0;index<cases.length;index++){
    check();selectCase(cases[index],index);
    if(index>0)await rebuildViewport(cases[index]);
    check();const report=await measure(cases[index]);check();
    if(report?.reason!=='completed-10s'||report.errors?.length||report.scoreAndReplayDiscarded!==true)throw Error('对照组未正常完成：'+cases[index]+' · '+(report?.reason??'no report'));
    onReport(report);
  }
}

export function comparisonDomButton(documentRef,windowRef,kind,sceneId='NO.B212F6'){
  const visible=element=>{
    if(element.disabled||element.closest?.('[hidden],[inert],[aria-hidden="true"]'))return false;
    const rect=element.getBoundingClientRect(),style=windowRef.getComputedStyle(element);
    return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<windowRef.innerHeight&&rect.left<windowRef.innerWidth&&style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse';
  };
  const text=element=>(element.innerText??element.textContent??'').replace(/\s+/g,' ').trim();
  let candidates;
  if(kind==='exit'){
    // The outer training layer exposes this direct exit whenever pointerLive
    // is free, including fixture completion. Prefer it over the pause menu.
    const direct=[...documentRef.querySelectorAll('button[data-action="exit-train"]')].filter(element=>visible(element)&&/^(?:返回训练清单|Back to Drill List)$/i.test(text(element)));
    if(direct.length>1)throw Error('可见返回训练清单按钮不唯一');
    if(direct.length===1)return direct[0];
    candidates=[...documentRef.querySelectorAll('button')].filter(element=>visible(element)&&/^(?:退出训练|Exit Training)(?:\s|Q|\[|$)/i.test(text(element)));
  }
  else{
    const articles=[...documentRef.querySelectorAll('article')].filter(element=>visible(element)&&text(element).toUpperCase().includes(sceneId.toUpperCase())).sort((a,b)=>Math.max(0,a.getBoundingClientRect().top)-Math.max(0,b.getBoundingClientRect().top));
    if(!articles.length)return null;
    candidates=[...articles[0].querySelectorAll('button')].filter(element=>visible(element)&&/^(?:开始(?:训练|游玩)?|Start(?: Training| Playing)?|Play)(?:\s|[:：]|$)/i.test(text(element)));
  }
  if(candidates.length>1)throw Error('可见按钮不唯一：'+kind);
  return candidates[0]??null;
}

export function summarizeTrainingRenderSamples(cpu,stats){
  if(!cpu)return null;
  const renders=cpu.render??[],drawFields=['calls','triangles','lines','points','renderPasses'];
  const gpuSamplesMs=renders.flatMap(value=>value.drawStats?.gpuSamplesMs??[]).filter(Number.isFinite);
  const renderPhaseNames=[...new Set(renders.flatMap(value=>Object.keys(value.phases??{})))];
  const graphicsPhaseNames=[...new Set(renders.flatMap(value=>Object.keys(value.graphicsPhases??{})))];
  return {
    tick:stats((cpu.tick??[]).map(value=>value.duration)),renderSubmit:stats(renders.map(value=>value.duration)),
    diagnosticInstrumentation:stats(renders.map(value=>value.diagnosticDuration).filter(Number.isFinite)),
    renderPhases:Object.fromEntries(renderPhaseNames.map(name=>[name,stats(renders.map(value=>value.phases?.[name]??0))])),
    graphicsPhases:Object.fromEntries(graphicsPhaseNames.map(name=>[name,stats(renders.map(value=>value.graphicsPhases?.[name]??0))])),
    drawStats:Object.fromEntries(drawFields.map(name=>[name,stats(renders.map(value=>value.drawStats?.[name]).filter(Number.isFinite))])),
    gpuSamplesMs,gpuDrawMs:stats(gpuSamplesMs),gpuTimingSupported:renders.some(value=>value.drawStats?.gpuTimingSupported===true),
    gpuDisjoint:renders.some(value=>value.drawStats?.gpuDisjoint===true),
    gpuMethod:'Asynchronous completed EXT_disjoint_timer_query_webgl2 samples for the full yd GPU command segment; samples arrive in later frames and do not map one-to-one to the current render record. Elapsed GPU time may include idle gaps while CPU updates prepare commands, so it is not isolated shader time; browser compositor work is outside this interval. No finish or synchronous query wait.',
    droppedTicks:cpu.droppedTicks,droppedRenders:cpu.droppedRenders,droppedPhases:cpu.droppedPhases
  };
}

// This mirrors the review harness's private loader. Saved skin choices are read
// through the existing runtime; no select(), storage write or settings patch.
export function createComparisonWeaponBridge({config,skins,createLoader,createAppearance,normalLoad,normalImage,state}){
  const selection=weapon=>{
    const saved=skins.selection(weapon);
    if(config.case==='native')return {...saved,collection:'default',modelEnabled:false};
    if(weapon===config.weapon){
      const collection=config.collection??(saved.collection!=='default'?saved.collection:'champions-2023');
      return {...saved,collection,theme:config.theme??saved.theme??'default',modelEnabled:true};
    }
    return saved;
  };
  const privateSkins={initialize:()=>skins.initialize(),selection,subscribe:callback=>skins.subscribe(callback)};
  const loader=config.enabled?createLoader({skins:privateSkins}):null;
  const stemWeapon=stem=>stem==='viewmodel'?'vandal':stem==='knife'?'melee':stem;
  if(loader){
    const originalLoad=loader.load.bind(loader);
    loader.load=async stem=>{
      const pack=await originalLoad(stem),weapon=stemWeapon(stem),selected=selection(weapon);
      if(state)state.models[stem]={weapon,selection:selected,loadedKey:pack?.key??null,skinMotion:!!pack?.motions&&config.case!=='skin-no-motion'};
      return pack&&config.case==='skin-no-motion'?{...pack,motions:null}:pack;
    };
  }
  function timed(name,callback,receiver,first,second){
    if(!state?.sampling)return callback.call(receiver,first,second);
    const at=performance.now();
    try{return callback.call(receiver,first,second);}
    finally{state.record(name,performance.now()-at);}
  }
  function wrapMethod(object,name,bucket){
    const original=object[name];if(typeof original!=='function')return;
    object[name]=function(first,second){return timed(bucket,original,this,first,second);};
  }
  return {
    async loadWeaponModel(stem){
      if(!config.enabled)return normalLoad(stem);
      return loader.load(stem);
    },
    createWeaponAppearance(options){return createAppearance(config.enabled?{...options,skins:privateSkins,loader}:options);},
    weaponEffectImage(url){return config.enabled?(loader.picture(url)??normalImage(url)):normalImage(url);},
    wrapNativeViewModel(model,stem){
      if(!config.enabled)return model;
      wrapMethod(model,'update','viewmodel.update:'+stem);
      wrapMethod(model,'render','viewmodel.render:'+stem);
      if(state){
        state.modelProofs??={};
        state.modelProofs[stem]=()=>{
          const meshes=[],layer=model.fxLayer?.();let nonfinite=0;
          layer?.scene?.traverseVisible?.(object=>{
            if(!object.geometry)return;
            meshes.push(object.name);
            for(const value of object.matrixWorld?.elements??[])if(!Number.isFinite(value))nonfinite++;
          });
          return {activeKey:model.skinEffectsKey?.()??null,visibleMeshes:meshes,nonfiniteMatrices:nonfinite};
        };
      }
      return model;
    },
    wrapMuzzle(effects){
      if(!config.enabled)return effects;
      for(const name of ['frame','render']){
        const original=effects[name];
        effects[name]=function(first,second){
          if(config.case==='skin-no-muzzle')return;
          return timed('muzzle.'+name,original,this,first,second);
        };
      }
      return effects;
    }
  };
}

function comparisonRuntime(graphicsSweep=false){
  const config=readComparisonConfig(location.search,graphicsSweep);
  if(!config.enabled||document.getElementById('performance-comparison'))return;
  const query=new URLSearchParams(location.search),requestedRepeats=Number(query.get('__repeatCurrent'));
  const repeatCurrent=Number.isInteger(requestedRepeats)&&requestedRepeats>=2&&requestedRepeats<=6?requestedRepeats:0;
  const state={config,sampling:false,models:{},record(name,duration){
    if(!run||!state.sampling)return;const bucket=run.timings[name]??=([]);
    if(bucket.length<4000)bucket.push(duration);else run.droppedTimings++;
  }};
  window.__aimPerformanceComparison=state;
  let bridge=null,bridgeVersion=0,run=null,report=null,raf=null,statusTimer=null,watchdog=null,lastFixture=null,queue=null;
  const focusEvents=[];
  for(const type of ['focus','blur'])window.addEventListener(type,()=>{focusEvents.push({type,at:performance.now(),focused:document.hasFocus(),visibility:document.visibilityState});if(focusEvents.length>200)focusEvents.shift();});
  const host=document.createElement('section');host.id='performance-comparison';
  Object.assign(host.style,{position:'fixed',right:'8px',bottom:'8px',zIndex:'2147483647',width:'340px',maxWidth:'95vw',padding:'9px',background:'#101923f2',border:'1px solid #718298',borderRadius:'6px',color:'#eef4fc',font:'12px system-ui',lineHeight:'1.5',boxSizing:'border-box'});
  const title=document.createElement('b');title.textContent='诊断对照 · '+config.case;
  const seriesName=repeatCurrent?repeatCurrent+'轮':config.graphicsSweep?'七组':'四组';
  const notice=document.createElement('div');notice.textContent=config.graphicsSweep?'画面参数诊断；全部保留完整皮肤、动画与枪口。低档组会改变灯光预算/MSAA/DPR上限，均不属于最终优化。':'仅用于定位成本；停动画或特效不属于最终优化。';
  const status=document.createElement('div');status.id='performance-comparison-status';status.textContent='进入同一训练场景后运行；等待原生引擎。';
  const controls=document.createElement('div');Object.assign(controls.style,{display:'flex',gap:'5px',margin:'6px 0',flexWrap:'wrap'});
  function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);controls.append(b);return b;}
  const allLabel=repeatCurrent?'重复当前组 '+repeatCurrent+' 次':config.graphicsSweep?'一键运行全部':'一键运行四组';
  const start=button('运行10秒对照',begin),all=button(allLabel,event=>{
    if(!event.isTrusted){status.textContent='请直接用鼠标点击“'+allLabel+'”，避免自动化切走OS前台。';return;}
    void beginAll();
  }),stop=button('停止',()=>{if(queue?.active)queue.cancelled=true;bridge?.stop();if(run?.active)finish('manual-stop');});
  const download=button('导出诊断',()=>{
    const combined=queue?.reports.length&&!queue.active;if(!combined&&!report)return;
    const url=URL.createObjectURL(new Blob([combined?aggregate.value:output.value],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='performance-comparison-'+(combined?'all':config.case)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });start.disabled=true;all.disabled=true;stop.disabled=true;download.disabled=true;
  const links=document.createElement('div');
  for(const name of comparisonCases(config.graphicsSweep)){
    const link=document.createElement('a'),url=new URL(location.href);url.searchParams.set('__comparisonCase',name);link.href=url.href;link.textContent=name+' ';link.style.color='#9dcaff';links.append(link);
  }
  const output=document.createElement('textarea');output.id='performance-comparison-json';output.readOnly=true;output.hidden=true;output.setAttribute('aria-hidden','true');
  const aggregate=document.createElement('textarea');aggregate.id='performance-comparison-all-json';aggregate.readOnly=true;aggregate.hidden=true;aggregate.setAttribute('aria-hidden','true');
  host.append(title,notice,status,controls,links,output,aggregate);
  if(document.body)document.body.append(host);else document.addEventListener('DOMContentLoaded',()=>document.body.append(host),{once:true});
  const now=()=>performance.now(),round=value=>Number.isFinite(value)?Math.round(value*1000)/1000:null;
  const environment=()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState,hidden:document.hidden,focused:document.hasFocus(),canvases:[...document.querySelectorAll('canvas')].map(canvas=>({className:canvas.className,width:canvas.width,height:canvas.height}))});
  const visibility=()=>({at:now(),state:document.visibilityState,hidden:document.hidden});
  document.addEventListener('visibilitychange',()=>{
    if(run?.active)run.visibility.push(visibility());
    if(queue?.active&&document.hidden){queue.failure='页面被隐藏，'+seriesName+'队列已停止；请保持测试窗口在前台';bridge?.stop();if(run?.active)finish('page-hidden');}
  });
  function stats(values){
    if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),mean=values.reduce((sum,value)=>sum+value,0)/values.length;
    const p=fraction=>round(sorted[Math.max(0,Math.ceil(fraction*sorted.length)-1)]);
    return {samples:values.length,mean:round(mean),p50:p(.5),p95:p(.95),p99:p(.99),max:round(sorted.at(-1))};
  }
  window.__offlineTrainingFixtureRegistry={
    register(value){bridge=value;bridgeVersion++;start.disabled=!!queue?.active;all.disabled=!!queue?.active;status.textContent='引擎已连接；当前组 '+config.case+'。';},
    graphicsPhase(name){bridge?.graphicsPhase?.(name);},
    event(kind,value){
      lastFixture=value;
      if(kind==='running'&&run){run.runningAt=now();run.environment=environment();run.visibility.push(visibility());state.sampling=true;status.textContent='固定seed训练采样中…';}
      if(kind==='stopped'&&run)finish(value.reason);
    },
    caught(error){if(run)run.errors.push(String(error?.stack??error?.message??error));}
  };
  async function begin(){
    if(!bridge||run?.active)return;
    run={active:true,startedAt:now(),runningAt:null,frames:[],visibility:[],timings:{},droppedTimings:0,errors:[]};
    const completed=new Promise(resolve=>{run.resolve=resolve;});report=null;output.value='';host.dataset.reportReady='false';
    start.disabled=true;stop.disabled=false;download.disabled=true;status.textContent='先等20个可见预览帧，再由原生准备门预热并开始固定输入。';
    try{
      for(let index=0;index<20;index++){await new Promise(requestAnimationFrame);if(!run.active)return completed;if(document.hidden)throw Error('预览时页面隐藏，请回到前台重试');}
      const result=bridge.start();if(!result.ok)throw Error(result.reason);
      raf=requestAnimationFrame(frame);
      statusTimer=setInterval(()=>{if(run?.active&&state.sampling)status.textContent='采样 '+((now()-run.runningAt)/1000).toFixed(1)+'秒 · '+run.frames.length+' RAF帧 · '+config.case;},500);
      watchdog=setTimeout(()=>{if(run?.active){run.errors.push('Fixture did not finish within 30 seconds');bridge.stop();if(run.active)finish('watchdog');}},30000);
    }catch(error){run.errors.push(String(error.message??error));finish('start-error');}
    return completed;
  }
  function frame(timestamp){
    if(!run?.active)return;
    if(state.sampling&&run.frames.length<4000)run.frames.push({at:now(),timestamp,hidden:document.hidden,visibility:document.visibilityState,focused:document.hasFocus()});
    raf=requestAnimationFrame(frame);
  }
  function finish(reason){
    if(!run?.active)return;run.active=false;state.sampling=false;cancelAnimationFrame(raf);clearInterval(statusTimer);clearTimeout(watchdog);
    const endedAt=now(),fixture=bridge?.snapshot?.()??lastFixture,intervals=[];
    for(let index=1;index<run.frames.length;index++){
      const a=run.frames[index-1],b=run.frames[index],ms=b.timestamp-a.timestamp;
      const hidden=run.visibility.some(event=>event.at>=a.at&&event.at<=b.at&&(event.hidden||event.state!=='visible'));
      if(ms>0)intervals.push({ms,foreground:!hidden&&!a.hidden&&!b.hidden&&a.visibility==='visible'&&b.visibility==='visible'&&a.focused&&b.focused});
    }
    const all=stats(intervals.map(value=>value.ms)),foreground=stats(intervals.filter(value=>value.foreground).map(value=>value.ms)),cpu=fixture?.nativeCpu;
    const native=summarizeTrainingRenderSamples(cpu,stats);
    const modelProof=Object.fromEntries(Object.entries(state.modelProofs??{}).map(([stem,proof])=>{try{return [stem,proof()];}catch(error){return [stem,{error:String(error)}];}}));
    if(config.case==='native'){
      if(Object.values(modelProof).some(value=>value.activeKey))run.errors.push('原版组仍存在活动皮肤枪模，停止比较');
    }else{
      const requested=Object.entries(state.models).filter(([,value])=>value.weapon===config.weapon);
      if(!requested.length||requested.some(([stem,value])=>!value.loadedKey||modelProof[stem]?.activeKey!==value.loadedKey))run.errors.push('指定武器的皮肤枪模未正确加载或显示，停止比较；检查 models/modelProof');
    }
    if(Object.values(modelProof).some(value=>value.error||value.nonfiniteMatrices))run.errors.push('枪模形态记录异常，停止比较');
    report={schemaVersion:1,kind:'deterministic-native-engine-comparison',diagnosticOnly:true,recordedAt:new Date().toISOString(),config:{...config},reason,
      window:{startedAt:round(run.startedAt),runningAt:round(run.runningAt),endedAt:round(endedAt)},environmentStart:run.environment??null,environmentEnd:environment(),
      seed:fixture?.seed??null,ticks:fixture?.tick??null,simulationSeconds:fixture?.simulationSeconds??null,script:fixture?.script??null,
      scoreAndReplayDiscarded:fixture?.scoreAndReplayDiscarded??false,models:state.models,
      graphicsExperiment:{enabled:config.graphicsSweep,case:config.case,viewport:state.graphicsViewport??null,
        method:'Query-only constructor overrides. gfx-default retains original values. gfx-no-msaa retains lowLatency and forces only the native MSAA selector a=false for both hR(a) and fallback WebGL context. gfx-standard-no-msaa sets lowLatency=false and forces a=false. gfx-no-shadows changes only shadows=false. gfx-75/50 retain original lowLatency/MSAA policy, use absolute renderScale .75/.5, and clear explicit renderResolution. gfx-low-tier retains original viewport options except gpu={tier:low}; native low tier has pointLights=4, spotLights=1, msaa=false, maxPixelRatio=1, so it is a combined quality diagnostic rather than an isolated lighting test. Complete skin models, animation and muzzle remain enabled. No persisted display setting is changed.'},
      modelProof,
      raf:{all,foreground,allFps:all?round(1000/all.mean):null,foregroundFps:foreground?round(1000/foreground.mean):null,frameCount:run.frames.length,cap:4000,visibilityEvents:run.visibility,frames:run.frames},
      nativeCpu:native,gpuBackpressure:fixture?.gpuBackpressure??null,nativeTimeline:query.get('__detailedTimings')==='1'?{tick:cpu?.tick??[],render:cpu?.render??[],phase:cpu?.phase??[]}:undefined,
      gpuSamplesMs:native?.gpuSamplesMs??[],focusEvents:focusEvents.filter(event=>event.at>=run.startedAt&&event.at<=endedAt),
      componentCpu:Object.fromEntries(Object.entries(run.timings).map(([name,values])=>[name,stats(values)])),droppedComponentTimings:run.droppedTimings,errors:run.errors,
      controls:{selection:'Private loader reads existing in-memory skin selection. Explicit query overrides affect models only. Saved audio, banner and graphics settings are unchanged.',
        fallback:'If the requested weapon has no skin selected, its comparison fallback is Champions 2023; inspect models.loadedKey before accepting a run.',
        native:'Original viewmodel and original muzzle assets; existing selected audio is retained. This comparison changes both weapon appearance and muzzle assets.',
        noMotion:'Skips only extra skin montages; native hand/gun skeleton animation, skin geometry, materials and rendering remain.',
        noMuzzle:'Skips only muzzle frame/render; preparation still allocates the same skin muzzle assets.',
        method:'Same seed, ten simulation seconds, twenty preview RAFs and existing native preparation gate. DOM focus/visibility cannot prove OS foreground; use external OS sampling for that. RAF and CPU submissions are not presented-frame counts. Do not call diagnostic feature removal a final fix.'}};
    output.value=JSON.stringify(report,null,2);host.dataset.reportReady='true';start.disabled=!!queue?.active;all.disabled=!!queue?.active;stop.disabled=!queue?.active;download.disabled=false;
    status.textContent='完成 '+reason+' · '+(report.raf.foregroundFps??'—')+' RAF FPS · 可导出';
    run.resolve(report);
  }

  function checkQueue(){
    if(queue?.failure)throw Error(queue.failure);
    if(!queue?.active||queue.cancelled)throw Error('用户已停止'+seriesName+'队列');
    if(document.hidden)throw Error('页面被隐藏，'+seriesName+'队列已停止；请保持测试窗口在前台');
  }
  async function waitFor(predicate,label,timeout=20000){
    const started=now();
    for(;;){checkQueue();const value=predicate();if(value)return value;if(now()-started>timeout)throw Error('等待超时：'+label);await new Promise(resolve=>setTimeout(resolve,100));}
  }
  function publishAll(){
    aggregate.value=JSON.stringify({...queue,focusEvents:focusEvents.filter(event=>event.at>=queue.startedAt),foregroundEvidence:'DOM hasFocus/visibility is observational only. OS foreground/QoS sampling is authoritative.'},null,2);
    host.dataset.allReady=String(!queue.active);
  }
  async function beginAll(){
    if(!bridge||run?.active||queue?.active)return;
    queue={active:true,cancelled:false,startedAt:now(),initialCase:config.case,scene:'NO.B212F6',reports:[],errors:[],events:[],fullscreen:{alreadyActive:!!document.fullscreenElement,attempted:false,entered:false}};
    host.dataset.allReady='false';host.dataset.queueActive='true';all.disabled=true;start.disabled=true;stop.disabled=false;
    try{
      // Called synchronously from the trusted button handler, before other awaits.
      if(!document.fullscreenElement&&document.documentElement.requestFullscreen){
        queue.fullscreen.attempted=true;
        try{await document.documentElement.requestFullscreen();queue.fullscreen.entered=document.fullscreenElement===document.documentElement;}
        catch(error){queue.fullscreen.rejection=String(error?.message??error);}
      }
      await executeComparisonQueue({initialCase:config.case,cases:repeatCurrent?Array(repeatCurrent).fill(config.case):comparisonCases(config.graphicsSweep),check:checkQueue,
        selectCase(name,index){config.case=name;title.textContent='诊断对照 · '+name;queue.events.push({at:now(),kind:'case',case:name,index});},
        async rebuildViewport(name){
          status.textContent='切换 '+name+'：退出训练并重新打开 NO.B212F6…';
          const oldVersion=bridgeVersion;
          const exit=await waitFor(()=>comparisonDomButton(document,window,'exit'),'可见退出训练按钮');exit.click();
          await waitFor(()=>!comparisonDomButton(document,window,'exit'),'退出训练并返回大厅');
          const scene=await waitFor(()=>comparisonDomButton(document,window,'start'),'NO.B212F6 可见卡片的开始按钮');
          state.models={};state.modelProofs={};bridge=null;scene.click();
          await waitFor(()=>bridge&&bridgeVersion>oldVersion,'新训练viewport和fixture bridge注册',30000);
        },
        measure:()=>begin(),onReport(value){queue.reports.push(value);publishAll();}
      });
      queue.completed=true;
    }catch(error){queue.errors.push(String(error?.message??error));status.textContent=seriesName+'队列停止：'+queue.errors.at(-1);}
    finally{
      queue.active=false;queue.endedAt=now();state.sampling=false;
      if(queue.fullscreen.entered&&!queue.fullscreen.alreadyActive&&document.fullscreenElement===document.documentElement){
        try{await document.exitFullscreen();queue.fullscreen.restored=true;}catch(error){queue.fullscreen.restoreError=String(error?.message??error);}
      }
      publishAll();host.dataset.queueActive='false';all.disabled=!bridge;start.disabled=!bridge;stop.disabled=true;
      if(queue.completed)status.textContent=seriesName+'完成；aggregate JSON 已保存，可导出。';
      if(!queue.completed&&run?.active){bridge?.stop();if(run.active)finish('queue-stopped');}
    }
  }
}

function replaceOne(source,before,after,label){
  if(source.split(before).length!==2)throw Error('Comparison version mismatch: '+label);
  return source.replace(before,after);
}

export function readSpatialCellSizeOption(argv){
  const name='--spatial-cell-size',matches=argv.map((value,index)=>({value,index})).filter(({value})=>typeof value==='string'&&(value===name||value.startsWith(name+'=')));
  if(!matches.length)return null;
  if(matches.length!==1)throw Error('Specify --spatial-cell-size only once');
  const {value,index}=matches[0];
  return validateSpatialCellSize(value===name?argv[index+1]:value.slice(name.length+1));
}

function validateSpatialCellSize(value){
  const size=typeof value==='number'?value:typeof value==='string'&&/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)?Number(value):NaN;
  if(!Number.isFinite(size)||size<=0)throw Error('--spatial-cell-size requires a positive finite number, for example 24');
  return size;
}

export function writePerformanceComparison({inputDir=path.join(repository,'dist'),outputDir,spatialCellSize=null,graphicsSweep=false,graphicsPhases=false}={}){
  if(spatialCellSize!==null)spatialCellSize=validateSpatialCellSize(spatialCellSize);
  if(typeof graphicsSweep!=='boolean')throw Error('graphicsSweep must be a boolean');
  if(typeof graphicsPhases!=='boolean')throw Error('graphicsPhases must be a boolean');
  if(!outputDir)throw Error('An explicit non-production output directory is required');
  inputDir=path.resolve(inputDir);outputDir=path.resolve(outputDir);
  if(outputDir===inputDir||outputDir.startsWith(inputDir+path.sep)||inputDir.startsWith(outputDir+path.sep))throw Error('Comparison output must be separate from production input');
  if(fs.existsSync(outputDir))throw Error('Comparison output already exists; choose a fresh directory');
  const names=fs.readdirSync(path.join(inputDir,'js')),games=names.filter(name=>/^CymPR.*\.js$/.test(name));
  if(games.length!==1)throw Error('Expected one current native training module');
  const gameName=games[0],viewName='CFqO0zvx.js';
  const graphicsName='aQOfOAp-.js';
  let graphics=null;
  if(spatialCellSize!==null||graphicsSweep||graphicsPhases){
    const source=fs.readFileSync(path.join(inputDir,'js',graphicsName),'utf8');
    graphics=spatialCellSize!==null?applySpatialInstancingPatch({[graphicsName]:source},{cellSize:spatialCellSize})[graphicsName]:source;
    if(graphicsSweep){
      graphics=replaceOne(graphics,'a=s.msaa&&aR(n,t,s.maxPixelRatio)<rR',
        'a=__aimComparisonMSAAEnabled(s.msaa&&aR(n,t,s.maxPixelRatio)<rR,typeof window!=="undefined"?window.__aimPerformanceComparison?.config:null)','query-only native MSAA selector');
      graphics='const __aimComparisonMSAAEnabled='+comparisonMSAAEnabled.toString()+';\n'+graphics;
    }
    if(graphicsPhases)graphics=applyTrainingGraphicsPhases({[graphicsName]:graphics})[graphicsName];
    syntax(graphics);
  }
  let game=fs.readFileSync(path.join(inputDir,'js',gameName),'utf8'),view=fs.readFileSync(path.join(inputDir,'js',viewName),'utf8'),html=fs.readFileSync(path.join(inputDir,'index.html'),'utf8');
  if(game.includes('/*__offlineTrainingFixture__*/')||html.includes('__performance-comparison.mjs'))throw Error('Use a clean production build as comparison input');
  const originalModelImport='from"./aim-weapon-models.mjs"',comparisonImport='from"./aim-comparison-weapon-models.mjs"';
  game=replaceOne(game,originalModelImport,comparisonImport,'training model import');
  view=replaceOne(view,originalModelImport,comparisonImport,'viewmodel model import');
  view=replaceOne(view,'return bb;}export{Tn as a,qn as c,En as l};','return __aimComparisonWrapModel(bb,J.stem);}export{Tn as a,qn as c,En as l};','native model timing');
  view='import{wrapNativeViewModel as __aimComparisonWrapModel}from"./aim-comparison-weapon-models.mjs";\n'+view;
  game=replaceOne(game,'function qv(e){','function __aimComparisonNativeMuzzle(e){','native muzzle factory');
  game='import{wrapMuzzle as __aimComparisonWrapMuzzle}from"./aim-comparison-weapon-models.mjs";function qv(options){return __aimComparisonWrapMuzzle(__aimComparisonNativeMuzzle(options));}\n'+game;
  if(graphicsSweep){
    const viewportOptions='{renderScale:t.renderScale.current,renderResolution:t.renderResolution?.current??null,aspectRatio:t.aspectRatio.current,lowLatency:t.lowLatency.current,shadows:t.shadows.current}';
    game=replaceOne(game,'a(e,nl(0),'+viewportOptions+')','a(e,nl(0),__aimComparisonViewportOptions('+viewportOptions+'))','query-only graphics constructor options');
    game='import{viewportOptions as __aimComparisonViewportOptions}from"./aim-comparison-weapon-models.mjs";\n'+game;
  }
  const tags=[...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)];
  if(tags.length!==1)throw Error('Expected one production module entry');
  html=html.replace(tags[0][0],'<script type="module">if(new URLSearchParams(location.search).get("__performanceComparison")==="1"&&new URLSearchParams(location.search).get("__offlineProfile")==="1")await import("/__performance-comparison.mjs");await import('+JSON.stringify(tags[0][1])+');</script>');
  const runtime=[comparisonCases,readComparisonConfig,executeComparisonQueue,comparisonDomButton,summarizeTrainingRenderSamples].map(fn=>fn.toString()).join('\n')+'\n('+comparisonRuntime.toString()+')('+graphicsSweep+');\n';
  const models=`import {skinPacks} from './aim-skin-packs.mjs';
import {createWeaponModelLoader,createWeaponAppearance as normalAppearance,loadWeaponModel as normalLoad,weaponEffectImage as normalImage} from './aim-weapon-models.mjs';
${comparisonCases.toString()}
${readComparisonConfig.toString()}
${comparisonViewportOptions.toString()}
${createComparisonWeaponBridge.toString()}
const state=window.__aimPerformanceComparison;
const config=state?.config??readComparisonConfig(location.search,${graphicsSweep});
const bridge=createComparisonWeaponBridge({config,skins:skinPacks,createLoader:createWeaponModelLoader,createAppearance:normalAppearance,normalLoad,normalImage,state});
export const {loadWeaponModel,createWeaponAppearance,weaponEffectImage,wrapNativeViewModel,wrapMuzzle}=bridge;
export const viewportOptions=options=>{
  const effective=comparisonViewportOptions(options,config);
  if(config.enabled&&config.graphicsSweep&&state)state.graphicsViewport={case:config.case,original:{...options},effective:{...effective}};
  return effective;
};
`;
  for(const source of [view,game,runtime,models])syntax(source);
  const destination=path.join(outputDir,'dist');fs.mkdirSync(path.join(destination,'js'),{recursive:true});
  fs.writeFileSync(path.join(destination,'js',gameName),game);fs.writeFileSync(path.join(destination,'js',viewName),view);
  if(graphics!==null)fs.writeFileSync(path.join(destination,'js',graphicsName),graphics);
  fs.writeFileSync(path.join(destination,'js/aim-comparison-weapon-models.mjs'),models);fs.writeFileSync(path.join(destination,'__performance-comparison.mjs'),runtime);fs.writeFileSync(path.join(destination,'index.html'),html);
  installTrainingFixture(outputDir);
  const manifest={schemaVersion:1,measured:false,inputDir,overlayDir:destination,cases:comparisonCases(graphicsSweep),
    experiments:{spatialInstancing:spatialCellSize===null?{enabled:false}:{enabled:true,cellSize:spatialCellSize,module:'js/'+graphicsName,method:'Optional map instance grouping in world-space cells; geometry, materials, atlas attributes and original PVS identities are retained. Compare the same map and settings before accepting a change.'},
      graphicsPhases:{enabled:graphicsPhases,module:graphicsPhases?'js/'+graphicsName:null},
      graphicsSweep:{enabled:graphicsSweep,module:graphicsSweep?'js/'+graphicsName:null,method:'Seven diagnostic cases with full skin, animation and muzzle: original options; only native MSAA selector a=false; absolute renderScale=.75 with renderResolution=null; absolute renderScale=.5 with renderResolution=null; only gpu={tier:low}; standard-no-msaa sets lowLatency=false and a=false; no-shadows changes only shadows=false. Low tier changes point/spot light budgets, MSAA and DPR cap together and is not an isolated lighting test. Stored display settings are unchanged.'}},
    url:'/aim?__offlineProfile=1&__performanceComparison=1&__comparisonCase='+(graphicsSweep?'gfx-default':'skin-full'),
    collection:'Uses the current requested-weapon skin; falls back to Champions 2023 Vandal when none is selected. Override with __comparisonCollection, __comparisonTheme and __comparisonWeapon.',
    deploy:'Overlay generated dist files onto a separate test copy served by the existing server, or serve this overlay with the production dist as a read-only fallback. No server is started.',
    report:'Single: textarea#performance-comparison-json.value. Four-case user-click queue: textarea#performance-comparison-all-json.value; #performance-comparison[data-all-ready="true"].',
    queue:'Open NO.B212F6 training in the initial URL case, then physically click 一键运行全部 for the graphics sweep or 一键运行四组 for the skin comparison. It requests fullscreen, measures that current case, then exits/reopens the visible NO.B212F6 card for each remaining case. A fresh fixture bridge registration is required after each DOM restart. No service, navigation or storage change is used.',
    persistence:'Uses the existing native fixture result/replay guard and a private skin loader; no skin selection is persisted.'};
  fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const option=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
  const manifest=writePerformanceComparison({inputDir:option('--input')??path.join(repository,'dist'),outputDir:option('--output'),spatialCellSize:readSpatialCellSizeOption(process.argv.slice(2)),graphicsSweep:process.argv.includes('--graphics-sweep'),graphicsPhases:process.argv.includes('--graphics-phases')});
  console.log(JSON.stringify(manifest,null,2));
}
