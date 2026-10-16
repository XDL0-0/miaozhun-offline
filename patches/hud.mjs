// Keep UI work on the display clock, independently of the unlimited renderer.
export function createHudFrameQueue(request, cancel, report = error => queueMicrotask(() => { throw error; })) {
  const pending = new Map();
  let frame = null, next = 1;
  function flush(time) {
    frame = null;
    const last = next - 1;
    for (const [id, callback] of pending) {
      if (id > last) break;
      pending.delete(id);
      try { callback(time); } catch (error) { report(error); }
    }
    if (pending.size && frame === null) frame = request(flush);
  }
  return {
    request(callback) {
      const id = next++;
      pending.set(id, callback);
      if (frame === null) frame = request(flush);
      return id;
    },
    cancel(id) {
      pending.delete(id);
      if (!pending.size && frame !== null) { cancel(frame); frame = null; }
    }
  };
}

export function createRenderOptionsGate() {
  let first = true, previousNth, previousCap, previousPerformance;
  return (nth, cap, performance) => {
    if (!first && nth === previousNth && cap === previousCap && performance === previousPerformance) return false;
    first = false; previousNth = nth; previousCap = cap; previousPerformance = performance;
    return true;
  };
}

export function createVitalsStatusGate() {
  let previousRegen, previousDetain;
  return (regen, armor, maximum, detained, from, until, now, tickSeconds = 1 / 128) => {
    const r = regen && maximum > 0 ? Math.round(Math.min(1, Math.max(0, armor / maximum)) * 200) / 200 : null;
    const start = from * tickSeconds, end = until * tickSeconds;
    const d = detained ? Math.round((end > start ? Math.min(1, Math.max(0, (end - now) / (end - start))) : 0) * 200) / 200 : null;
    if (Object.is(r, previousRegen) && Object.is(d, previousDetain)) return false;
    previousRegen = r; previousDetain = d;
    return true;
  };
}

export function createJettHudGate(priming, primed) {
  let previous;
  return view => {
    if (view === null) {
      if (previous === null) return false;
      previous = null; return true;
    }
    const r = view.rules, t = view.tailwind, c = view.cloudburst, p = previous;
    const elapsed = t.phase === priming || t.phase === primed ? t.elapsedTicks : 0;
    if (p && p.unlimited === r.unlimited && p.tailwind === r.tailwind && p.cloudburst === r.cloudburst &&
      p.phase === t.phase && p.elapsed === elapsed && p.charges === t.charges && p.kills === t.kills &&
      p.smokeCharges === c.charges && p.smokePhase === c.phase) return false;
    previous = { unlimited:r.unlimited, tailwind:r.tailwind, cloudburst:r.cloudburst,
      phase:t.phase, elapsed, charges:t.charges, kills:t.kills, smokeCharges:c.charges, smokePhase:c.phase };
    return true;
  };
}

function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`HUD patch ${label}: expected 1 anchor, found ${count}`);
  return source.replace(before, after);
}

function patchClock(source, name) {
  const anchor = `__name:"${name}"`;
  if (source.split(anchor).length !== 2) throw new Error(`HUD component ${name}: expected 1 component`);
  const start = source.indexOf(anchor), next = source.indexOf('__name:', start + anchor.length);
  const end = next < 0 ? source.length : next;
  const original = source.slice(start, end);
  if (original.split('requestAnimationFrame(').length !== 3 || original.split('cancelAnimationFrame(').length !== 2)
    throw new Error(`HUD component ${name}: unexpected RAF lifecycle`);
  const patched = original.replaceAll('requestAnimationFrame(', '__aimOfflineHudFrames.request(')
    .replaceAll('cancelAnimationFrame(', '__aimOfflineHudFrames.cancel(');
  return source.slice(0, start) + patched + source.slice(end);
}

