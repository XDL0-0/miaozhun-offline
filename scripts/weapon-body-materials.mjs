const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));
const rgb=(v,fallback=[0,0,0])=>v?[v.R,v.G,v.B].map(x=>clamp(x,0,8)):fallback;
export const surfacePackFilter=(width,height)=>`[0:v]format=gbrap,colorchannelmixer=rr=0:rg=0:rb=1:gr=0:gg=1:gb=0:br=1:bg=0:bb=0:aa=0:ab=1[m];[1:v]scale=${width}:${height}:flags=bilinear,format=gbrap[a];[m][a]lut2=c0=x:c1=x:c2=y:c3=x,format=rgba`;

// Convert the resolved source surface parameters, rather than assigning every
// AEM texture a white emission or guessing transparency from the material name.
export function weaponBodyMaterial(name,data,texture){
  const t=data.Textures??{},c=data.Colors??{},s=data.Scalars??{},sw=data.Switches??{},parents=data.parents??[];
  const family=parents.join(' '),crystal=/Crystal|Sprit_Emissive/.test(family),petal=/BloomPetal|Petal_Line/.test(family),yokai=/Yokai_Clearcoat/.test(family),decal=/Decal/.test(family+' '+name);
  const diffuse=decal?t['Decal Texture']??t.Albedo??t.PM_Diffuse:t.Albedo??t.PM_Diffuse;
  const plastic=!!t['MRS (Plastic Opacity, Roughness, Specular)'];
  const mask=t.AEM,packed=t['MRS (Plastic Opacity, Roughness, Specular)']??t.MRS??t.PM_SpecularMasks,led=/LED/.test(name),bareLight=/Demonstone_Emissive/.test(family);
  const sourceIntensity=(led?s['LED Emissive Base Intensity']:undefined)??s['Weapon Emissive Intensity']??s['Emissive Intensity']??s.Emissive_Intensity??(bareLight?s['Emissive Intensity Light']:0)??0;
  const emission=rgb(c['LED Emissive Color']??c['Emissive Color']??c.Emissive_Color??c.EmissiveColor);
  const transparent=[2,3].includes(data.BlendMode),opacity=clamp(s.Opacity??s['Base Opacity']??1,0,1);
  const m={name,map:diffuse?texture(diffuse):null,normalMap:t.Normal||t.PM_Normals?texture(t.Normal??t.PM_Normals,'normal'):null,
    ormMap:packed?texture(packed,'surface',mask):null,surfacePacked:!!packed,
    emissiveMap:!led&&mask&&sourceIntensity>0&&emission.some(x=>x>0)?texture(mask,'emissive'):null,
    emissive:emission,emissiveIntensity:clamp(sourceIntensity,0,3),useDiffuseEmissive:sw.UseDiffuseEmissive===true,
    color:rgb(c['Albedo Tint']??c['Base Color']??c['BG Bottom Color']??c.Color,diffuse?[1,1,1]:[.08,.08,.08]),
    brightness:clamp(s['Albedo Brightness Medium']??1,.1,2),roughness:packed?1:clamp(s.Roughness??.5,.04,1),metalness:plastic?0:packed?1:clamp(s.Metalness??s.Metal??0,0,1),
    specular:clamp(s['Adjust Light Specular Levels']??s.Specular??s.Spec??1,0,1),envIntensity:clamp(s['Probe Influence']??s['HDRI Strength']??s['HDRI Brightness']??.6,0,1.5),
    clearcoat:crystal||yokai||/Transparent/.test(name)?.8:0,clearcoatRoughness:clamp(s['Clearcoat Roughness']??.16,.06,1),
    iridescence:clamp(s['Iridesence Mask Intensity']??0,0,1),
    transparent,opacity,additive:data.BlendMode===3,alphaTest:data.BlendMode===1?clamp(s['Alpha threshold']??s.DissolveThreshold??.25,.01,.9):transparent?.005:0,
    doubleSided:petal||decal,hidden:/LightTrails|BakedLight/i.test(name)||transparent&&opacity===0,
    shader:{},source:{parents,emissiveIntensity:sourceIntensity,blendMode:data.BlendMode??0}};
  // Source colour selectors and decals are applied on existing mesh UVs only.
  if(decal&&t['Decal Color Mask']&&c['Color 01'])m.shader.tint={map:texture(t['Decal Color Mask'],'normal'),color:rgb(c['Color 01'])};
  if(plastic)m.shader.plastic={map:m.ormMap};
  if(crystal&&t['Crystal Inner']&&t['Emissive Gradient'])m.shader.flow={map:texture(t['Crystal Inner'],'normal'),gradient:texture(t['Emissive Gradient']),tiling:s['Texture Tiling']??1,pan:[s['Panner X']??0,s['Panner Y']??0],intensity:clamp((s['Smoke Emissive Intensity']??0)*.06,0,.6),uv2:true};
  if(petal&&sw.EnableEmissiveScroll&&t.EmissiveScrollTex)m.shader.scroll={map:texture(t.EmissiveScrollTex,'normal'),color:rgb(c.ScrollColor??c['Scroll Color']),speed:s.EmissiveScrollSpeed??.15,tiling:s['UV Unit']??1,intensity:clamp(s.ScrollIntensity??0,0,.6),uv2:sw['Use UV2']===true};
  if(/Petal_Line/.test(family)&&t.FlowerAEM)m.shader.line={map:texture(t.FlowerAEM,'normal'),color:rgb(c.LineColor),speed:s.BreathingSpeed??.3,intensity:clamp(s.ScrollIntensity??.5,0,.6),min:clamp(s.MinOpacity??.3,0,1)};
  if(yokai&&t['Fresnel Mask']&&t['Fresnel Noise'])m.shader.rim={map:texture(t['Fresnel Mask'],'normal'),noise:texture(t['Fresnel Noise'],'normal'),color:rgb(c['Fresnel Color']),power:Math.max(1,s.FresnelPower??2),tiling:[s['Fresnel Noise U Tiling']??1,s['Fresnel Noise V Tiling']??1],pan:[s['Fresnel Noise U Speed']??0,s['Fresnel Noise V Speed']??0],intensity:clamp((s['Fresnel Mask Intensity']??0)*.15,0,.6)};
  if(t['Lava DF']&&t['Lave AEM'])m.shader.heat={map:texture(t['Lava DF']),mask:texture(t['Lave AEM'],'emissive'),intensity:.6};
  if(!diffuse&&data.BlendMode===1&&!emission.some(v=>v>0)&&!Object.keys(m.shader).length)m.hidden=true;
  return m;
}
