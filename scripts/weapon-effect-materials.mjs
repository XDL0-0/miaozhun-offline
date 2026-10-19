// Cooked material instances only contain overrides. Restore their parent defaults
// before choosing a sprite, mask or lookup table; PM_Diffuse is an exporter hint,
// not a reliable particle shape.
export const materialPath=ref=>(ref?.ObjectPath??ref?.AssetPathName??'').replace(/\.[^/.]+$/,'');
export function resolveEffectMaterial(logical,readRaw,readExport,seen=new Set()){
  if(seen.has(logical))throw new Error('Cyclic material parent: '+logical);
  seen.add(logical);
  const raw=readRaw(logical),p=raw?.Properties??{},parent=materialPath(p.Parent);
  const inherited=parent?resolveEffectMaterial(parent,readRaw,readExport,seen):{};
  const data={...inherited,parents:[...(inherited.parents??[]),...(parent?[parent]:[])]};
  for(const name of ['Textures','Scalars','Colors','Switches'])data[name]={...inherited[name]};
  const c=raw?.CachedExpressionData;
  for(const [entry,values,name] of [['RuntimeEntries','ScalarValues','Scalars'],['RuntimeEntries[1]','VectorValues','Colors'],['RuntimeEntries[3]','TextureValues','Textures'],['RuntimeEntries[7]','StaticSwitchValues','Switches']]){
    for(const [i,info]of(c?.[entry]?.ParameterInfoSet??[]).entries())if(c[values]?.[i]!==undefined)data[name][info.Name]=c[values][i];
  }
  if(c?.DynamicParameterNames)data.dynamic=c.DynamicParameterNames;
  const exported=readExport(logical)??{};
  for(const name of ['Textures','Scalars','Colors','Switches'])Object.assign(data[name],exported[name]);
  for(const [name,values] of [['Textures',p.TextureParameterValues],['Scalars',p.ScalarParameterValues],['Colors',p.VectorParameterValues],['Switches',p.StaticParametersRuntime?.StaticSwitchParameters]]){
    for(const v of values??[])if(v.bOverride!==false)data[name][v.ParameterInfo.Name]=v.ParameterValue??v.Value;
  }
  data.BlendMode=exported.BlendMode??inherited.BlendMode;
  return data;
}

// Deliberately excludes lookup, noise, distortion and exporter fallback slots.
// An unsupported shader is omitted instead of inventing a glowing card.
export function effectShapeTexture(t,exists){
  return ['Emissive_Base','Emissive Color','MainTex','BaseTexture','TextureA','Tex','Texture','Flipbook','FlipbookTex','FB','Alpha','PM_Emissive']
    .map(k=>t[k]).find(r=>r&&!/DefaultDiffuse|00_Debug|LUT|ColorGradient|Noise|Distort|WhiteColorSwatch/.test(materialPath(r))&&exists(r))??null;
}
