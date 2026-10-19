import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {applyHudPatch,createHudFrameQueue,createRenderOptionsGate} from '../patches/hud.mjs';

const original=fs.readFileSync(new URL('../site/js/CymPR-fm.js',import.meta.url),'utf8');
const patched=applyHudPatch({'CymPR-fm.js':original})['CymPR-fm.js'];
const clone=value=>JSON.parse(JSON.stringify(value));
function displayClock(){
  const callbacks=new Map();let next=1,requests=0;
  return {request(fn){requests++;const id=next++;callbacks.set(id,fn);return id},cancel(id){callbacks.delete(id)},
    frame(time){const current=[...callbacks];callbacks.clear();for(const[,fn]of current)fn(time)},
    get pending(){return callbacks.size},get requests(){return requests}};
}
function component(source,name,props,returns,extra={}){
  const start=source.indexOf(`__name:"${name}"`),setup=source.indexOf('setup(e,{expose:t}){',start);
  assert(start>=0&&setup>=0,name);
  const body=setup+'setup(e,{expose:t}){'.length,end=source.indexOf('return ft(()=>',body);
  assert(end>body,name+' lifecycle');
  const ref=value=>({value}),context={X:ref,At:ref,ge:get=>({get value(){return get()}}),Map,Math,Object,
    JSON,he:1/128,Nw:.25,Mc:1.2,jw:.18,Yw:30,yi:'priming',Zc:'primed',Qc:'cooldown',wi:'idle',
    Go:{primingTicks:128,primedTicks:384,warnFromEndTicks:128,maxCharges:2},z0:{maxCharges:2},
    el:{windupSeconds:13,finalWindupSeconds:3},Ac:4,wx:.7,wu:1.9846,xm:1.4772,Am:[],Sm:x=>x,
    Tm:blend=>blend>.45?Math.min(1,(blend-.45)/.55):0,km:(fov,distance)=>2*1.9846/distance/(2*Math.tan(fov*Math.PI/360)),
    ...extra};
  return vm.runInNewContext(`(function(e){${source.slice(body,end)};return ${returns}})`,context)(props);
}

test('strict patch compiles, leaves inputs/other files intact and preserves cap anchors',()=>{
  const inputs={'CymPR-fm.js':original,'other.js':'unchanged'},result=applyHudPatch(inputs);
  assert.notEqual(result,inputs);assert.equal(inputs['CymPR-fm.js'],original);assert.equal(result['other.js'],'unchanged');
  assert.equal(patched.split('maxFps:me?t.maxFps?.current??0:0').length-1,2);
  const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:patched,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  assert.throws(()=>applyHudPatch({'CymPR-fm.js':patched}),/already applied/);
  assert.throws(()=>applyHudPatch({}),/missing/);
  assert.throws(()=>applyHudPatch({'CymPR-fm.js':original.replace('function yd(E){','function ydChanged(E){')}),/anchor/);
  assert.throws(()=>applyHudPatch({'CymPR-fm.js':original+';'+original}),/anchor/);
});

test('nine HUD components share one native RAF while reentrant work waits for next display frame',()=>{
  const clock=displayClock(),queue=createHudFrameQueue(clock.request.bind(clock),clock.cancel.bind(clock));
  const runs=Array(9).fill(0),tokens=[];
  for(let i=0;i<9;i++){const callback=()=>{runs[i]++;tokens[i]=queue.request(callback)};tokens[i]=queue.request(callback)}
  assert.equal(clock.pending,1);assert.equal(clock.requests,1);
  for(let i=0;i<144;i++){clock.frame(i*1000/144);assert.equal(clock.pending,1)}
  assert.deepEqual(runs,Array(9).fill(144));
  for(const token of tokens)queue.cancel(token);
  assert.equal(clock.pending,0);
});