export function applyHudPatch(sources) {
  let source = sources['CymPR-fm.js'];
  if (typeof source !== 'string') throw new Error('HUD patch: missing CymPR-fm.js');
  if (source.includes('__aimOfflineHudFrames')) throw new Error('HUD patch already applied');
  source = once(source, 'const lm={now:()=>performance.now()',
    `const __aimOfflineHudFrames=(${createHudFrameQueue.toString()})(callback=>requestAnimationFrame(callback),id=>cancelAnimationFrame(id));const lm={now:()=>performance.now()`, 'display scheduler');
  for (const name of ['StageCrosshair','AdsSight','ScopeOverlay','AmmoReadout','VitalsReadout','JettAbilityHud','LockdownHud','WeaponSlotsHud','Minimap'])
    source = patchClock(source, name);

  // Compare the raw settings; a later framerate patch can remove the maxFps gate.
  source = once(source, 'function yd(E){const Q=t.phase.current',
    `const __aimHudRenderOptionsChanged=(${createRenderOptionsGate.toString()})();function yd(E){const Q=t.phase.current`, 'render options cache');
  source = once(source, '$s.setOptions({renderEveryNthFrame:me?1:t.renderEveryNthFrame.current,maxFps:me?t.maxFps?.current??0:0,showPerformance:t.showPerformance.current})',
    '__aimHudRenderOptionsChanged(t.renderEveryNthFrame.current,t.maxFps?.current??0,t.showPerformance.current)&&$s.setOptions({renderEveryNthFrame:me?1:t.renderEveryNthFrame.current,maxFps:me?t.maxFps?.current??0:0,showPerformance:t.showPerformance.current})', 'render options call');

  const ammoBefore = 'function c(){const d=n.view.current,h=d.knife||d.weapon==="melee",y=`${d.inMag??"x"}/${d.magSize}/${d.reserve}/${d.reloading}/${d.reloadProgress.toFixed(2)}/${h}`;if(y===r)return;r=y,a.value=d.inMag===null?"∞":String(d.inMag),s.value=String(d.reserve),i.value=d.reloading?d.reloadProgress:0,l.value=d.inMag!==null&&d.magSize>0&&d.inMag<=Math.ceil(d.magSize*Nw);const f=o.value;f&&(f.classList.toggle("is-reloading",d.reloading),f.classList.toggle("is-gone",h))}';
  const ammoAfter = 'let __aimHudAmmoPrevious=null;function c(){const d=n.view.current,h=d.knife||d.weapon==="melee",p=__aimHudAmmoPrevious,same=p&&p.mag===d.inMag&&p.size===d.magSize&&p.reserve===d.reserve&&p.loading===d.reloading&&p.knife===h;if(same&&p.rawProgress===d.reloadProgress)return;const progress=d.reloadProgress.toFixed(2);if(same&&p.progress===progress){p.rawProgress=d.reloadProgress;return}__aimHudAmmoPrevious={mag:d.inMag,size:d.magSize,reserve:d.reserve,loading:d.reloading,knife:h,rawProgress:d.reloadProgress,progress};a.value=d.inMag===null?"∞":String(d.inMag),s.value=String(d.reserve),i.value=d.reloading?d.reloadProgress:0,l.value=d.inMag!==null&&d.magSize>0&&d.inMag<=Math.ceil(d.magSize*Nw);const f=o.value;if(f){if(f.classList.contains("is-reloading")!==d.reloading)f.classList.toggle("is-reloading",d.reloading);if(f.classList.contains("is-gone")!==h)f.classList.toggle("is-gone",h)}}';
  source = once(source, ammoBefore, ammoAfter, 'ammo fields');

  source = once(source, 'function x(M){const v=new Map;M.armorRegen',
    `const __aimHudStatusChanged=(${createVitalsStatusGate.toString()})();function x(M){const v=new Map;M.armorRegen`, 'vitals cache');
  const statusBefore = 'function w(){const M=n.view.current,v=x(M);y=y.filter(_=>v.has(_));for(const _ of v.keys())y.includes(_)||y.push(_);const A=y.map(_=>({key:_,label:o[_],fill:Math.round(v.get(_)*200)/200})),z=A.map(_=>`${_.key}:${_.fill}`).join("|");if(z!==f&&(f=z,c.value=A),a.value=M.threat&&M.maxHealth>0,a.value)';
  const statusAfter = 'function w(){const M=n.view.current,__ld=n.lockdown?.current,__detain=__ld?.state?.detain;if(__aimHudStatusChanged(M.armorRegen,M.armor,M.armorMax,!!(__ld?.state?.detained&&__detain),__detain?.from??0,__detain?.until??0,__ld?.now??0,he)){const v=x(M);y=y.filter(_=>v.has(_));for(const _ of v.keys())y.includes(_)||y.push(_);const A=y.map(_=>({key:_,label:o[_],fill:Math.round(v.get(_)*200)/200})),z=A.map(_=>`${_.key}:${_.fill}`).join("|");if(z!==f){f=z;c.value=A}}a.value=M.threat&&M.maxHealth>0;if(a.value)';
  source = once(source, statusBefore, statusAfter, 'vitals fields');
  source = once(source, 'function r(){const p=n.view?.current??null,d=p?u(p):null,h=JSON.stringify(d);h!==l&&(l=h,o.value=d)}',
    `const __aimHudJettChanged=(${createJettHudGate.toString()})(yi,Zc);function r(){const p=n.view?.current??null;if(!__aimHudJettChanged(p))return;const d=p?u(p):null,h=JSON.stringify(d);h!==l&&(l=h,o.value=d)}`, 'jett fields');
  source = once(source, 'function u(){const c=n.view?.current,p=c?l(c):null,d=JSON.stringify(p);d!==s&&(s=d,o.value=p)}',
    'function u(){const c=n.view?.current;if((!c?.state||(!c.state.devices.length&&c.state.detain===null))&&o.value===null&&s==="null")return;const p=c?l(c):null,d=JSON.stringify(p);d!==s&&(s=d,o.value=p)}', 'inactive lockdown');
  return {...sources, 'CymPR-fm.js':source};
}
