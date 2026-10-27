// Self-contained for toString() injection into the query-only native fixture.
// Phase values exclude the marker bookkeeping between its two clock reads.
export function beginTrainingRenderPhases() {
 const phases={};let name=null,startedAt=0,instrumentationMs=0,finished=false,result=null;
 return {
  start(at,initial='renderPreamble'){startedAt=at;name=initial;},
  mark(next){
   if(finished||name===null)return;
   const at=performance.now();phases[name]=(phases[name]??0)+Math.max(0,at-startedAt);name=next;
   const endedAt=performance.now();instrumentationMs+=Math.max(0,endedAt-at);startedAt=endedAt;
  },
  finish(at){
   if(finished)return result;finished=true;
   if(name!==null)phases[name]=(phases[name]??0)+Math.max(0,at-startedAt);
   result={phases,instrumentationMs};return result;
  }
 };
}
