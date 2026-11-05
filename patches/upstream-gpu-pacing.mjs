// Optional A/B candidate for the retained 2026-11-05 client, not a default
// optimization. A zero timeout requests no GPU wait. Both Chromium entry
// points use WebGLSync::UpdateCache, so this alone does not establish a speedup:
// https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.14
// https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webgl/webgl2_rendering_context_base.cc
//
// Pin the whole native policy, not only the query: default 2 / maximum 3 frames,
// FIFO retirement after 250ms, explicit submission flush, context-loss handling,
// and disposal must stay intact. Applying or reverting changes only the query.
const worldName='CqM6URxy.js';
const marker='__aimUpstreamFencePollStatus';
const nativePolicy='const sb=3,H0=2,LP="al-exp-gpu-backpressure";function B5(t){let e=null;try{e=t?.getItem(LP)??null}catch{}if(e===null||e.trim()==="")return H0;const n=Number(e);return!Number.isFinite(n)||n<0?H0:Math.min(sb,Math.floor(n))}const FP=250;function UP(t,e=()=>performance.now()){let n=0,i=0,r=0;const s=[],a=()=>{if(!t.isContextLost())for(const o of s)t.deleteSync(o.sync);s.length=0};return{setMaxInFlight(o){n=Math.min(sb,Math.max(0,Math.floor(o)||0)),n===0&&a()},ready(){if(n===0)return!0;if(t.isContextLost())return s.length=0,!0;for(;s.length>0;){const o=s[0];if(!(t.getSyncParameter(o.sync,t.SYNC_STATUS)===t.SIGNALED)){if(e()-o.at<FP)break;r++}t.deleteSync(o.sync),s.shift()}return s.length<n?!0:(i++,!1)},stats:()=>({maxInFlight:n,inFlight:s.length,blocked:i,stale:r}),submitted(){if(n===0||t.isContextLost())return;const o=t.fenceSync(t.SYNC_GPU_COMMANDS_COMPLETE,0);o&&s.push({sync:o,at:e()}),t.flush()},dispose:a}}';
const nativePoll='if(!(t.getSyncParameter(o.sync,t.SYNC_STATUS)===t.SIGNALED))';
// Only the two success statuses are completion. TIMEOUT_EXPIRED and WAIT_FAILED
// follow the same native pending/stale path as UNSIGNALED and a null query result.
// A failed query therefore cannot free a slot before the native 250ms deadline.
const candidatePolicy=nativePolicy.replace(nativePoll,
  `const ${marker}=t.clientWaitSync(o.sync,0,0);if(${marker}!==t.ALREADY_SIGNALED&&${marker}!==t.CONDITION_SATISFIED)`);

function changePolicy(sources,before,after){
  const source=sources[worldName];
  if(typeof source!=='string')throw Error('Upstream GPU pacing patch missing world source');
  if(source.split('function UP(').length!==2||source.split(before).length!==2)
    throw Error('Upstream GPU pacing patch version mismatch: native pacing policy');
  return {...sources,[worldName]:source.replace(before,after)};
}

export function applyUpstreamGpuPacingPatch(sources){
  if(typeof sources[worldName]==='string'&&sources[worldName].includes(marker))throw Error('Upstream GPU pacing patch already applied');
  return changePolicy(sources,nativePolicy,candidatePolicy);
}

export function revertUpstreamGpuPacingPatch(sources){
  return changePolicy(sources,candidatePolicy,nativePolicy);
}