test('shared RAF preserves cancellation inside a frame and isolates callback errors',()=>{
  const clock=displayClock(),errors=[],queue=createHudFrameQueue(clock.request.bind(clock),clock.cancel.bind(clock),e=>errors.push(e.message));
  const ran=[];let second;
  queue.request(()=>{ran.push('first');queue.cancel(second);throw Error('intentional')});
  second=queue.request(()=>ran.push('cancelled'));queue.request(()=>ran.push('last'));
  clock.frame(1);assert.deepEqual(ran,['first','last']);assert.deepEqual(errors,['intentional']);assert.equal(clock.pending,0);
});

test('crosshair, ADS and scope still tick every display frame and stop on unmount',()=>{
  const clock=displayClock(),queue=createHudFrameQueue(clock.request.bind(clock),clock.cancel.bind(clock));
  const view={current:{crosshair:'primary',blend:0,sniperScope:false,viewModelFovDeg:90,sightDistanceCm:48}};
  const extra={__aimOfflineHudFrames:queue};
  const cross=component(patched,'StageCrosshair',{view},'{start:l,stop:()=>__aimOfflineHudFrames.cancel(s),read:()=>o.value}',extra);
  const ads=component(patched,'AdsSight',{view},'{start:c,stop:()=>__aimOfflineHudFrames.cancel(i),read:()=>l}',extra);
  const scope=component(patched,'ScopeOverlay',{view},'{start:u,stop:()=>__aimOfflineHudFrames.cancel(s),read:()=>i}',extra);
  cross.start();ads.start();scope.start();assert.equal(clock.pending,1);
  for(let frame=0;frame<12;frame++){
    const blend=frame/11;Object.assign(view.current,{blend,crosshair:frame%2?'ads':'primary',sniperScope:frame>=6});
    clock.frame(frame*1000/144);
    assert.equal(cross.read(),view.current.crosshair);
    assert.equal(ads.read(),view.current.sniperScope?0:blend>.45?Math.min(1,(blend-.45)/.55):0);
    assert.equal(scope.read(),view.current.sniperScope?blend:0);
  }
  cross.stop();ads.stop();scope.stop();assert.equal(clock.pending,0);
});

test('render options update initially and only when a raw setting changes, including standard-mode cap',()=>{
  const changed=createRenderOptionsGate();let commits=0;
  for(let frame=0;frame<10000;frame++)if(changed(1,144,false))commits++;
  assert.equal(commits,1);
  assert.equal(changed(1,120,false),true);assert.equal(changed(2,120,false),true);assert.equal(changed(2,120,true),true);
  assert.equal(changed(2,120,true),false);
  assert(patched.includes('__aimHudRenderOptionsChanged(t.renderEveryNthFrame.current,t.maxFps?.current??0,t.showPerformance.current)&&$s.setOptions('));
});

test('ammo output matches original across reload buckets, weapon changes and unlimited ammunition',()=>{
  const props={view:{current:{inMag:25,magSize:25,reserve:75,reloading:false,reloadProgress:0,knife:false,weapon:'vandal'}}};
  const output='{tick:c,read:()=>[a.value,s.value,i.value,l.value]}';
  const before=component(original,'AmmoReadout',props,output),after=component(patched,'AmmoReadout',props,output);
  const sequence=[{}, {inMag:6},{inMag:0,reloading:true},...Array.from({length:501},(_,i)=>({reloadProgress:i/500})),
    {inMag:25,reserve:50,reloading:false,reloadProgress:0},{knife:true},{knife:false,weapon:'melee'},
    {weapon:'vandal',inMag:null,reserve:999},{inMag:5,magSize:5,reserve:10}];
  for(const values of sequence){Object.assign(props.view.current,values);before.tick();after.tick();assert.deepEqual(clone(after.read()),clone(before.read()))}
});

