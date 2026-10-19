export function weaponMaterialTextures(m){
  return [...new Set([m.map,m.normalMap,m.ormMap,m.emissiveMap,...Object.values(m.shader??{}).flatMap(s=>[s.map,s.mask,s.gradient,s.noise])].filter(Boolean))];
}

// These effects shade the existing gun triangles. No camera cards, bloom pass,
// refraction render target or displaced geometry can cover the player's view.
export function createWeaponBodyMaterial(m,{Material,Physical=Material,tex,environment,clock}){
  const orm=tex(m.ormMap,false),mat=new Physical({map:tex(m.map,true),normalMap:tex(m.normalMap,false),roughnessMap:orm,metalnessMap:orm,
    aoMap:m.surfacePacked?orm:null,aoMapIntensity:1,specularIntensityMap:m.surfacePacked?orm:null,specularIntensity:m.specular??1,
    roughness:orm?1:m.roughness,metalness:m.metalness,envMap:environment,envMapIntensity:m.envIntensity??.6,
    clearcoat:m.clearcoat??0,clearcoatRoughness:m.clearcoatRoughness??.16,
    iridescence:m.iridescence??0,
    transparent:!!m.transparent,opacity:m.opacity,alphaTest:m.alphaTest??0,depthTest:true,depthWrite:!m.transparent,
    emissiveMap:tex(m.emissiveMap,false),emissiveIntensity:m.emissiveIntensity});
  mat.name=m.name;mat.color.setRGB(...m.color.map(v=>v*(m.brightness??1)));mat.emissive.setRGB(...m.emissive);mat.normalScale?.set(1,-1);mat.visible=!m.hidden;
  if(m.doubleSided)mat.side=2;
  if(m.additive)mat.blending=2;
  const uniforms={aimSurfaceTime:clock.time,aimHeat:clock.heat};
  const declarations=['uniform float aimSurfaceTime,aimHeat;varying vec2 vAimUv,vAimUv2;'],maps=[],color=[],emission=[];
  const sampler=(name,url,color=false)=>{uniforms[name]={value:tex(url,color)};declarations.push('uniform sampler2D '+name+';');};
  const vector=(name,value,type='vec3')=>{uniforms[name]={value};declarations.push('uniform '+type+' '+name+';');};
  const f=m.shader??{};
  mat.userData.aimSurface={features:Object.keys(f),clock};
  if(f.tint){sampler('aimTintMask',f.tint.map);vector('aimTintColor',f.tint.color);color.push('diffuseColor.rgb*=mix(vec3(1.0),aimTintColor,texture2D(aimTintMask,vAimUv).r);');}
  if(f.plastic){sampler('aimPlastic',f.plastic.map);color.push('diffuseColor.a*=texture2D(aimPlastic,vAimUv).b;');}
  if(m.useDiffuseEmissive)emission.push('totalEmissiveRadiance*=diffuseColor.rgb;');
  if(f.flow){
    sampler('aimFlow',f.flow.map);sampler('aimGradient',f.flow.gradient,true);vector('aimFlowMotion',[f.flow.tiling,...f.flow.pan,f.flow.intensity],'vec4');
    emission.push(`{vec2 p=${f.flow.uv2?'vAimUv2':'vAimUv'}*aimFlowMotion.x+aimSurfaceTime*aimFlowMotion.yz;float n=texture2D(aimFlow,p).r;vec3 c=texture2D(aimGradient,vec2(n,.5)).rgb;totalEmissiveRadiance+=clamp(c,0.0,2.0)*n*aimFlowMotion.w;}`);
  }
  if(f.scroll){
    sampler('aimScroll',f.scroll.map);vector('aimScrollColor',f.scroll.color);vector('aimScrollMotion',[f.scroll.tiling,f.scroll.speed,f.scroll.intensity]);
    emission.push(`{vec2 p=${f.scroll.uv2?'vAimUv2':'vAimUv'}*aimScrollMotion.x+vec2(0.0,aimSurfaceTime*aimScrollMotion.y);float n=texture2D(aimScroll,p).r;totalEmissiveRadiance+=aimScrollColor*n*aimScrollMotion.z;}`);
  }
  if(f.line){sampler('aimLineMask',f.line.map);vector('aimLineColor',f.line.color);vector('aimLineMotion',[f.line.speed,f.line.intensity,f.line.min]);color.push('diffuseColor.a*=texture2D(aimLineMask,vAimUv).b;');emission.push('totalEmissiveRadiance+=aimLineColor*aimLineMotion.y*mix(aimLineMotion.z,1.0,.5+.5*sin(aimSurfaceTime*aimLineMotion.x*6.2831853));');}
  if(f.rim){
    sampler('aimRimMask',f.rim.map);sampler('aimRimNoise',f.rim.noise);vector('aimRimColor',f.rim.color);vector('aimRimMotion',[...f.rim.tiling,...f.rim.pan],'vec4');vector('aimRimPower',[f.rim.power,f.rim.intensity],'vec2');
    emission.push('{float edge=pow(1.0-clamp(dot(normalize(normal),normalize(vViewPosition)),0.0,1.0),aimRimPower.x);float mask=texture2D(aimRimMask,vAimUv).r;float n=texture2D(aimRimNoise,vAimUv*aimRimMotion.xy+aimSurfaceTime*aimRimMotion.zw).r;totalEmissiveRadiance+=aimRimColor*edge*mask*n*aimRimPower.y;}');
  }
  if(f.heat){sampler('aimLava',f.heat.map,true);sampler('aimLavaMask',f.heat.mask);vector('aimLavaGain',[f.heat.intensity,0,0]);emission.push('totalEmissiveRadiance+=texture2D(aimLava,vAimUv).rgb*texture2D(aimLavaMask,vAimUv).r*aimHeat*aimLavaGain.x;');}
  mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='attribute vec2 aimUv2;varying vec2 vAimUv,vAimUv2;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvAimUv=uv;vAimUv2=aimUv2;');
    shader.fragmentShader=declarations.join('\n')+'\n'+shader.fragmentShader
      .replace('#include <map_fragment>','#include <map_fragment>\n'+color.join('\n'))
      .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n'+emission.join('\n')+'\ntotalEmissiveRadiance=clamp(totalEmissiveRadiance,vec3(0.0),vec3(3.0));');
  };
  mat.customProgramCacheKey=()=>JSON.stringify({features:Object.keys(f),uv2:[f.flow?.uv2,f.scroll?.uv2],diffuse:m.useDiffuseEmissive});
  return mat;
}
