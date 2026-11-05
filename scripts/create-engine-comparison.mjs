// Build isolated old/new native-engine benchmarks. Never patches production.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse} from './vendor/acorn.cjs';
const repo=path.resolve(new URL('..',import.meta.url).pathname);
const output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'local-data/engine-comparison-2026-11-05');
const seed=20261105;
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const schemas={legacy:{game:'CymPR-fm.js',world:'aQOfOAp-.js',maps:'f1',factory:'yg',viewport:'i',controller:'te',sim:'ke',snapshot:'It',tick:'md',render:'yd',step:'he',options:'o',nativeStencil:false},upstream:{game:'CBthEhpW.js',world:'CqM6URxy.js',maps:'gc',factory:'Nb',viewport:'l',controller:'ke',sim:'Me',snapshot:'is',tick:'jm',render:'ep',step:'we',options:'s',nativeStencil:true}};
const roots={old:option('before')??option('old-root')??'backups/dist-before-aimpro-2026-11-05',new:option('after')??'dist'};
const variants=Object.fromEntries(Object.entries(roots).map(([engine,source])=>{
 const root=path.resolve(repo,source),manifest=JSON.parse(fs.readFileSync(path.join(root,'offline-manifest.json'),'utf8'));
 const schema=manifest.engineBuild==='aimpro-2026-11-05'?'upstream':'legacy';
 return [engine,{...schemas[schema],source:root,schema,port:engine==='old'?18820:18821}];
}));
const benchmarkKind=variants.old.schema===variants.new.schema?'optimization':'engine-migration';
const labels=benchmarkKind==='optimization'?{old:'优化前',new:'优化后'}:{old:'旧引擎',new:'新引擎'};
const rounds=Number(option('rounds')??3);
if(!Number.isInteger(rounds)||rounds<1||rounds>3)throw Error('rounds must be 1, 2, or 3');
if(output===path.join(repo,'dist')||output.startsWith(path.join(repo,'dist')+path.sep)||fs.existsSync(output))throw Error('Use a fresh isolated output directory');
fs.mkdirSync(output,{recursive:true});
const cases=[{id:'ascent',code:'54145a349a983de4',name:'亚海悬城 B 中路回防'},{id:'plummet',code:'b212f6540b47679a',name:'天枢云阙 A 大预瞄'}];
for(const c of cases){
 const relative='prod-api/api/v1/public/val/aimlab/scenes/'+c.code;
 const before=JSON.parse(fs.readFileSync(path.join(variants.old.source,relative))).data.doc;
 const after=JSON.parse(fs.readFileSync(path.join(variants.new.source,relative))).data.doc;
 if(before!==after)throw Error('Scene documents differ for '+c.id);
 c.scene=JSON.parse(before);c.scene.meta.seed=seed;c.scene.rules.duration=120;
 c.sceneHash=crypto.createHash('sha256').update(JSON.stringify(c.scene)).digest('hex');
 c.spawners=c.scene.spawners.length;c.actorTemplates=c.scene.actors.length;
}
const plan=[];for(const c of cases)for(let round=1;round<=rounds;round++)for(const engine of round===2?['new','old']:['old','new'])plan.push({caseId:c.id,round,engine});
const base={benchmarkKind,labels,seed,width:1280,height:720,warmupSeconds:5,measureSeconds:15,gpuTiming:process.argv.includes('--gpu-timing'),plan,cases,ports:{old:18820,new:18821}};
for(const[engine,v]of Object.entries(variants)){
 const dest=path.join(output,engine);fs.cpSync(v.source,dest,{recursive:true});
 let source=fs.readFileSync(path.join(dest,'js',v.game),'utf8');const originalHash=crypto.createHash('sha256').update(source).digest('hex');
 let world=fs.readFileSync(path.join(dest,'js',v.world),'utf8');const originalWorldHash=crypto.createHash('sha256').update(world).digest('hex');
 const actorRenderer=v.schema==='upstream'?'Do4sYkfr.js':null;
 const originalActorRendererHash=actorRenderer?crypto.createHash('sha256').update(fs.readFileSync(path.join(dest,'js',actorRenderer))).digest('hex'):null;
 const gpuAnchor='gpuReady:()=>l?.ready()??!0,';
 if(world.split(gpuAnchor).length!==2)throw Error('Unexpected GPU diagnostic anchor');
 world=world.replace(gpuAnchor,gpuAnchor+'__benchmarkGpuStats:()=>l?.stats()??null,');
 fs.writeFileSync(path.join(dest,'js',v.world),world);
 const once=(a,b)=>{if(source.split(a).length!==2)throw Error(engine+' anchor '+a);source=source.replace(a,b);};
 const factory=`function ${v.factory}(e,t,n,${v.options}={}){`;
 once(factory,factory+'const __bench=window.__engineBenchmark;');
 once(`onTick:${v.tick},onRender:${v.render},`,`onTick:()=>__bench.tick(${v.tick}),onRender:alpha=>__bench.render(()=>${v.render}(alpha),${v.viewport}.renderer),`);
 if(v.schema==='legacy'){
  once('function Lt(){return!S||','function Lt(){return false;return!S||');
  once('te.onLockLost(()=>{ps()||Dt||W||','te.onLockLost(()=>{if(__bench)return;ps()||Dt||W||');
  once('function sr(E){const Q=Qu(E.meta.id);','function sr(E){Ta({...E,meta:{...E.meta,seed:__bench.seed}});return;const Q=Qu(E.meta.id);');
  once('n.onPhaseChange("running");if(!tn()){','n.onPhaseChange("running");nt=null;if(false){');
  once('function ad(E){if(!Zt)return;','function ad(E){__bench.abort("native-round-ended:"+E);return;if(!Zt)return;');
  once('const gd={get sceneSource()',`__bench.attach({controller:te,viewport:i,get sim(){return ke},snapshot:()=>ke?It(ke):null,step:he});const gd={get sceneSource()`);
 }else{
  once('function Ga(){return!dt||','function Ga(){return false;return!dt||');
  once('ke.onLockLost(()=>{ga()||ht||Ie||Tt||','ke.onLockLost(()=>{if(__bench)return;ga()||ht||Ie||Tt||');
  once('function yc(M){const j=Lm(M.meta.id);','function yc(M){Ja({...M,meta:{...M.meta,seed:__bench.seed}});return;const j=Lm(M.meta.id);');
  once('n.onPhaseChange("running"),Nn()||_o()','n.onPhaseChange("running"),et=null');
  once('function Um(M){if(!_n)return;','function Um(M){__bench.abort("native-round-ended:"+M);return;if(!_n)return;');
  once('const tp={rebuildScene:gc',`__bench.attach({controller:ke,viewport:l,get sim(){return Me},snapshot:()=>Me?is(Me):null,step:we});const tp={rebuildScene:gc`);
 }
 source+=`\nexport {${v.factory} as __benchmarkCreateTraining};\n`;parse(source,{ecmaVersion:'latest',sourceType:'module'});fs.writeFileSync(path.join(dest,'js',v.game),source);
 fs.writeFileSync(path.join(dest,'__engine-config.json'),JSON.stringify({...base,engine,game:v.game,world:v.world,actorRenderer,originalActorRendererHash,mapsExport:v.maps,nativeStencil:v.nativeStencil,sourceRoot:v.source,originalGameHash:originalHash,originalWorldHash}));
 for(const [src,target]of [['scripts/engine-comparison-runtime.mjs','__engine-benchmark.mjs'],['scripts/engine-comparison-metrics.mjs','__engine-metrics.mjs'],['scripts/training-render-stats.mjs','__engine-render-stats.mjs']])fs.copyFileSync(path.join(repo,src),path.join(dest,target));
 fs.writeFileSync(path.join(dest,'__engine-benchmark.html'),`<!doctype html><meta charset="utf-8"><title>新旧引擎后台对比</title><style>body{margin:0;background:#10171f;color:#e6f2ff;font:14px system-ui}#app,#offline-tools,#offline-language{display:none!important}#stage{width:1280px;height:720px;position:relative}header{height:50px;padding:4px 12px;box-sizing:border-box}pre{white-space:pre-wrap;max-height:300px;overflow:auto}button{font:inherit}</style><script>history.replaceState(null,'','/aim'+location.search);window.__AIM_NO_THIRD_PARTY_STATS__=true;Element.prototype.requestFullscreen=()=>Promise.resolve();Element.prototype.requestPointerLock=()=>Promise.resolve();</script><script src="/offline-i18n.js"></script><script src="/offline-runtime.js"></script><div id="app"></div><header><b>新旧引擎后台对比</b> <span id="status">准备中</span></header><div id="stage"></div><pre id="result"></pre><script type="module" src="/__engine-benchmark.mjs"></script>`);
}
fs.writeFileSync(path.join(output,'plan.json'),JSON.stringify(base,null,2));console.log(output);
