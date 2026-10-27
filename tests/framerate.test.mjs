import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyFrameratePatch} from '../patches/framerate.mjs';

const root = new URL('../site/js/', import.meta.url);
const source = Object.fromEntries(['CymPR-fm.js', 'DCKWp-_u.js'].map(name => [name, fs.readFileSync(new URL(name, root), 'utf8')]));
const patched = applyFrameratePatch(source);

test('browser and desktop cap reach both original loop option paths', () => {
  assert.equal(patched['CymPR-fm.js'].split('maxFps:t.maxFps?.current??0').length - 1, 2);
  assert.ok(patched['CymPR-fm.js'].includes('renderEveryNthFrame:me?1:t.renderEveryNthFrame.current'));
  assert.ok(!patched['CymPR-fm.js'].includes('maxFps:me?t.maxFps?.current??0:0'));
  assert.equal(source['CymPR-fm.js'].split('maxFps:me?t.maxFps?.current??0:0').length - 1, 2);
});

test('real settings gates enable browser cap while keeping fractional refresh and desktop policy', () => {
  const expression = patched['DCKWp-_u.js'].match(/Ye=O\(\(\)=>([^)]+)\),Je=/)?.[1];
  assert.ok(expression);
  assert.equal(expression, source['DCKWp-_u.js'].match(/Ye=O\(\(\)=>([^)]+)\),Je=/)[1]);
  const condition = patched['DCKWp-_u.js'].match(/(\(Ye\.value\|\|Ee===null\))\?\(h\(\),Z\(re,\{key:6,class:"hall-max-fps-choice"/)?.[1];
  assert.ok(condition);
  const settingsState = (Ee, mode) => {
    const value = vm.runInNewContext(expression, {Ee, t:{value:{frameMode:mode}}});
    return {desktopUnlimited:value, capVisible:vm.runInNewContext(condition, {Ee,Ye:{value}})};
  };
  assert.deepEqual(settingsState(null,'refresh'), {desktopUnlimited:false,capVisible:true});
  assert.deepEqual(settingsState(null,'unlimited'), {desktopUnlimited:false,capVisible:true});
  assert.deepEqual(settingsState({},'refresh'), {desktopUnlimited:false,capVisible:false});
  assert.deepEqual(settingsState({},'unlimited'), {desktopUnlimited:true,capVisible:true});
  assert.equal(patched['DCKWp-_u.js'].split('帧率上限（本机）').length - 1, 2);
});

function simulate({maxFps=0, nth=1, duration=10, rafHz=240, jitter=0, callbackDelay=()=>0, tickCpuMs=0, changeAt, changeTo, text=patched['CymPR-fm.js']}) {
  const start = text.indexOf('function mm('), end = text.indexOf('const ja=', start);
  assert.ok(start > 0 && end > start);
  const loopText = text.slice(start, end);
  let now = 0, frameTime = 0, callback, nextId = 0, ticks = 0, accumulator = 0;
  const frames = [];
  const scheduler = {now:()=>now, requestFrame:fn=>(callback=fn, ++nextId), cancelFrame:()=>{callback=null;}};
  const noStats = () => ({record(){}, report(){return null;}, reset(){}, frame(){}, summary(){return {};}, recent(){return [];}});
  const context = vm.createContext({
    lm:scheduler, dm:1, fm:8, pm:.98,
    em:noStats, rm:noStats,
    _d:()=>({advance(seconds){accumulator+=seconds;const count=Math.floor((accumulator+1e-10)*128);accumulator-=count/128;return count;},alpha:()=>accumulator*128,reset:()=>{accumulator=0;}}),
  });
  const makeLoop = vm.runInContext(`${loopText};mm`, context);
  const loop = makeLoop({onTick(){ticks++;now+=tickCpuMs;},onRender(alpha){assert.ok(alpha>=-1e-7&&alpha<=1+1e-7);frames.push(frameTime);}}, {maxFps,renderEveryNthFrame:nth,showPerformance:false}, scheduler);
  loop.start();
  for (let frame=0; frame<=duration*rafHz; frame++) {
    frameTime=1000+frame*1000/rafHz+(frame%2?jitter:-jitter);
    now=frameTime+callbackDelay(frame);
    if(changeAt!==undefined&&frame===changeAt)loop.setOptions(changeTo);
    const fn=callback;callback=null;assert.equal(typeof fn,'function');fn(frameTime);
  }
  loop.stop();
  return {frames,ticks};
}

test('small RAF timing jitter no longer causes a whole missed refresh at 120 FPS', () => {
  const options={maxFps:120,jitter:.08};
  const baseline=simulate({...options,text:source['CymPR-fm.js']}).frames;
  const optimized=simulate(options).frames;
  const worstDeviation=frames=>Math.max(...frames.slice(1).map((time,index)=>Math.abs(time-frames[index]-1000/120)));
  assert.ok(worstDeviation(baseline)>4);
  assert.ok(worstDeviation(optimized)<.161);
});

test('240 FPS cap keeps on-time display frames despite callback queueing and intermittent simulation CPU', () => {
  const options={maxFps:240,callbackDelay:frame=>frame%2?0:1,tickCpuMs:.8};
  // Isolate the clock bug from the previously fixed sub-millisecond tolerance.
  const previousClock=source['CymPR-fm.js'].replace('if(O>=m)return!0;const k=', 'if(O>=m||!n.deferFrame&&m-O<.25)return!0;const k=');
  const baseline=simulate({...options,text:previousClock});
  const optimized=simulate(options);
  assert.ok(baseline.frames.length<2300, `${baseline.frames.length} baseline frames`);
  assert.equal(optimized.frames.length,2401);
  assert.equal(optimized.ticks,1280);
  for(let i=1;i<optimized.frames.length;i++)assert.ok(Math.abs(optimized.frames[i]-optimized.frames[i-1]-1000/240)<1e-7);
  for(const cap of [60,120,240,0]) {
    const loaded=simulate({...options,maxFps:cap});
    const idle=simulate({maxFps:cap});
    assert.deepEqual(loaded.frames,idle.frames, `cap ${cap} must use the display clock`);
    assert.equal(loaded.ticks,1280);
  }
});

test('refresh estimate text describes browser load instead of a monitor FPS ceiling', () => {
  const settings=patched['DCKWp-_u.js'];
  assert.ok(!settings.includes('最高与显示器刷新率相同'));
  assert.ok(!settings.includes('帧率等于显示器刷新率'));
  const start=settings.indexOf('X=O(()=>{const _='),end=settings.indexOf(',me=O(',start);
  assert.ok(start>0&&end>start);
  const hint=vm.runInNewContext(settings.slice(start,end)+';X.value', {
    O:get=>({get value(){return get();}}),a:{fpsFor:()=>125},t:{value:{renderEveryNthFrame:1}},
  });
  assert.match(hint,/当前实测值会随负载变化，并非显示器上限/);
  assert.match(hint,/125/);
});

for (const cap of [60,120,144,165,240,0]) {
  test(`actual frame loop honors cap ${cap} while keeping 128 Hz simulation`, () => {
    const {frames,ticks}=simulate({maxFps:cap});
    assert.equal(ticks,1280);
    const ceiling=cap||240;
    assert.ok(frames.length<=ceiling*10+2, `${frames.length} rendered frames`);
    assert.ok(frames.length>=Math.min(ceiling,240)*10*.70);
    // A RAF cap is quantized to display refreshes. Non-divisor caps (144/165
    // on 240 Hz) necessarily alternate between adjacent refresh multiples.
    if(cap>0)for(let i=1;i<frames.length;i++)assert.ok(frames[i]-frames[i-1]>=Math.floor(240/cap)*1000/240-1e-7);
    if(cap===60||cap===120)for(let i=1;i<frames.length;i++)assert.ok(Math.abs(frames[i]-frames[i-1]-1000/cap)<1e-7, `uneven interval at frame ${i}`);
  });
}

test('fractional refresh and runtime cap changes preserve simulation rate', () => {
  const half=simulate({maxFps:0,nth:2});
  assert.equal(half.ticks,1280);
  assert.ok(Math.abs(half.frames.length-1200)<=1);
  const changing=simulate({maxFps:60,changeAt:1200,changeTo:{maxFps:120}});
  assert.equal(changing.ticks,1280);
  const before=changing.frames.filter(t=>t<6000).length;
  const after=changing.frames.filter(t=>t>=6000).length;
  assert.ok(after>before*1.5);
  const mixed=simulate({maxFps:144,nth:2});
  assert.equal(mixed.ticks,1280);
  assert.ok(Math.abs(mixed.frames.length-1200)<=1);
  const uncapped=simulate({maxFps:60,changeAt:1200,changeTo:{maxFps:0}});
  assert.equal(uncapped.ticks,1280);
  assert.ok(uncapped.frames.filter(t=>t>=6000).length>uncapped.frames.filter(t=>t<6000).length*3);
});

test('version mismatch and repeated patch fail instead of partial output', () => {
  assert.throws(()=>applyFrameratePatch({...source,'CymPR-fm.js':'changed upstream'}),/版本不匹配/);
  assert.throws(()=>applyFrameratePatch(patched),/版本不匹配/);
});
