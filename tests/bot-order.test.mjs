import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {applyBotOrderPatch,applyBotOrderCss,publishBotOrder,subscribeBotOrder,offsetBotOrderHead} from '../patches/bot-order.mjs';
import {applyInterpolationPatch} from '../patches/interpolation.mjs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sources={'CymPR-fm.js':read('site/js/CymPR-fm.js'),'DVK7uRSu.js':read('site/js/DVK7uRSu.js'),'tmIeW3Ig.js':read('site/js/tmIeW3Ig.js'),'other.js':'unchanged'};
const patched=applyBotOrderPatch(sources),nativeCss=read('site/css/TrainLayer.CcDeXnwn.css');
const curveStart=sources['CymPR-fm.js'].indexOf('const Yy=.15,'),curveEnd=sources['CymPR-fm.js'].indexOf('function Jy(',curveStart);
const curves=vm.runInNewContext('(function(){'+sources['CymPR-fm.js'].slice(curveStart,curveEnd)+';return{scale:v2,alpha:y2};})()');

class Element{
  constructor(){this.style={};this.classes=new Set();this.textContent='';this.clientWidth=1920;this.clientHeight=1080;this.writes=0;
    this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),remove:(...names)=>names.forEach(name=>this.classes.delete(name)),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
    this.style=new Proxy(this.style,{set:(target,key,value)=>{this.writes++;target[key]=value;return true;}});
  }
}
const empty=()=>({ready:false,labels:[],next:0,aim:{shown:false,x:0,y:0,deltaM:0}});
function hud(source=patched['DVK7uRSu.js'],view={current:empty()}){
  const begin=source.indexOf("Nl=c({'__name':'BotOrderOverlay'"),end=source.indexOf(',Pl=w(Nl,',begin);assert(begin>=0&&end>begin);
  const code=source.slice(begin+'Nl='.length,end).replace("cB({'tick':","cB({'register':cJ,'tick':");
  const root=new Element(),aim=new Element(),refs=[root,aim],mounted=[],unmounted=[],observers=[];let exposed,rafRequests=0;
  const component=vm.runInNewContext(code,{
    c:value=>value,x:value=>({value:value===null&&refs.length?refs.shift():value}),D:fn=>mounted.push(fn),E:fn=>unmounted.push(fn),
    HTMLElement:Element,It:12,Bl:4,aM:curves.scale,aN:curves.alpha,__aimSubscribeBotOrder:subscribeBotOrder,
    ResizeObserver:class{constructor(fn){this.callback=fn;this.disconnected=false;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}},
    requestAnimationFrame(){rafRequests++;return 1;},cancelAnimationFrame(){}
  });
  component.setup({view},{expose:api=>{exposed=api;}});
  const badges=Array.from({length:3},()=>new Element());badges.forEach(exposed.register);
  return {view,root,aim,badges,exposed,observers,mount:()=>mounted.forEach(fn=>fn()),unmount:()=>unmounted.forEach(fn=>fn()),get rafRequests(){return rafRequests;}};
}

test('pinned patch compiles without changing the input, planner throttles or other modules',()=>{
  assert.equal(sources['other.js'],'unchanged');assert.equal(patched['other.js'],'unchanged');assert.notEqual(patched,sources);
  for(const name of ['CymPR-fm.js','DVK7uRSu.js','tmIeW3Ig.js']){
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:patched[name],encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.notEqual(patched[name],sources[name]);
  }
  const source=sources['CymPR-fm.js'],start=source.indexOf('const sg=.1,ag=.5;'),write=source.indexOf('write(g,_){',start),end=source.indexOf('const rc=180,',write);
  const aimStart=source.indexOf('function v(g,_,O,k){',start),aimEnd=source.indexOf('function A(g,_){',aimStart);
  assert(patched['CymPR-fm.js'].includes(source.slice(start,aimStart)),'route planning and raycasts must stay byte-for-byte unchanged');
  assert(patched['CymPR-fm.js'].includes(source.slice(aimEnd,write)),'plan publication and head-line generation must stay unchanged');
  const planningStart=source.indexOf('function M(g,_){',start),planningEnd=source.indexOf('function v(g,_,O,k){',planningStart);
  assert(patched['CymPR-fm.js'].includes(source.slice(planningStart,planningEnd)),'route planning must stay byte-for-byte unchanged');
  assert(end>write);
  assert.throws(()=>applyBotOrderPatch({}),/missing/);assert.throws(()=>applyBotOrderPatch(patched),/already applied/);
  assert.throws(()=>applyBotOrderPatch({...sources,'DVK7uRSu.js':sources['DVK7uRSu.js'].replace("function cT(){cS(cC['view']['current']),cK=requestAnimationFrame(cT);}",'function changedTick(){}')}),/expected 1 anchor/);
  assert.throws(()=>applyBotOrderPatch({...sources,'CymPR-fm.js':source.replace('const lo=In&&Ho.headLines','const changedLo=In&&Ho.headLines')}),/expected 1 anchor/);
  assert.throws(()=>applyBotOrderPatch({...sources,'CymPR-fm.js':source.replace('cn.apply(oe,Ht,le,vd(oe)),Ht=[];','')}),/same-frame/);
});