test('vitals output matches original while status order, armor, damage and detain animation change',()=>{
  const props={view:{current:{armorRegen:false,armor:50,armorMax:50,threat:true,maxHealth:100,health:100,lastHitAt:-1,now:0,hits:0,lastHitFromYaw:0}},lockdown:{current:{state:null,now:0}}};
  const output='{tick:w,read:()=>[a.value,s.value,i.value,l.value,u.value,r.value,c.value,p.value,d.value,h.value]}';
  const before=component(original,'VitalsReadout',props,output),after=component(patched,'VitalsReadout',props,output);
  for(let frame=0;frame<1800;frame++){
    const time=frame/144,M=props.view.current,L=props.lockdown.current;M.now=L.now=time;
    M.armorRegen=frame>=100&&frame<700;M.armor=M.armorRegen?Math.min(50,(frame-100)/10):50;
    M.health=frame<300?100:25;M.hits=frame<300?0:1;M.lastHitAt=frame<300?-1:300/144;M.lastHitFromYaw=.75;
    L.state=frame>=250&&frame<1000?{detained:true,detain:{from:128,until:896}}:null;
    before.tick();after.tick();assert.deepEqual(clone(after.read()),clone(before.read()),'frame '+frame);
  }
});

test('idle vitals skip status allocation after first frame',()=>{
  let allocations=0;class CountedMap extends Map{constructor(...args){super(...args);allocations++}}
  const props={view:{current:{armorRegen:false,armor:50,armorMax:50,threat:false,maxHealth:100,lastHitAt:-1,now:0,hits:0}},lockdown:{current:null}};
  const hud=component(patched,'VitalsReadout',props,'{tick:w}',{Map:CountedMap});
  for(let frame=0;frame<10000;frame++){props.view.current.now=frame/144;hud.tick()}
  assert.equal(allocations,1);
});

test('Jett HUD matches original and avoids serialization when visible fields remain unchanged',()=>{
  let serialized=0;const countedJSON={stringify(value){serialized++;return JSON.stringify(value)}};
  const props={view:{current:null}},output='{tick:r,read:()=>o.value}';
  const before=component(original,'JettAbilityHud',props,output),after=component(patched,'JettAbilityHud',props,output,{JSON:countedJSON});
  for(let i=0;i<1000;i++)after.tick();assert.equal(serialized,1);
  const value={rules:{unlimited:false,tailwind:true,cloudburst:true},tailwind:{phase:'idle',elapsedTicks:0,charges:1,kills:0},cloudburst:{phase:'idle',charges:2}};
  props.view.current=value;
  for(let frame=0;frame<1000;frame++){
    value.tailwind.phase=frame<200?'idle':frame<400?'priming':frame<800?'primed':'cooldown';
    value.tailwind.elapsedTicks=frame;value.tailwind.charges=frame<800?1:0;value.tailwind.kills=frame>=900?1:0;
    value.cloudburst.charges=frame<300?2:1;value.cloudburst.phase=frame>=300&&frame<350?'casting':'idle';
    value.rules.unlimited=frame>=950;
    before.tick();after.tick();assert.deepEqual(clone(after.read()),clone(before.read()),'frame '+frame);
  }
  assert(serialized<700,'idle elapsedTicks should not cause object serialization');
});

test('Lockdown HUD keeps timer/flash output identical and skips inactive serialization',()=>{
  let serialized=0;const props={view:{current:{state:null,now:0}}},output='{tick:u,read:()=>o.value}';
  const before=component(original,'LockdownHud',props,output),after=component(patched,'LockdownHud',props,output,{JSON:{stringify(value){serialized++;return JSON.stringify(value)}}});
  for(let i=0;i<1000;i++)after.tick();assert.equal(serialized,1);
  for(let frame=0;frame<1800;frame++){
    const time=frame/100;props.view.current.now=time;
    props.view.current.state=frame<50?{devices:[],detain:null}:{devices:[{detonateTick:13*128,destroyedTick:frame>=1500?15*128:null}],detain:frame>=1300?{from:13*128,until:21*128}:null};
    before.tick();after.tick();assert.deepEqual(clone(after.read()),clone(before.read()),'frame '+frame);
  }
});
