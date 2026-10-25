import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveEffectMaterial,effectShapeTexture} from '../scripts/weapon-effect-materials.mjs';

test('cooked instance overrides retain parent masks, UV defaults and disabled switches',()=>{
  const objects={
    '/Game/Base':{CachedExpressionData:{
      RuntimeEntries:{ParameterInfoSet:[{Name:'Emissive_Rotate'}]},ScalarValues:[.25],
      'RuntimeEntries[3]':{ParameterInfoSet:[{Name:'MainTex'}]},TextureValues:[{AssetPathName:'/Game/Flash.Flash'}],
      'RuntimeEntries[7]':{ParameterInfoSet:[{Name:'LUT'}]},StaticSwitchValues:[true],
      DynamicParameterNames:['Dissolve']
    }},
    '/Game/Instance':{Properties:{Parent:{ObjectPath:'/Game/Base.0'},ScalarParameterValues:[{ParameterInfo:{Name:'Emissive_Rotate'},ParameterValue:0}],StaticParametersRuntime:{StaticSwitchParameters:[{ParameterInfo:{Name:'LUT'},Value:false,bOverride:true}]}}}
  };
  const resolved=resolveEffectMaterial('/Game/Instance',p=>objects[p],()=>({Textures:{PM_Diffuse:{ObjectPath:'/Game/LUT.0'}}}));
  assert.equal(resolved.Scalars.Emissive_Rotate,0);assert.equal(resolved.Switches.LUT,false);
  assert.equal(resolved.Textures.MainTex.AssetPathName,'/Game/Flash.Flash');
  assert.deepEqual(resolved.dynamic,['Dissolve']);assert.deepEqual(resolved.parents,['/Game/Base']);
  assert.equal(effectShapeTexture(resolved.Textures,()=>true),resolved.Textures.MainTex);
});

test('lookup tables, packed noise and default textures never become a firing silhouette',()=>{
  const ref=name=>({ObjectPath:'/Game/'+name+'.0'});
  assert.equal(effectShapeTexture({PM_Diffuse:ref('LUT'),LUTs:ref('Gradient'),Texture:ref('Noise_TFX'),Emissive_Base:ref('DefaultDiffuse')},()=>true),null);
  assert.equal(effectShapeTexture({MainTex:ref('Missing')},()=>false),null);
});

test('shipped particles contain only source-backed shaders and preserve source alpha/UV data',()=>{
  const fx=JSON.parse(fs.readFileSync(new URL('../skin-packs/models/fire-effects.json',import.meta.url)));
  assert.ok(Object.values(fx.materials).every(m=>m.kind!=='skinproc'));
  const find=name=>Object.entries(fx.materials).find(([k])=>k.endsWith('/'+name))?.[1];
  const rgx=find('MFlash_Afterglow_Flash_07_MI');
  assert.equal(rgx.useAlpha,true);assert.equal(rgx.e.rot,.25);assert.equal(rgx.dissolve,3);
  assert.match(rgx.tex,/MuzzleFlash3_FB_1x4_VFX$/);assert.equal(fx.textures[rgx.tex].alphaConst,false);
  assert.equal(find('M_Spirit_Carbine_Flower01_Inst'),undefined,'unavailable vertex shader must not leave rigid crossing cards');
  const petals=find('Spirit_Flower_Par001');assert.match(petals.tex,/Spirit_Petal_01$/);assert.equal(petals.useAlpha,true);
  const mist=find('Coven_MF_Radial_FB_MI');assert.match(mist.tex,/MistRadial_3x3$/);assert.notEqual(mist.tex,mist.lut);
  for(const m of Object.values(fx.materials))if(m.kind==='skinmask'){
    assert.ok(m.tex&&!/LUT|Noise|Distort|DefaultDiffuse/.test(m.tex));
    assert.ok([...m.e.scale,...m.e.offset,m.e.rot,...m.e.scroll,...m.tint].every(Number.isFinite));
  }
});