test('only the order badge loses its fade and is hidden until a valid label exists',()=>{
  const css=applyBotOrderCss(nativeCss),before=nativeCss.indexOf('.al-bot-order-badge[data-v-10bab01d]{'),after=nativeCss.indexOf('.al-bot-order-badge.is-next[data-v-10bab01d]{',before);
  assert(css.includes('opacity:0;visibility:hidden;transition:none;--aim-offline-bot-order-synchronous:1;'));
  assert(css.includes('.al-bot-order-badge.is-shown[data-v-10bab01d]{opacity:.55;visibility:visible}'));
  assert.equal(css.slice(0,before),nativeCss.slice(0,before));
  assert.equal(css.slice(css.indexOf('.al-bot-order-badge.is-next[data-v-10bab01d]{')),nativeCss.slice(after));
  assert.throws(()=>applyBotOrderCss(css),/already applied/);assert.throws(()=>applyBotOrderCss(nativeCss.replace('transition:opacity .15s ease;transform-origin:50% 100%','transition:none;transform-origin:50% 100%')),/expected 1 anchor/);
});

test('publishing before mount is safe; subscriptions paint current snapshots and release their private channel',()=>{
  const view={current:empty()},seen=[];publishBotOrder(view);
  const first=subscribeBotOrder(view,value=>seen.push(['first',value]));assert.equal(seen.length,1);
  const second=subscribeBotOrder(view,value=>seen.push(['second',value]));assert.deepEqual(Object.keys(view),['current']);
  const snapshot={...empty(),ready:true};view.current=snapshot;publishBotOrder(view);
  assert.equal(seen.at(-1)[1],snapshot);assert.equal(seen.at(-2)[1],snapshot);
  first();first();publishBotOrder(view);assert.equal(seen.at(-1)[0],'second');second();
  assert.equal(Object.getOwnPropertySymbols(view).length,0);const count=seen.length;publishBotOrder(view);assert.equal(seen.length,count);
});

test('actual native paint preserves coordinates and instantly hides deaths, result state and missing labels',()=>{
  const view={current:{ready:true,labels:[{x:.25,y:.5,order:2,distance:30}],next:2,aim:{shown:true,x:.4,y:.2,deltaM:.3}}};
  const native=hud(sources['DVK7uRSu.js'],view),live=hud(patched['DVK7uRSu.js'],view);native.exposed.tick();live.mount();
  assert.equal(live.badges[0].style.transform,native.badges[0].style.transform);assert.equal(live.aim.style.transform,native.aim.style.transform);
  assert.equal(live.badges[0].textContent,'2');assert(live.badges[0].classes.has('is-next'));assert.equal(live.badges[0].style.visibility,'visible');
  for(const state of [{...empty(),ready:true},empty()]){
    view.current=state;publishBotOrder(view);
    for(const node of live.badges){assert.equal(node.style.visibility,'hidden');assert.equal(node.style.transform,'');assert(!node.classes.has('is-shown'));assert(!node.classes.has('is-next'));}
    assert.equal(live.aim.style.opacity,'0');
  }
  view.current={ready:true,labels:[{x:-.5,y:-.25,order:3,distance:12}],next:0,aim:{shown:false}};publishBotOrder(view);
  assert.equal(live.badges[0].style.visibility,'visible');assert.equal(live.badges[0].style.transform,'translate3d(-480.0px, 135.0px, 0) scale(1.000)');
  assert.equal(live.badges[0].textContent,'3');assert(!live.badges[0].classes.has('is-next'));live.unmount();
});

