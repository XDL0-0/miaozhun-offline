// Texture-backed skin effects only. The coverage mask always contains the source
// sprite silhouette, including when another opacity layer/dissolve is enabled.
// This prevents an opaque default/lookup texture from filling an entire card.
export const skinMaskShader=`
uniform sampler2D map,opacityMap,lut;
uniform vec4 eUV,oUV,eMotion,oMotion;
uniform vec3 tint;
uniform float alphaChannel,opacityChannel,alphaMult,emissiveMult;
uniform float useOpacity,useLut,texColor,lutMin,lutMax,lutVariant,nLuts;
uniform float gameTime,polarE,polarO,dissolveChannel,dissolveSoft;
varying vec2 vUv;
varying vec4 vCol,vDyn;
vec2 transformUV(vec2 uv,vec4 scaleOffset,vec4 motion,float polar){
 vec2 p=uv-.5;
 if(polar>.5)p=vec2(atan(p.y,p.x)/6.2831853,length(p)*2.0)-vec2(0.0,.5);
 float a=(motion.x+motion.y*gameTime)*6.2831853,c=cos(a),s=sin(a);
 return (mat2(c,s,-s,c)*p+.5)*scaleOffset.xy+scaleOffset.zw+motion.zw*gameTime;
}
float channel(vec4 t,float alpha){return alpha>.5?t.a:t.r;}
void main(){
 vec2 uv=transformUV(vUv,eUV,eMotion,polarE);
 vec4 source=texture2D(map,uv);
 float mask=channel(source,alphaChannel);
 // UV transforms on clamped source cards must not smear edge pixels outward.
 if(polarE<.5&&(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0))mask=0.0;
 float op=mask;
 if(useOpacity>.5){
  vec2 q=transformUV(vUv,oUV,oMotion,polarO);
  op*=channel(texture2D(opacityMap,q),opacityChannel);
 }
 if(dissolveChannel>=0.0){
  float d=dissolveChannel<.5?vDyn.x:dissolveChannel<1.5?vDyn.y:dissolveChannel<2.5?vDyn.z:vDyn.w;
  op*=smoothstep(clamp(d,0.0,1.0),clamp(d,0.0,1.0)+max(dissolveSoft,.001),mask);
 }
 float a=clamp(op*alphaMult*vCol.a,0.0,1.0);
 if(a<.001)discard;
 vec3 color=texColor>.5?source.rgb:vec3(source.r);
 if(useLut>.5)color=texture2D(lut,vec2(clamp(mix(lutMin,lutMax,source.r),0.0,1.0),(lutVariant+.5)/max(nLuts,1.0))).rgb;
 gl_FragColor=vec4(max(color*tint*vCol.rgb*emissiveMult,vec3(0.0))*a,a);
}`;
