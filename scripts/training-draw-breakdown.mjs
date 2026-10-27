// One-frame, query-only diagnostics. The caller selects a steady-state frame,
// calls finish() in finally, and excludes that frame from timing summaries.
// Keep this function self-contained: the fixture serializes it with toString().
export function beginTrainingDrawBreakdown(renderer,{mapBatches=[],actorTemplates,viewModel}={}) {
 const original=renderer?.renderBufferDirect,render=renderer?.info?.render;
 if(typeof original!=='function'||!render)return {finish:()=>null};
 const fields=['calls','triangles','points','lines'];
 const zero=()=>({calls:0,triangles:0,points:0,lines:0});
 const categories={map:zero(),targetBody:zero(),targetWeapon:zero(),viewModel:zero(),other:zero()};
 const mapObjects=new WeakSet(),bodyGeometries=new WeakSet(),weaponGeometries=new WeakSet(),viewObjects=new WeakSet();
 const visit=(root,callback)=>{
  if(!root)return;
  if(typeof root.traverse==='function'){root.traverse(callback);return;}
  callback(root);for(const child of root.children??[])visit(child,callback);
 };
 for(const root of mapBatches)visit(root,object=>mapObjects.add(object));
 for(const template of actorTemplates?.values?.()??[]){
  for(const part of template.parts??[])if(part.geometry)bodyGeometries.add(part.geometry);
  visit(template.root,object=>{if(object.geometry)weaponGeometries.add(object.geometry);});
 }
 const viewScene=viewModel?.fxLayer?.()?.scene??null;
 visit(viewScene,object=>viewObjects.add(object));
 // Scene identity also catches meshes added by a skin update after this hook
 // starts. Viewmodel membership takes precedence over shared actor geometry.
 const classify=(object,scene)=>{
  if(viewScene&&(scene===viewScene||object&&viewObjects.has(object)))return 'viewModel';
  if(object&&mapObjects.has(object))return 'map';
  const geometry=object?.geometry;
  if(geometry&&bodyGeometries.has(geometry))return 'targetBody';
  if(geometry&&weaponGeometries.has(geometry))return 'targetWeapon';
  return 'other';
 };
 let directCalls=0,nestedDirectCalls=0,counterDiscontinuities=0,active=null,finished=false,result=null;
 function observedDraw(...args){
  const parent=active,scope={children:zero()},before={calls:render.calls,triangles:render.triangles,points:render.points,lines:render.lines};
  active=scope;directCalls++;if(parent)nestedDirectCalls++;
  try{return original.apply(this,args)}finally{
   const category=categories[classify(args[4],args[1])];
   let discontinuity=false;
   for(const field of fields){
    const inclusive=render[field]-before[field],own=inclusive-scope.children[field];
    category[field]+=own;if(parent)parent.children[field]+=inclusive;
    if(inclusive<0||own<0)discontinuity=true;
   }
   if(discontinuity)counterDiscontinuities++;
   active=parent;
  }
 }
 renderer.renderBufferDirect=observedDraw;
 return {finish(expectedOverall){
  if(finished)return result;
  finished=true;
  if(renderer.renderBufferDirect===observedDraw)renderer.renderBufferDirect=original;
  const total=zero();for(const value of Object.values(categories))for(const field of fields)total[field]+=value[field];
  const residual=expectedOverall&&fields.every(field=>Number.isFinite(expectedOverall[field]))?Object.fromEntries(fields.map(field=>[field,expectedOverall[field]-total[field]])):null;
  result={categories,total,residual,directCalls,nestedDirectCalls,counterDiscontinuities,hookRestored:renderer.renderBufferDirect===original};
  return result;
 }};
}