test('native mount/resize/unmount uses no RAF and leaves no subscriber after remount',()=>{
  const h=hud();publishBotOrder(h.view);h.mount();assert.equal(h.rafRequests,0);assert.equal(h.observers.length,1);assert.equal(h.observers[0].node,h.root);
  h.root.clientWidth=1280;h.root.clientHeight=720;h.observers[0].callback();
  h.view.current={ready:true,labels:[{x:1,y:1,order:1,distance:12}],next:1,aim:{shown:false}};publishBotOrder(h.view);
  assert.equal(h.badges[0].style.transform,'translate3d(640.0px, -360.0px, 0) scale(1.000)');
  h.unmount();assert(h.observers[0].disconnected);assert.equal(Object.getOwnPropertySymbols(h.view).length,0);
  const writes=h.badges.reduce((sum,node)=>sum+node.writes,0);h.view.current=empty();publishBotOrder(h.view);
  assert.equal(h.badges.reduce((sum,node)=>sum+node.writes,0),writes,'unmounted nodes cannot receive later frames');
  const remount=hud(patched['DVK7uRSu.js'],h.view);remount.mount();assert.equal(remount.rafRequests,0);remount.unmount();assert.equal(Object.getOwnPropertySymbols(h.view).length,0);
});

test('actual publisher paints after the same camera projection and before world render, including paused/off/result paths',()=>{
  const h=hud(),source=patched['CymPR-fm.js'],start=source.indexOf('t.botOrder&&(In&&t.phase.current!=="result"?'),end=source.indexOf(';const lo=',start);
  assert(start>=0&&end>start);const block=source.slice(start,end),events=[],camera={frame:0,updateMatrixWorld(){events.push(['camera',this.frame]);}};
  const order={write(view,{camera}){events.push(['projection',camera.frame]);Object.assign(view,{ready:true,labels:[{x:camera.frame/10,y:0,order:1,distance:12}],next:1,aim:{shown:false}});}};
  const t={phase:{current:'running'},botOrder:h.view},parts={numbers:true,aimLine:true};
  const publish=view=>{publishBotOrder(view);events.push(['paint',camera.frame,h.badges[0].style.transform]);};
  const render=new Function('t','In','i','oe','Te','Ho','sc','__aimPublishBotOrder','events','const cn={actorPosition:()=>null};'+block+';events.push(["world",i.camera.frame]);');
  h.mount();
  for(const phase of ['running','paused']){
    t.phase.current=phase;camera.frame++;render(t,order,{camera},{},0,parts,view=>Object.assign(view,empty()),publish,events);
    assert.equal(h.badges[0].style.transform,`translate3d(${(camera.frame*96).toFixed(1)}px, 0.0px, 0) scale(1.000)`);
    assert.deepEqual(events.slice(-4).map(event=>event[0]),['camera','projection','paint','world']);
    assert(events.slice(-4).every(event=>event[1]===camera.frame));
  }
  parts.numbers=false;render(t,order,{camera},{},0,parts,view=>Object.assign(view,empty()),publish,events);assert.equal(h.badges[0].style.visibility,'hidden');
  parts.numbers=true;t.phase.current='result';render(t,order,{camera},{},0,parts,view=>Object.assign(view,empty()),publish,events);assert.equal(h.view.current.ready,false);assert.equal(h.badges[0].style.visibility,'hidden');
  t.phase.current='running';render(t,null,{camera},{},0,parts,view=>Object.assign(view,empty()),publish,events);assert.equal(h.view.current.ready,false);h.unmount();
});

