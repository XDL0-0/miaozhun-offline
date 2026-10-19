// Original skin animation tracks, retargeted at import time to the delivered
// Phoenix hands and each skin's own skeleton. Sampling uses the simulation clock.
export function decodeWeaponMotion(meta,buffer){
  if(!meta||!Array.isArray(meta.names)||meta.names.length<1||meta.names.length>256||new Set(meta.names).size!==meta.names.length||!Number.isInteger(meta.frames)||meta.frames<1||meta.frames>4000||!(meta.duration>0&&meta.duration<60)||!((meta.sampleRate>0||meta.frames===1&&meta.sampleRate===0)&&meta.sampleRate<=241)||!Array.isArray(meta.rest)||meta.rest.length!==meta.names.length)throw new Error('Invalid weapon animation');
  if(buffer.byteLength!==meta.frames*meta.names.length*40)throw new Error('Truncated weapon animation');
  const values=new Float32Array(buffer);
  for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i])||Math.abs(values[i])>100000)throw new Error('Invalid weapon animation sample');
  for(let i=0;i<values.length;i+=10){const length=Math.hypot(values[i+3],values[i+4],values[i+5],values[i+6]);if(length<.98||length>1.02)throw new Error('Invalid animation quaternion');}
  return {...meta,values};
}

export function animationState(actions,state,weapon){
  const now=state.seconds;if(!Number.isFinite(now))return null;
  if(state.reloadSince!=null&&state.reloadSince>=0&&actions.reload){
    const duration=actions.reload.arms.duration,real=state.reloadDuration>0?state.reloadDuration:duration;
    return {action:'reload',time:Math.min(duration,state.reloadSince*duration/real),weight:Math.min(1,state.reloadSince/.06)};
  }
  const shots=state.shots??[],shot=shots.at(-1)??-Infinity;
  const events=(state.melee??[]).filter(e=>!e.weapon||e.weapon===weapon);
  const inspect=events.findLast(e=>e.inspect===true),attack=events.findLast(e=>e.inspect!==true);
  if(inspect&&actions.inspect&&shot<inspect.at&&(weapon!=='melee'||(attack?.at??-Infinity)<inspect.at)&&(state.equipAt??-Infinity)<inspect.at&&(state.adsBlend??0)<.01){
    const elapsed=now-inspect.at,duration=actions.inspect.arms.duration;
    if(elapsed>=0&&elapsed<duration)return {action:'inspect',time:elapsed,weight:Math.min(1,elapsed/.12,(duration-elapsed)/.16)};
  }
  if(weapon==='melee'){
    if(attack&&(state.equipAt??-Infinity)<=attack.at){
      const attacks=Object.keys(actions).filter(name=>/^attack[1-9]$/.test(name)).sort(),combo=Math.floor(attack.combo??0);
      const name=attack.heavy&&actions.heavy?'heavy':attacks.length?attacks[((combo%attacks.length)+attacks.length)%attacks.length]:'fire';
      const track=actions[name]?.arms??actions[name]?.gun,duration=track?.duration,elapsed=now-attack.at;
      if(elapsed>=0&&elapsed<duration)return {action:name,time:elapsed,weight:Math.min(1,elapsed/.035,(duration-elapsed)/.1)};
    }
    if(actions.equip&&Number.isFinite(state.equipAt)){
      const elapsed=now-state.equipAt,duration=(actions.equip.arms??actions.equip.gun).duration;
      if(elapsed>=0&&elapsed<duration&&(attack?.at??-Infinity)<state.equipAt)return {action:'equip',time:elapsed,weight:Math.min(1,elapsed/.04,(duration-elapsed)/.1)};
    }
    if(actions.idle){const duration=(actions.idle.arms??actions.idle.gun).duration;return {action:'idle',time:((now%duration)+duration)%duration,weight:1};}
    return null;
  }
  if(actions.fire){const elapsed=now-shot,duration=actions.fire.arms.duration;if(elapsed>=0&&elapsed<duration)return {action:'fire',time:elapsed,weight:1};}
  return null;
}

