// Query-only browser attribution. No tracing, storage, network, or GC forcing.
export function observeTrainingLongFrames({Observer=globalThis.PerformanceObserver,maxRecords=256}={}) {
 const records=[],supported=[],observers=[];let dropped=0,stopped=false;
 const accept=entries=>{
  for(const entry of entries){
   if(records.length>=maxRecords){dropped++;continue;}
   const record={type:entry.entryType,at:entry.startTime,durationMs:entry.duration};
   if(entry.entryType==='long-animation-frame'){
    for(const key of ['blockingDuration','renderStart','styleAndLayoutStart','firstUIEventTimestamp'])if(Number.isFinite(entry[key]))record[key]=entry[key];
    record.scripts=Array.from(entry.scripts??[],script=>({at:script.startTime,durationMs:script.duration,executionStart:script.executionStart,forcedStyleAndLayoutDuration:script.forcedStyleAndLayoutDuration,pauseDuration:script.pauseDuration,invokerType:script.invokerType,invoker:script.invoker,sourceFunctionName:script.sourceFunctionName,sourceURL:script.sourceURL,sourceCharPosition:script.sourceCharPosition}));
   }
   records.push(record);
  }
 };
 if(typeof Observer==='function')for(const type of ['longtask','long-animation-frame']){
  if(!Observer.supportedEntryTypes?.includes(type))continue;
  try{const observer=new Observer(list=>accept(list.getEntries()));observer.observe({type,buffered:false});observers.push(observer);supported.push(type);}catch{}
 }
 const drain=()=>{if(!stopped)for(const observer of observers)accept(observer.takeRecords?.()??[]);};
 return {
  snapshot(start=0,end=Infinity){drain();return {supported:[...supported],dropped,records:records.filter(record=>record.at<end&&record.at+record.durationMs>start)};},
  dispose(){if(stopped)return;drain();stopped=true;for(const observer of observers)observer.disconnect();}
 };
}
