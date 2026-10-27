import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWeaponAppearance} from '../patches/weapon-models-runtime.mjs';
import {animationState} from '../patches/weapon-motion-runtime.mjs';
import {applyWeaponModelsPatch} from '../patches/weapon-models.mjs';

function scene(deferWorldUpdate,attachment=false){
  const counters={worldRefreshes:0,boneUploads:0};
  class Vector{
    constructor(){this.set(0,0,0);}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
    copy(v){return this.set(v.x,v.y,v.z);}
  }
  class Quaternion{
    constructor(x=0,y=0,z=0,w=1){this.set(x,y,z,w);}
    set(x,y,z,w){Object.assign(this,{x,y,z,w});return this;}
    copy(q){return this.set(q.x,q.y,q.z,q.w);}
    invert(){return this;}
    multiplyQuaternions(){return this;}
    normalize(){return this;}
  }
  class Group{
    constructor(){this.children=[];this.position=new Vector();this.scale=new Vector().set(1,1,1);this.quaternion=new Quaternion();this.userData={};this.visible=true;this.worldX=0;}
    add(child){child.parent?.remove(child);child.parent=this;this.children.push(child);}
    remove(child){this.children=this.children.filter(value=>value!==child);child.parent=null;}
    updateWorldMatrix(parents,children){
      if(this.name?.startsWith('skin:'))counters.worldRefreshes++;
      if(parents)this.parent?.updateWorldMatrix(true,false);
      this.worldX=(this.parent?.worldX??0)+this.position.x;
      if(children)for(const child of this.children)child.updateWorldMatrix(false,true);
    }
    updateMatrixWorld(){this.updateWorldMatrix(false,true);}
  }
  class Bone extends Group{}
  class Skeleton{
    constructor(bones){this.bones=bones;this.values=[];}
    update(){counters.boneUploads++;this.values=this.bones.map(bone=>bone.worldX);}
    dispose(){}
  }
  class SkinnedMesh extends Group{constructor(geometry,material){super();this.geometry=geometry;this.material=material;}bind(skeleton){this.skeleton=skeleton;}}
  class Geometry{setAttribute(){}setIndex(){}dispose(){}}
  class Attribute{}
  class Material{dispose(){}}
  class Texture{}
  const root=new Group(),hand=new Bone(),parent=new Group();root.add(hand);hand.add(parent);
  const baseBones=[new Bone(),new Bone()];baseBones[0].name='Root';baseBones[1].name='Muzzle';parent.add(baseBones[0]);baseBones[0].add(baseBones[1]);
  const rest=[{name:'Root',parent:-1,t:[1,0,0],q:[0,0,0,1],s:[1,1,1]},{name:'Muzzle',parent:0,t:[2,0,0],q:[0,0,0,1],s:[1,1,1]}];
  const primitive={position:new Float32Array(9),normal:new Float32Array(9),uv:new Float32Array(6),index:new Uint16Array([0,1,2]),material:0};
  const assets={key:'test/melee',parts:[{role:'body',materials:[{name:'test',hidden:true}],data:{bones:rest,primitives:[primitive,primitive]}}],pictures:new Map(),attachment:attachment?{bone:'Hand'}:null};
  const skin=createWeaponAppearance({types:{Group,Bone,Skeleton,SkinnedMesh,Mesh:SkinnedMesh,Geometry,Attribute,Material,Texture,Vector3:Vector,Quaternion},parent,
    baseRig:{index:new Map([['Root',0],['Muzzle',1]]),bones:baseBones},baseRest:{t:[0,0,0,0,0,0],q:[0,0,0,1,0,0,0,1]},
    armsRig:{index:new Map([['Hand',0]]),bones:[hand]},originals:[],stem:'knife',initial:assets,deferWorldUpdate,
    skins:{subscribe(){return()=>{};}},loader:{selectionKey(){return assets.key;}}});
  counters.worldRefreshes=counters.boneUploads=0;
  function apply(x){hand.position.x=x;baseBones[0].position.x=x/2;baseBones[1].position.x=x/4;skin.update({seconds:x});}
  function inspect(){const bone=skin.effectBone('Muzzle'),group=bone.parent.parent;return {position:bone.worldX,groupX:group.worldX,boneData:group.children.find(child=>child.skeleton).skeleton.values};}
  function render(){const skeleton=skin.effectBone('Muzzle').parent.parent.children.find(child=>child.skeleton).skeleton;skeleton.update();}
  return {root,skin,counters,apply,inspect,render};
}

test('native-root refresh preserves skin sockets and bone data while removing the extra update/upload',()=>{
  for(const attachment of [false,true]){
    const standalone=scene(false,attachment),native=scene(true,attachment);
    for(const x of [1,7,-3]){
      standalone.apply(x);native.apply(x);
      standalone.root.updateMatrixWorld(true);native.root.updateMatrixWorld(true);
      standalone.render();native.render();
      assert.deepEqual(native.inspect(),standalone.inspect(),'skin pose and effect socket match after the native root refresh');
    }
    assert.equal(native.counters.boneUploads,3,'shared skin skeleton is uploaded by rendering, not by appearance.update as well');
    assert.equal(standalone.counters.boneUploads,6,'standalone/review mode retains its immediate bone refresh');
    assert.ok(native.counters.worldRefreshes<standalone.counters.worldRefreshes,'remove a whole skin-subtree walk each update');
    standalone.skin.dispose();native.skin.dispose();
  }
});

test('native bridge opts in only where the full hand-root update follows skin sampling',()=>{
  const source=Object.fromEntries(['CFqO0zvx.js','CymPR-fm.js'].map(name=>[name,fs.readFileSync(new URL('../site/js/'+name,import.meta.url),'utf8')]));
  const patched=applyWeaponModelsPatch(source)['CFqO0zvx.js'];
  const skinUpdate=patched.indexOf('__aimAppearance?.update(bf,');
  const rootUpdate=patched.indexOf("a9['root']['updateMatrixWorld'](!0x0)",skinUpdate);
  const render=patched.indexOf("'render'(bf,bg)",rootUpdate);
  assert.ok(skinUpdate>=0&&rootUpdate>skinUpdate&&render>rootUpdate);
  assert.match(patched,/environment:ac,deferWorldUpdate:true/);
  assert.match(source['CFqO0zvx.js'],/a9\['bones'\]\[ai\]\['add'\]\(ah\)/,'skin parent belongs to the native hand-root subtree');
  const renderer=fs.readFileSync(new URL('../site/js/aQOfOAp-.js',import.meta.url),'utf8');
  assert.ok(renderer.includes('const d=l.skeleton;r.get(d)!==h&&(d.update(),r.set(d,h))'),'retained Three renderer caches skeleton updates by frame');
});

test('animation event lookup retains the last matching untagged and weapon-specific events',()=>{
  const actions={inspect:{arms:{duration:5}},fire:{arms:{duration:.3}}};
  const events=Object.freeze([{at:1,inspect:true},{at:1.5,inspect:true,weapon:'vandal'},{at:2,inspect:true,weapon:'phantom'},{at:2.5,weapon:'vandal'}].map(Object.freeze));
  const state={seconds:3,shots:[],melee:events};
  assert.equal(animationState(actions,state,'phantom').time,1);
  assert.equal(animationState(actions,state,'vandal').time,1.5);
  assert.equal(animationState(actions,state,'sheriff').time,2);
});
