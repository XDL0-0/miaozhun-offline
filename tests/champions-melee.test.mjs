import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWeaponMotion,animationState,createWeaponMotionPlayer} from '../patches/weapon-motion-runtime.mjs';

const meta={names:['MasterWeapon'],rest:[[0,0,0,0,0,0,1,1,1,1]],frames:1,duration:1/30,sampleRate:0};
const bytes=new Float32Array([3,0,0,0,0,0,1,1,1,1]).buffer;
const track=(clip,duration=1)=>({duration,segments:[{clip,start:0,from:0,to:duration,rate:1,loops:1}]});
const actions={idle:{arms:track('idle')},equip:{arms:track('equip')},inspect:{arms:track('inspect',2)},heavy:{arms:track('heavy')}};
for(let i=1;i<=4;i++)actions['attack'+i]={arms:track('attack'+i)};

test('original single-frame knife idle poses remain valid without inventing motion frames',()=>{
 const clip=decodeWeaponMotion(meta,bytes);assert.equal(clip.frames,1);assert.equal(clip.sampleRate,0);assert.equal(clip.values[0],3);
 assert.throws(()=>decodeWeaponMotion({...meta,frames:2},new Float32Array(20).buffer),/Invalid weapon animation/,'moving clips cannot have zero sampling rate');
 assert.throws(()=>decodeWeaponMotion({...meta,duration:0},bytes),/Invalid weapon animation/);
 assert.throws(()=>decodeWeaponMotion(meta,bytes.slice(0,36)),/Truncated weapon animation/);
});

test('knife combos and heavy attacks interrupt inspect and equip without resuming an old inspect',()=>{
 const state={seconds:2.2,shots:[],melee:[{at:2,inspect:true,weapon:'melee'}]};
 assert.equal(animationState(actions,state,'melee').action,'inspect');
 for(let combo=0;combo<4;combo++)assert.equal(animationState(actions,{...state,melee:[...state.melee,{at:2.1,combo,weapon:'melee'}]},'melee').action,'attack'+(combo+1));
 assert.equal(animationState(actions,{...state,melee:[...state.melee,{at:2.1,heavy:true,weapon:'melee'}]},'melee').action,'heavy');
 assert.equal(animationState(actions,{...state,seconds:4,melee:[...state.melee,{at:2.1,combo:0,weapon:'melee'}]},'melee').action,'idle');
 assert.equal(animationState(actions,{...state,equipAt:2.1},'melee').action,'equip');
 assert.equal(animationState(actions,{...state,equipAt:2.1,melee:[...state.melee,{at:2.15,combo:0,weapon:'melee'}]},'melee').action,'attack1');
 assert.equal(state.melee.length,1,'cosmetic state never rewrites recorded input');
});

test('a static knife pose restores after inspect, and disposal restores native hand scale',()=>{
 const vector=()=>({x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});return this;}});
 class Quaternion{set(x,y,z,w){Object.assign(this,{x,y,z,w});return this;}normalize(){return this;}slerp(q){return this.set(q.x,q.y,q.z,q.w);}}
 const bone={name:'MasterWeapon',position:vector(),scale:vector().set(1,1,1),quaternion:new Quaternion().set(0,0,0,1)};
 const idle=decodeWeaponMotion(meta,bytes),inspect=decodeWeaponMotion({...meta,frames:2,duration:2,sampleRate:.5},new Float32Array([9,0,0,0,0,0,1,.5,.5,.5,9,0,0,0,0,0,1,.5,.5,.5]).buffer);
 const player=createWeaponMotionPlayer({motions:{clips:{idle,inspect},actions:{idle:{arms:track('idle',1/30)},inspect:{arms:track('inspect',2)}}},armsRig:{index:new Map([['MasterWeapon',0]]),bones:[bone]},armsScales:[[1,1,1]],gunBones:[],baseRig:{index:new Map()},Quaternion,weapon:'melee'});
 assert.equal(player.update({seconds:100,shots:[],melee:[]}).action,'idle');assert.equal(bone.position.x,3);
 const event={at:101,inspect:true,weapon:'melee'};
 assert.equal(player.update({seconds:102,shots:[],melee:[event]}).action,'inspect');assert.equal(bone.position.x,9);assert.equal(bone.scale.x,.5);
 assert.equal(player.update({seconds:104,shots:[],melee:[event]}).action,'idle');assert.equal(bone.position.x,3);assert.equal(bone.scale.x,1);
 player.update({seconds:105,shots:[],melee:[{at:104.5,inspect:true,weapon:'melee'}]});assert.equal(bone.scale.x,.5);
 player.dispose();assert.equal(bone.scale.x,1);
});
