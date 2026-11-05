// Query-only browser attribution. No tracing, storage, network, or GC forcing.
export function observeTrainingLongFrames({Observer=globalThis.PerformanceObserver,maxRecords=256,maxScriptsPerFrame=32}={}) {
 const bound=(value,fallback,cap)=>Number.isFinite(value)?Math.max(0,Math.min(cap,Math.floor(value))):fallback;
 maxRecords=bound(maxRecords,256,4096);maxScriptsPerFrame=bound(maxScriptsPerFrame,32,64);
 const records=[],supported=[],unsupported=[],failures=[],observers=[];let dropped=0,droppedScripts=0,stopped=false;
 const text=value=>typeof value==='string'?value.slice(0,512):null;
 const accept=entries=>{
  if(stopped)return;
  for(const entry of entries){
   if(records.length>=maxRecords){dropped++;continue;}
   const record={type:entry.entryType,at:entry.startTime,durationMs:entry.duration};
   if(entry.entryType==='long-animation-frame'){
    for(const key of ['blockingDuration','renderStart','styleAndLayoutStart','firstUIEventTimestamp'])if(Number.isFinite(entry[key]))record[key]=entry[key];
    const scripts=entry.scripts??[];record.scripts=[];
    for(const script of scripts){
     if(record.scripts.length>=maxScriptsPerFrame){droppedScripts++;continue;}
     record.scripts.push({at:script.startTime,durationMs:script.duration,executionStart:script.executionStart,forcedStyleAndLayoutDuration:script.forcedStyleAndLayoutDuration,pauseDuration:script.pauseDuration,invokerType:text(script.invokerType),invoker:text(script.invoker),sourceFunctionName:text(script.sourceFunctionName),sourceURL:text(script.sourceURL),sourceCharPosition:script.sourceCharPosition});
    }
   }
   records.push(record);
  }
 };
 for(const type of ['longtask','long-animation-frame']){
  if(typeof Observer!=='function'||!Observer.supportedEntryTypes?.includes(type)){unsupported.push(type);continue;}
  let observer;
  try{observer=new Observer(list=>accept(list.getEntries()));observer.observe({type,buffered:false});observers.push({type,observer});supported.push(type);}
  catch{failures.push({type,operation:'observe'});try{observer?.disconnect();}catch{}}
 }
 const drain=()=>{if(!stopped)for(const {type,observer}of observers)try{accept(observer.takeRecords?.()??[]);}catch{if(!failures.some(item=>item.type===type&&item.operation==='takeRecords'))failures.push({type,operation:'takeRecords'});}};
 return {
  snapshot(start=0,end=Infinity){drain();return {supported:[...supported],unsupported:[...unsupported],failures:[...failures],maxRecords,maxScriptsPerFrame,dropped,droppedScripts,records:records.filter(record=>record.at<end&&record.at+record.durationMs>start)};},
  dispose(){if(stopped)return;drain();stopped=true;for(const {type,observer}of observers)try{observer.disconnect();}catch{failures.push({type,operation:'disconnect'});}}
 };
}
