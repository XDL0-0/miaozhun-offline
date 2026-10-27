// Optional A/B transform: merge small static map geometry in larger cells.
// Keep original geometry baking, material/atlas keys, instance grouping and PVS
// identities. Larger cells conservatively submit more hidden geometry, so this
// is not a default production optimization until measured on the real maps.
export function applyMapBatchDensityPatch(sources,{cellSize=96}={}) {
  if(!Number.isFinite(cellSize)||cellSize<=0)throw Error('Map batch density requires a positive finite cell size');
  const output={...sources},graphics=output['aQOfOAp-.js'];
  if(typeof graphics!=='string')throw Error('Map batch density missing graphics source');
  if(graphics.includes('__aimMapBatchCellSize'))throw Error('Map batch density already applied');
  const before='const VT=3,WT=6e3,Ll=48;';
  if(graphics.split(before).length!==2)throw Error('Map batch density version mismatch');
  output['aQOfOAp-.js']=graphics.replace(before,'const VT=3,WT=6e3,Ll='+cellSize+';/*__aimMapBatchCellSize__*/');
  return output;
}
