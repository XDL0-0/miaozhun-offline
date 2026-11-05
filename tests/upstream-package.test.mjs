import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveReference, inspectModuleDependencies, createPackageCodec, createSceneValidator, checkOfflineGuard, verifyPackage} from '../scripts/verify-upstream-offline.mjs';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=path.join(repository,'upstream/aimpro-2026-11-05');
const codecSource=fs.readFileSync(path.join(snapshot,'source/js/ATp_kJvD.js'),'utf8');
const schemaSource=fs.readFileSync(path.join(snapshot,'source/js/B3BEvzMF.js'),'utf8');
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'aim-upstream-verifier-'));

test('dependency scanner follows real imports and Vite preloads without alias/source false positives',()=>{
  const source=`import {x} from './first.js';export {x} from './second.js';
    const aliases={'./not-loaded.js':x};
    const shader='import "./embedded.js";';
    const template=\`import './also-embedded.js'\`;
    const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=['/css/page.css','/js/page.js'])))=>i.map(i=>d[i]);
    const load=()=>import('./dynamic.js');const retry=url=>import(url);
    const worker=new URL('./worker.js',import.meta.url);`;
  const result=inspectModuleDependencies(source);
  assert.deepEqual(result.references.map(x=>x.value).sort(),['./first.js','./second.js','/css/page.css','/js/page.js','./dynamic.js','./worker.js'].sort());
  assert.equal(result.unresolvedImports.length,1);
  assert.equal(result.unresolvedImports[0].expression,'import(url)');
  assert.throws(()=>inspectModuleDependencies('import {'),SyntaxError);
});

test('resource paths reject external hosts and traversal while ignoring embedded CSS fragments',()=>{
  assert.equal(resolveReference('./part.bin','/aim-weapons/gun.json'),'/aim-weapons/part.bin');
  assert.equal(resolveReference('/fonts/font.woff2?v=3'),'/fonts/font.woff2');
  for(const value of ['data:image/svg+xml,svg','blob:local','#mask','%23n'])assert.equal(resolveReference(value,'/css/page.css'),null);
  for(const value of ['https://example.com/font.woff2','//example.com/x','/a/%2e%2e/secret','/a\\secret'])assert.throws(()=>resolveReference(value));
});

test('hash-pinned codec authenticates a local fixture and rejects corruption or external decode paths',async()=>{
  const root=temporary(),logical='/aim-weapons/ares.json';
  try{
    const revision=JSON.parse(fs.readFileSync(path.join(snapshot,'asset-revisions.json')))[logical];
    const stored=logical+'.'+revision+'.enc',target=path.join(root,stored);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(snapshot,'client',stored),target);
    const codec=createPackageCodec(codecSource,root);
    const bytes=await codec.decode(logical);
    assert.ok(JSON.parse(bytes.toString()).parts.length>0);
    assert.deepEqual([...codec.fetched],[stored]);
    await assert.rejects(codec.decode('https://example.com/aim-weapons/ares.json'),/Unsafe decode path/);
    const damaged=fs.readFileSync(target);damaged[damaged.length-1]^=1;fs.writeFileSync(target,damaged);
    await assert.rejects(codec.decode(logical));
    assert.throws(()=>createPackageCodec(codecSource+'\n',root),/SHA-256 mismatch/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('native schema accepts every original serialized scene and rejects broken references',()=>{
  const validate=createSceneValidator(schemaSource);
  const workshop=JSON.parse(fs.readFileSync(path.join(snapshot,'workshop.json')));
  assert.equal(workshop.data.length,100);
  let document;
  for(const item of workshop.data){
    const serialized=JSON.parse(fs.readFileSync(path.join(snapshot,'scenes',item.shareCode))).data.doc;
    const original=JSON.parse(serialized),parsed=validate(serialized);
    assert.equal(parsed.meta.id,original.meta.id);
    assert.equal(parsed.actors.length,original.actors.length);
    if(!document&&original.actors.length)document=original;
  }
  document.spawners=[{id:'broken-spawner',position:{x:0,y:0,z:0},size:{x:1,y:1,z:1},maxAlive:1,actorTemplateId:'no-such-actor',interval:[1,1],kind:'area'}];
  assert.throws(()=>validate(JSON.stringify(document)));
  assert.throws(()=>validate('{"schemaVersion":99}'));
  assert.throws(()=>createSceneValidator(schemaSource+'\n'),/SHA-256 mismatch/);
});

test('offline network guard exercises remapping and fails closed if external fetch protection is removed',async()=>{
  const root=temporary();
  const prefix=`(()=>{const localFetch=window.fetch.bind(window);
    const safe=input=>{const u=new URL(String(input),location.href);if(['aimpro.world','ishoutu.cn','static.ishoutu.cn'].includes(u.hostname))return location.origin+u.pathname;if(u.origin!==location.origin)throw Error('external');return u.href;};
    window.fetch=async input=>localFetch(safe(input));
    const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){return open.call(this,method,safe(url));};
    navigator.sendBeacon=()=>false;\n const favoriteKey='unused';})();`;
  try{
    fs.writeFileSync(path.join(root,'offline-runtime.js'),prefix);
    const clean=[];await checkOfflineGuard(root,clean);assert.deepEqual(clean,[]);
    fs.writeFileSync(path.join(root,'offline-runtime.js'),prefix.replace('window.fetch=async input=>localFetch(safe(input));','window.fetch=async input=>localFetch(input);'));
    const failures=[];await checkOfflineGuard(root,failures);assert.ok(failures.some(f=>f.error.includes('External fetch not blocked')));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a missing package returns failures rather than declaring partial checks a pass',async()=>{
  const root=temporary();
  try{
    const result=await verifyPackage(root);
    assert.equal(result.success,false);
    assert.equal(result.encryptedResources,0);
    assert.equal(result.sceneCount,0);
    assert.ok(result.failures.some(f=>f.stage==='package manifest'));
    assert.ok(result.failures.some(f=>f.stage==='legacy kernels'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
