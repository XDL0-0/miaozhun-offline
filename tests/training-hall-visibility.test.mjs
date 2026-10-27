import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyTrainingHallVisibilityCss,trainingHallVisibilityCss} from '../patches/training-hall-visibility.mjs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

// Execute the actual retained trainer's setup, mount, render and unmount. Its
// native engine and unrelated UI children are replaced by inert test doubles.
function nativeTrainingLayer() {
  const source=read('site/js/DVK7uRSu.js'),anchor="ad=c({'__name':'TrainLayer'",start=source.indexOf(anchor),end=source.indexOf('),zd=w(ad,',start);
  assert(start>=0&&end>start,'native TrainLayer component anchor');
  const mounts=[],unmounts=[],emitted=[],provided=[],refs=new Map(),events=[];
  const ref=value=>({value}),context=new Proxy({}, {get(object,key){
    if(!(key in object))object[key]=ref(null);
    return object[key];
  }});
  for(const [key,value] of Object.entries({pointerLive:'free',session:'standalone',phase:'idle',sessionActive:false,
    preparation:{status:'ready'},cursorGuardVisible:false,rankedOpen:false,rankedAuthOpen:false,crosshairStudioOpen:false,displaySettingsOpen:false}))context[key]=ref(value);
  const classes=new Set(),attributes=new Map(),hall={setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name)};
  const document={body:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},querySelector:selector=>selector==='.hall-root'?hall:null,
    addEventListener:(type,fn)=>events.push(['add',type,fn]),removeEventListener:(type,fn)=>events.push(['remove',type,fn]),fullscreenElement:null};
  const vnode=(type,props,children)=>({type,props:props??{},children:children??[]}),unref=value=>value&&typeof value==='object'&&'value'in value?value.value:value;
  const identifiers={c:value=>value,d:()=>({}),Hn:()=>context,R:(...args)=>provided.push(args),x:ref,e:get=>({get value(){return get();}}),A:()=>{},
    D:fn=>mounts.push(fn),E:fn=>unmounts.push(fn),$u:()=>({}),a8:()=>false,Mu:()=>({state:ref('waiting')}),
    Nu:()=>({shellClasses:ref({}),shellStyle:ref({}),stretchFactor:ref(1)}),Pu:()=>()=>{},cy:()=>null,Yu:()=>null,Ju:()=>{},Ve:()=>{},bK:()=>{},
    document,__aimOfflineLocale:{t:value=>value},Promise,console,j:()=>{},G:vnode,k:vnode,n:vnode,f:vnode,g:()=>({type:'comment'}),
    v:value=>value,O:value=>value,h:unref,S:'Teleport',Qu:{class:'al-aimlab-root hall-train-layer'}};
  for(const name of ['aG','Se','aE','a9','zi','nr','bT','Au','_u','c2','aF'])identifiers[name]=name;
  const component=vm.runInNewContext(source.slice(start+3,end+1),identifiers);
  const render=component.setup({target:null,scene:null},{emit:(...args)=>emitted.push(args)});
  return {render:()=>render({},[]),context,mount:()=>mounts.forEach(fn=>fn()),unmount:()=>unmounts.forEach(fn=>fn()),classes,attributes,emitted,events,provided};
}
function descendants(node) {
  return [node,...(Array.isArray(node?.children)?node.children.flatMap(value=>typeof value==='object'?descendants(value):[]):[])];
}

test('the background-only CSS preserves root, dialogs and navigation geometry',()=>{
  const original=read('site/css/HallView.Bm0bXTte.css'),patched=applyTrainingHallVisibilityCss(original);
  assert.equal(patched.slice(0,original.length),original);
  assert.throws(()=>applyTrainingHallVisibilityCss(patched),/already applied/);
  assert.match(original,/\.hall-root\{[^}]*display:flex;[^}]*flex-direction:column;/);
  assert.match(original,/\.hall-topnav\{[^}]*flex:none;[^}]*height:64px;/);
  assert.equal(trainingHallVisibilityCss.match(/\{[^}]+\}/g).length,2);
  assert.match(trainingHallVisibilityCss,/body\.al-training-active #app \.hall-root > header\.hall-topnav\{visibility:hidden!important\}/);
  assert.match(trainingHallVisibilityCss,/body\.al-training-active #app \.hall-root > div\.hall-body,\s*body\.al-training-active #app \.hall-root > footer\.hall-bottombar\{display:none!important\}/);
  assert(!trainingHallVisibilityCss.includes('.hall-root{'),'the injection/portal root must retain its box');
  assert(!trainingHallVisibilityCss.includes('hall-portal'),'dialogs must stay outside the targeted children');
  const hall=read('site/js/B9C9f4Y8.js');
  assert.match(hall,/document\.querySelector\("\.hall-root \.hall-topnav"\)[\s\S]{0,100}getBoundingClientRect\(\)\.bottom/,'the navigation box remains available to existing portal positioning');
});

test('the actual native trainer teleports to body, gates direct exit and restores the hall on unmount',()=>{
  const layer=nativeTrainingLayer();
  assert(!layer.classes.has('al-training-active'));
  layer.mount();assert(layer.classes.has('al-training-active'));assert.equal(layer.attributes.get('inert'),'');
  const tree=layer.render();assert.equal(tree.type,'Teleport');assert.equal(tree.props.to,'body');
  const nodes=descendants(tree),root=nodes.find(node=>node.props?.class==='al-aimlab-root hall-train-layer');
  assert(root,'the native trainer is independent of #app and hall-body');
  assert(nodes.some(node=>node.type==='zi'),'the training stage remains inside the visible teleport');
  const exit=nodes.find(node=>node.props?.['data-action']==='exit-train');assert(exit);exit.props.onClick();
  assert.deepEqual(layer.emitted,[['exit']]);
  layer.context.pointerLive.value='locked';assert(!descendants(layer.render()).some(node=>node.props?.['data-action']==='exit-train'));
  layer.context.displaySettingsOpen.value=true;assert(descendants(layer.render()).some(node=>node.type==='aF'),'in-training settings remain within the visible teleport');
  layer.unmount();assert(!layer.classes.has('al-training-active'));assert(!layer.classes.has('aimlab-page'));assert(!layer.attributes.has('inert'));
  assert(layer.events.some(([action,type])=>action==='remove'&&type==='mousedown'));
});