export function createWeaponMotionPlayer({motions,armsRig,armsScales,gunBones,baseRig,Quaternion,weapon}){
  const clips=motions?.clips??{},actions=motions?.actions??{},q=new Quaternion();
  const armMap=armsRig?.index??new Map(),gunMap=new Map(gunBones.map((b,i)=>[b.name,i]));
  const bindings=new Map();
  const restingScales=armsScales??armsRig?.bones.map(b=>[b.scale.x,b.scale.y,b.scale.z]);
  function resetArms(){armsRig?.bones.forEach((bone,i)=>bone.scale.set(...restingScales[i]));}
  for(const [id,clip]of Object.entries(clips)){
    const arms=clip.names.includes('MasterWeapon'),map=arms?armMap:gunMap,bones=arms?armsRig.bones:gunBones;
    bindings.set(id,clip.names.map((name,i)=>({bone:bones[map.get(name)],index:i,extra:!baseRig.index.has(name)})).filter(b=>b.bone));
  }
  function sample(track,time,weight,extrasOnly=false){
    if(!track)return;
    let segment=track.segments.find(s=>time>=s.start&&time<s.start+(s.to-s.from)/Math.abs(s.rate)*s.loops);
    if(!segment)segment=track.segments.at(-1);
    if(!segment)return;
    const clip=clips[segment.clip],span=(segment.to-segment.from),local=Math.max(0,time-segment.start)*Math.abs(segment.rate);
    // A gun loop can be shorter than the matching hand loop in the source
    // montage; its own final segment repeats while the hands finish inspecting.
    const t=segment.from+(local<span*segment.loops?local%span:(track.segments.length>1?local%span:span));
    const frame=Math.min(clip.frames-1,Math.max(0,t*clip.sampleRate)),a=Math.floor(frame),b=Math.min(a+1,clip.frames-1),u=frame-a,stride=clip.names.length*10,v=clip.values;
    for(const binding of bindings.get(segment.clip)){
      if(extrasOnly&&!binding.extra)continue;
      const bone=binding.bone,offset=binding.index*10,ia=a*stride+offset,ib=b*stride+offset;
      bone.position.x+=(v[ia]+(v[ib]-v[ia])*u-bone.position.x)*weight;
      bone.position.y+=(v[ia+1]+(v[ib+1]-v[ia+1])*u-bone.position.y)*weight;
      bone.position.z+=(v[ia+2]+(v[ib+2]-v[ia+2])*u-bone.position.z)*weight;
      let dot=0;for(let k=3;k<7;k++)dot+=v[ia+k]*v[ib+k];const sign=dot<0?-1:1;
      q.set(v[ia+3]+(sign*v[ib+3]-v[ia+3])*u,v[ia+4]+(sign*v[ib+4]-v[ia+4])*u,v[ia+5]+(sign*v[ib+5]-v[ia+5])*u,v[ia+6]+(sign*v[ib+6]-v[ia+6])*u).normalize();
      bone.quaternion.slerp(q,weight);
      bone.scale.x+=(v[ia+7]+(v[ib+7]-v[ia+7])*u-bone.scale.x)*weight;
      bone.scale.y+=(v[ia+8]+(v[ib+8]-v[ia+8])*u-bone.scale.y)*weight;
      bone.scale.z+=(v[ia+9]+(v[ib+9]-v[ia+9])*u-bone.scale.z)*weight;
    }
  }
  let cancelledInspect=-Infinity;
  return {update(state,blocked=false){
    // Native clips only write translation/rotation. Restore scale as well when
    // a skin action ends, is interrupted, or hands return to a native action.
    resetArms();
    const inspect=(state.melee??[]).findLast(e=>e.inspect===true)?.at??-Infinity;
    if(blocked||state.reloadSince!=null&&state.reloadSince>=0||(state.adsBlend??0)>=.01)cancelledInspect=Math.max(cancelledInspect,inspect);
    if(blocked)return null;
    const active=animationState(actions,state,weapon);if(!active||active.action==='inspect'&&inspect<=cancelledInspect)return null;
    const action=actions[active.action];
    // Native ADS/fire layers already compose base fire additives correctly.
    // Only replace the hands for a skin that supplies a dedicated fire pose.
    if(active.action!=='fire'||!action.arms.source?.includes('_S0_')&&(state.adsBlend??0)<.01)sample(action.arms,active.time,active.weight);
    sample(action.gun,active.time,active.weight);sample(action.cosmetic,active.time,active.weight,true);
    return active;
  },dispose:resetArms};
}
