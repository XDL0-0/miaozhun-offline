// Decode the captured client's delta-compressed robot recordings, offline.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import acorn from './vendor/acorn.cjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.argv[2]??path.join(project,'upstream/aimpro-2026-11-05'));
const sourceFile='source/js/B3BEvzMF.js';
const source=await fs.readFile(path.join(root,sourceFile),'utf8');
const sha256=crypto.createHash('sha256').update(source).digest('hex');
if(sha256!=='eb88ea6c8eb090183694eddbdbb546c5757a50a46e2c164bb682b60e7fee5c57')throw new Error('Unreviewed upstream track decoder');
// Only these reviewed pure scalar/array routines are evaluated. No application,
// browser, network, filesystem, imports, or scene execution enter the context.
const required=new Set(['F','yt','k','T','mt','at','gt','K','C','At','Vt','B','Gt','ct','jt','Ft','Ht','x','Et','Bt','Ut','N','ye']);
const chunks=[];
for(const node of acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body){
  if(node.type==='FunctionDeclaration'&&required.delete(node.id.name))chunks.push(source.slice(node.start,node.end));
  if(node.type==='VariableDeclaration')for(const declaration of node.declarations){
    if(required.delete(declaration.id.name))chunks.push(`${node.kind} ${source.slice(declaration.start,declaration.end)};`);
  }
}
if(required.size)throw new Error('Missing decoder definitions: '+[...required].join(','));
const context=vm.createContext({}, {codeGeneration:{strings:false,wasm:false}});
vm.runInContext(chunks.join('\n')+';this.decoder={parse:Gt,sample:ye,hz:F};',context,{timeout:1000});
const {decoder}=context;
const catalog=JSON.parse(await fs.readFile(path.join(root,'workshop.json'),'utf8'));
const tracks=[];
for(const item of catalog.data){
  const sceneFile=`scenes/${item.shareCode}`;
  const response=JSON.parse(await fs.readFile(path.join(root,sceneFile),'utf8'));
  const scene=typeof response.data.doc==='string'?JSON.parse(response.data.doc):response.data.doc;
  for(const [actorIndex,actor] of scene.actors.entries())for(const [behaviorIndex,behavior] of actor.behaviors.entries()){
    if(behavior.kind!=='take')continue;
    const parsed=decoder.parse(behavior.track);
    if(!parsed)throw new Error(`Invalid recording: ${item.shareCode} / ${actor.id}`);
    const frames=Array.from({length:parsed.n},(_,tick)=>({tick,seconds:tick/decoder.hz,...decoder.sample(parsed,tick)}));
    const spawners=scene.spawners.flatMap((spawner,index)=>spawner.actorTemplateId===actor.id?[{jsonPointer:`/spawners/${index}`,definition:spawner}]:[]);
    const dispatchers=(scene.dispatchers??[]).flatMap((dispatcher,index)=>(dispatcher.routes??[]).flatMap((route,routeIndex)=>route.templateId===actor.id?[{jsonPointer:`/dispatchers/${index}/routes/${routeIndex}`,definition:route}]:[]));
    tracks.push({shareCode:item.shareCode,sceneName:item.name,mapId:scene.environment.map??null,actorId:actor.id,source:{file:sceneFile,jsonPointer:`/actors/${actorIndex}/behaviors/${behaviorIndex}/track`,documentPointer:'/data/doc'},recordingOrigin:behavior.track.from??null,behavior,spawners,dispatchers,frameCount:parsed.n,frames});
  }
}
const report={source:'https://aimpro.world/aim',decoder:{file:sourceFile,sha256,parse:'Gt/Ht',sample:'ye',ticksPerSecond:decoder.hz},coordinateSystem:'Frames are local to the recording placement. x/y/z are scene units; yaw is a relative angle in radians, pitchDeg in degrees. Preserve each spawner/dispatcher placement, trim, speed and delay when playing a recording. These are authored motion samples, not all possible random live spawn outcomes.',sceneCount:new Set(tracks.map(track=>track.shareCode)).size,trackCount:tracks.length,frameCount:tracks.reduce((sum,track)=>sum+track.frameCount,0),tracks};
await fs.writeFile(path.join(root,'robot-motion-frames.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sceneCount:report.sceneCount,trackCount:report.trackCount,frameCount:report.frameCount,ticksPerSecond:decoder.hz}));
