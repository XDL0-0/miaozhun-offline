// Query-only CPU timings around the application's own WebGL calls. This probe
// never asks WebGL for additional state, waits, queries, or resource contents.
// Self-contained so the temporary training fixture can serialize the function.
export function beginTrainingGlStalls(gl,options={}) {
 const {enabled=false,now=()=>performance.now(),phase=()=>null}=options;
 const thresholdMs=Number.isFinite(options.thresholdMs)?Math.max(0,options.thresholdMs):1;
 const maxRecords=Number.isFinite(options.maxRecords)?Math.max(0,Math.min(4096,Math.floor(options.maxRecords))):64;
 const supported=gl!==null&&(typeof gl==='object'||typeof gl==='function');
 const empty=reason=>({enabled:false,supported,reason,methods:{},slowCalls:[],droppedRecords:0,instrumentationMs:0,hookCount:0,hookFailures:[]});
 if(!enabled||!supported){const result=empty(!enabled?'disabled':'no-context');return {finish:()=>result};}
 const setupAt=now(),states=beginTrainingGlStalls.states??=new WeakMap();
 let state=states.get(gl);
 if(!state){state={active:null,originals:Object.create(null),wrappers:Object.create(null)};states.set(gl,state);}
 if(state.active){const result=empty('already-active');return {finish:()=>result};}
 const frame={now,phase,thresholdMs,maxRecords,methods:Object.create(null),slowCalls:[],droppedRecords:0,instrumentationMs:0,hookCount:0,hookFailures:[],hooks:[],finished:false,result:null};
 state.active=frame;
 const names=beginTrainingGlStalls.names??=[
  'drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements',
  'createShader','shaderSource','compileShader','createProgram','attachShader','linkProgram','useProgram',
  'getProgramParameter','getShaderParameter','getProgramInfoLog','getShaderInfoLog','getActiveUniform','getActiveAttrib','getUniformLocation','getAttribLocation',
  'createTexture','bindTexture','activeTexture','texImage2D','texSubImage2D','texImage3D','texSubImage3D','compressedTexImage2D','compressedTexSubImage2D','compressedTexImage3D','compressedTexSubImage3D','texStorage2D','texStorage3D','generateMipmap','pixelStorei','texParameteri','texParameterf',
  'bindBuffer','bufferData','bufferSubData','copyBufferSubData','bindVertexArray','vertexAttribPointer','vertexAttribIPointer',
  'bindFramebuffer','bindRenderbuffer','framebufferTexture2D','framebufferTextureLayer','framebufferRenderbuffer','renderbufferStorage','renderbufferStorageMultisample','checkFramebufferStatus','blitFramebuffer',
  'enable','disable','isEnabled','viewport','scissor','clear','clearBufferfv','clearBufferiv','clearBufferuiv','clearBufferfi','colorMask','depthMask','depthFunc','cullFace','frontFace','blendFunc','blendFuncSeparate','blendEquation','blendEquationSeparate',
  'uniform1f','uniform1i','uniform2f','uniform3f','uniform4f','uniform1fv','uniform2fv','uniform3fv','uniform4fv','uniform1iv','uniformMatrix3fv','uniformMatrix4fv',
  'getParameter','getError','getQuery','getQueryParameter','beginQuery','endQuery','getSyncParameter','clientWaitSync','fenceSync','flush','finish','readPixels','getBufferSubData'
 ];
 for(const name of names){
  let original,descriptor;
  try{original=gl[name];if(typeof original!=='function')continue;descriptor=Object.getOwnPropertyDescriptor(gl,name);}catch{frame.hookFailures.push(name);continue;}
  let wrapper=state.wrappers[name];
  if(!wrapper){
   wrapper=function(){
    const active=state.active,method=state.originals[name];
    if(!active)return Reflect.apply(method,this,arguments);
    const overheadAt=active.now();let label=null;
    try{label=active.phase();}catch{}
    const at=active.now();let error=null,threw=false;
    try{return Reflect.apply(method,this,arguments);}catch(caught){error=caught;threw=true;throw caught;}
    finally{
     const endedAt=active.now(),durationMs=Math.max(0,endedAt-at);
     let counter=active.methods[name];if(!counter)counter=active.methods[name]={calls:0,totalMs:0,maxMs:0,errors:0};
     counter.calls++;counter.totalMs+=durationMs;counter.maxMs=Math.max(counter.maxMs,durationMs);if(threw)counter.errors++;
     if(durationMs>=active.thresholdMs){
      if(active.slowCalls.length<active.maxRecords){
       const args=[];for(let index=0;index<arguments.length;index++){const value=arguments[index],type=typeof value;args.push(value===null||type==='number'||type==='boolean'||type==='string'?value:'['+type+']');}
       const record={method:name,at,durationMs,phase:label,arguments:args};
       if(threw){try{record.error=String(error?.message??error);}catch{record.error='WebGL call threw';}}
       active.slowCalls.push(record);
      }else active.droppedRecords++;
     }
     active.instrumentationMs+=Math.max(0,at-overheadAt)+Math.max(0,active.now()-endedAt);
    }
   };
   state.wrappers[name]=wrapper;
  }
  try{
   // Preserve own descriptors exactly; inherited native methods become temporary
   // own properties and are deleted again on finish. Never touch a prototype.
   const replacement=descriptor&&'value'in descriptor?{...descriptor,value:wrapper}:{value:wrapper,writable:true,configurable:true,enumerable:false};
   Object.defineProperty(gl,name,replacement);
   state.originals[name]=original;frame.hooks.push({name,descriptor,wrapper});frame.hookCount++;
  }catch{frame.hookFailures.push(name);}
 }
 frame.instrumentationMs+=Math.max(0,now()-setupAt);
 return {finish(){
  if(frame.finished)return frame.result;
  const endedAt=now();frame.finished=true;
  for(const {name,descriptor,wrapper}of frame.hooks){
   try{if(gl[name]===wrapper){if(descriptor)Object.defineProperty(gl,name,descriptor);else delete gl[name];}}catch{frame.hookFailures.push(name);}
  }
  if(state.active===frame)state.active=null;
  frame.result={enabled:true,supported,methods:{...frame.methods},slowCalls:frame.slowCalls,droppedRecords:frame.droppedRecords,instrumentationMs:0,hookCount:frame.hookCount,hookFailures:frame.hookFailures};
  frame.result.instrumentationMs=frame.instrumentationMs+Math.max(0,now()-endedAt);
  // Drop closures and saved descriptors from this frame; cached wrappers and
  // original methods remain per-context, without retaining its slow records.
  frame.hooks.length=0;
  return frame.result;
 }};
}
