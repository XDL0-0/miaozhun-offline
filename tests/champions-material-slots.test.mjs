import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root=new URL('../',import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(new URL(p.replace(/^\//,''),root)));
const local=p=>new URL(p.replace(/^\//,''),root);
const review=read('skin-packs/audit/champions-material-slot-review.json');
const index=read('skin-packs/models/index.json');
function packageFor(entry){
  const year=entry.name.match(/20\d\d/)[0];
  const weapon=entry.name.match(/\b(Vandal|Phantom|Melee)\b/)[0].toLowerCase();
  const key=`champions-${year}/${weapon}`;
  return read(entry.theme?index.variants[key][entry.theme]:index.models[key]);
}
function glb(bytes){
  assert.equal(bytes.toString('ascii',0,4),'glTF');
  return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
}

test('Champions primitives retain the original UE material-slot assignments after GLB reordering',()=>{
  assert.equal(review.entries.length,14);
  assert.deepEqual(review.conflicts,[]);
  let parts=0,primitives=0,reordered=0;
  for(const entry of review.entries){
    const pack=packageFor(entry);
    assert.equal(pack.theme??null,entry.theme);
    assert.equal(pack.parts.length,entry.parts.length,entry.name);
    for(const source of entry.parts){
      const part=pack.parts.find(p=>p.role===source.role);
      assert.ok(part,`${entry.name}: ${source.role}`);
      const bytes=fs.readFileSync(local(part.url));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),source.assetSha256);
      const model=glb(bytes),names=model.materials.map(m=>m.name);
      assert.deepEqual(names,source.originalGLBMaterials);
      assert.equal(part.materials.length,names.length);
      const byName=new Map();
      for(const binding of source.bindings.filter(b=>b.lod0Used)){
        assert.ok(source.usedUEMaterialIndices.includes(binding.ueIndex));
        const target=source.originalUEOverrides?.[binding.ueIndex]??binding.exportMaterialName;
        assert.equal(binding.targetMaterialName,target);
        if(byName.has(binding.exportMaterialName))assert.equal(byName.get(binding.exportMaterialName),target);
        byName.set(binding.exportMaterialName,target);
        if(names.indexOf(binding.exportMaterialName)!==binding.ueIndex)reordered++;
      }
      for(const [i,name] of names.entries()){
        assert.ok(byName.has(name),`${entry.name}/${source.role}: ${name}`);
        assert.equal(part.materials[i].name,byName.get(name),`${entry.name}/${source.role}/${name}`);
      }
      for(const primitive of model.meshes.flatMap(m=>m.primitives)){
        assert.ok(Number.isInteger(primitive.material));
        assert.ok(primitive.material>=0&&primitive.material<names.length);
        const material=part.materials[primitive.material];
        assert.equal(material.name,byName.get(names[primitive.material]));
        primitives++;
      }
      parts++;
    }
  }
  assert.equal(parts,31);
  assert.ok(primitives>=parts);
  assert.ok(reordered>=6,'the fixture must cover the actual UE/GLB order differences');
});

test('the formerly swapped Champions body and glass slots stay on their own geometry',()=>{
  const body=year=>packageFor(review.entries.find(e=>e.name.startsWith(`Champions ${year} `)&&!e.name.includes('Melee'))).parts.find(p=>p.role==='body');
  assert.equal(body(2022).materials[0].name,'Carbine_Champions2_Emissive_MI');
  assert.equal(body(2023).materials[0].name,'1P_Champions2023_Ray_Lv4_MI');
  assert.equal(body(2024).materials[0].name,'champions_jellyTest_MI');
  assert.equal(body(2025).materials[0].name,'AK_Midas_Lv3_MI');
  const knife=packageFor(review.entries.find(e=>e.name==='Champions 2023 Melee'));
  assert.equal(knife.parts[0].materials[1].name,'1P_Infinity_ChampionsMelee_MI');
});

test('Champions 2026 themes keep their distinct source geometry and surface assignments',()=>{
  const packs=weapon=>['defending','attacking'].map(theme=>packageFor(review.entries.find(e=>e.theme===theme&&e.name.includes(weapon))));
  const [dragon,snake]=packs('Phantom');
  assert.notEqual(dragon.parts[0].url,snake.parts[0].url);
  assert.equal(dragon.parts[0].materials[1].name,'MAT_Temp_Champions2026_Screen_Defender');
  assert.equal(snake.parts[0].materials[1].name,'MAT_Temp_Champions2026_Screen_Attacker');
  assert.equal(snake.parts[0].materials[2].name,'VCT26Season_Decals_Omega');
  const [dragonKnife,snakeKnife]=packs('Melee');
  assert.equal(dragonKnife.parts[0].url,snakeKnife.parts[0].url);
  assert.notEqual(dragonKnife.parts[0].materials[0].map,snakeKnife.parts[0].materials[0].map);
  assert.equal(snakeKnife.parts[0].materials[1].name,'Melee_Champions2026_Fan_Snake_MI');
});