function renderedActorFixture(){
  const modules=applyBotOrderPatch(applyInterpolationPatch(sources)),source=modules['tmIeW3Ig.js'],start=source.indexOf('function ks(A,g,D,w){'),end=source.indexOf('const DB=16,',start);
  assert(start>=0&&end>start);
  const vector=()=>({x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}});
  const api=vm.runInNewContext('(function(){'+source.slice(start,end)+';return ks;})()',{
    Xo:class{},mA:class{},KB:class{},In:10,Cg:.3,tn:2.5,Z:1/128,fn:1,
    uI:actor=>({x:actor.position.x+actor.offset.x,y:actor.position.y+actor.offset.y,z:actor.position.z+actor.offset.z}),
    Qn:()=>({root:{position:vector(),rotation:{},visible:true},pivot:{scale:{setScalar(){}}},parts:[]}),
    xQ:(a,b,alpha)=>({x:a.x+(b.x-a.x)*alpha,y:a.y+(b.y-a.y)*alpha,z:a.z+(b.z-a.z)*alpha}),
    oB:()=>0,yA:player=>player.position,_t:player=>({yaw:player.yaw,pitch:player.pitch})
  })({root:{add(){},remove(){}}},{position:vector(),rotation:{set(){}}},0,{targetsInvincible:true});
  const player={position:{x:0,y:0,z:0},yaw:0,pitch:0,grounded:false};
  const actor={id:'moving',spawnerId:'spawn',templateId:'human',position:{x:2,y:4,z:6},offset:{x:1,y:2,z:3},alive:true,visible:true,bornTick:0};
  const previous={tick:0,actors:[actor],player};api.capture(previous);api.apply(previous,[],.25);
  const current={...previous,tick:1,actors:[{...actor,position:{x:6,y:8,z:10}}]};api.capture(current);api.apply(current,[],.25);
  assert.deepEqual(JSON.parse(JSON.stringify(api.actorPosition('moving'))),{x:4,y:7,z:10});
  assert.equal(api.actorPosition('missing'),null);
  return {api,snapshot:current,source:modules['CymPR-fm.js']};
}

test('moving labels and aim use the actual same-frame interpolated root without applying actor offset twice',()=>{
  const {api,snapshot,source}=renderedActorFixture(),start=source.indexOf('function ig(e,t,n){'),end=source.indexOf('const rc=180,',start),projected=[],raycast=[];
  assert(start>=0&&end>start);
  const planner={job:()=>({run:()=>({done:true,plan:{steps:[{spawnerId:'spawn',order:1}]}})})},cache={planner,headLines:{},lineJob:null};
  const head=actor=>({x:actor.position.x+actor.offset.x,y:actor.position.y+actor.offset.y+2,z:actor.position.z+actor.offset.z});
  const make=vm.runInNewContext('(function(){'+source.slice(start,end)+';return ig;})()',{
    og:()=>cache,d0:()=>({}),f0:()=>0,performance:{now:()=>0},sg:.1,ag:.5,Yy:.15,
    es:head,qt:()=>0,__aimOffsetBotOrderHead:offsetBotOrderHead,
    jo:(camera,point)=>{projected.push({...point});return{x:point.x,y:point.y};},Jy:(eye,direction,point)=>point.y,
    Ma:(eye,actor)=>({points:[head(actor)]}),Qo:(collision,eye,point)=>{raycast.push({...point});return true;}
  });
  const order=make({meta:{seed:0},actors:[{id:'human'}]},{},null);order.advance(3);
  const camera={matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}},view=empty(),before=JSON.stringify(snapshot);
  order.write(view,{camera,snapshot,seconds:1,actorPosition:api.actorPosition});
  assert.equal(view.labels[0].x,4);assert.equal(view.labels[0].y,9.15);assert.equal(view.aim.x,4);assert.equal(view.aim.y,9);
  assert.deepEqual(projected,[{x:4,y:9.15,z:10},{x:4,y:9,z:10}]);
  assert.deepEqual(raycast,[{x:7,y:12,z:13}],'planner/raycast retains the simulation head');
  assert.equal(JSON.stringify(snapshot),before,'display projection cannot mutate simulation data');
  projected.length=0;api.clear();order.write(view,{camera,snapshot,seconds:1.01,actorPosition:api.actorPosition});
  assert.deepEqual(projected,[{x:7,y:12.15,z:13},{x:7,y:12,z:13}],'missing actor root uses the original tick head');
  assert.equal(view.labels[0].order,1);assert.equal(view.next,1);
});
