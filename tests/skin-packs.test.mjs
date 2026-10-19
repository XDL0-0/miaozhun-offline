import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {catalog,requiredAssets,auditPack,audit,scaffold,stage,validateCatalog} from '../scripts/skin-packs.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const review=readJSON(path.join(projectRoot,'skin-packs','asset-review.json'));
const ffmpegAvailable=spawnSync('ffmpeg',['-version']).status===0;

function partialFixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aim-skin-cli-'));
  const collection={...catalog.collections.find(item=>item.id==='ora-by-onetap'),themes:['base']};
  const selected={schemaVersion:1,audio:review.audio.filter(entry=>entry.collection===collection.id&&entry.theme==='base'&&entry.id==='1'),
    banners:review.banners.filter(entry=>entry.collection===collection.id&&entry.theme==='base'),fire:[]};
  for(const entry of [...selected.audio,...selected.banners,...selected.banners.flatMap(banner=>Object.values(banner.layers??{}))]){
    const target=path.join(root,entry.path);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(projectRoot,entry.path),target);
  }
  fs.writeFileSync(path.join(root,'skin-packs','catalog.json'),JSON.stringify({compiledOn:'2026-10-19',collections:[collection]}));
  fs.writeFileSync(path.join(root,'skin-packs','asset-review.json'),JSON.stringify(selected));
  return {root,collection,review:selected,destination:path.join(root,'dist','skin-packs')};
}

test('catalog has ranked top tens with five orange entries each',()=>{
  assert.equal(validateCatalog(),true);
  for(const weapon of ['vandal','phantom']){
    const ranked=catalog.ranking.top10[weapon];
    assert.equal(ranked.length,10);
    assert.equal(ranked[0].tier,'Default');
    assert.deepEqual(ranked.map(x=>x.rank),[1,2,3,4,5,6,7,8,9,10]);
    assert.equal(ranked.filter(x=>x.tier==='Exclusive').length,5);
  }
});

test('all exclusive top-ten skins are represented with exact weapon coverage',()=>{
  const grouped=new Map(catalog.collections.filter(c=>c.tier==='Exclusive').map(c=>[c.name,c.weapons]));
  for(const weapon of ['vandal','phantom'])for(const x of catalog.ranking.top10[weapon].filter(x=>x.tier==='Exclusive')){
    assert.ok(grouped.get(x.name)?.includes(weapon),x.name+' / '+weapon);
  }
  assert.equal(grouped.size,8);
});

test('ORA requires independent fire per weapon and theme, previews and radial banner layers',()=>{
  const ora=catalog.collections.find(c=>c.id==='ora-by-onetap');
  assert.equal(ora.tier,'Ultra');
  assert.deepEqual(ora.themes,['base','watch','renegade','raja','ignition']);
  assert.deepEqual(ora.weapons,['vandal','phantom','sheriff','operator']);
  const assets=requiredAssets(ora),fire=assets.filter(asset=>asset.kind==='fire'),banners=assets.filter(asset=>asset.kind==='banner');
  assert.equal(fire.length,20);
  assert.equal(new Set(fire.map(asset=>asset.theme+'/'+asset.weapon)).size,20);
  assert.ok(fire.every(asset=>asset.source&&asset.sha256),'every weapon and theme has an independently reviewed gunfire excerpt');
  assert.equal(banners.length,5);
  assert.ok(banners.every(asset=>asset.id==='banner:default'&&asset.source.endsWith('/default.png')));
  const layers=assets.filter(asset=>asset.kind==='banner-layer');
  assert.equal(layers.length,25);
  assert.ok(layers.every(asset=>asset.source&&asset.sha256));
  const oneFire={collection:ora.id,theme:'base',weapon:'vandal',path:'skin-packs/media/ora-by-onetap/fire/base/vandal.mp3',sha256:'a'.repeat(64)};
  const changed=requiredAssets(ora,{...review,fire:[oneFire]}).filter(asset=>asset.kind==='fire');
  assert.equal(changed.find(asset=>asset.theme==='base'&&asset.weapon==='vandal').source,oneFire.path);
  assert.equal(changed.filter(asset=>asset.source!==null).length,1,'Base fire must not stand in for other themes or weapons');
});

test('review audit covers every catalog gunfire combination and all retained effects',()=>{
  const packs=audit(),assets=packs.flatMap(pack=>pack.assets);
  assert.equal(packs.length,9);
  assert.equal(assets.filter(asset=>asset.status==='present'&&['fire','kill','successive'].includes(asset.kind)).length,109);
  assert.equal(assets.filter(asset=>asset.status==='present'&&asset.kind==='fire').length,30);
  assert.equal(assets.filter(asset=>asset.status==='present'&&asset.kind==='banner').length,37);
  assert.equal(assets.filter(asset=>asset.status==='present'&&asset.kind==='banner-layer').length,185);
  assert.deepEqual(packs.flatMap(pack=>pack.missing),[]);
  assert.ok(packs.every(pack=>pack.sourceStatus==='complete'&&pack.complete));
  assert.ok(assets.some(asset=>asset.kind==='kill'&&asset.id==='kill:6'&&asset.source.includes('/ayakashi/')));
});

test('audit distinguishes missing review, absent bytes, and changed bytes without accepting local lookalikes',()=>{
  const f=partialFixture();
  try{
    let check=auditPack(f.collection,f);
    assert.equal(check.present,7);
    assert.equal(check.missing.find(asset=>asset.id==='fire:vandal').status,'not-reviewed');
    const unreviewed=path.join(f.root,'skin-packs','local',f.collection.id,'weapons','vandal','fire.ogg');
    fs.mkdirSync(path.dirname(unreviewed),{recursive:true});fs.writeFileSync(unreviewed,'lookalike');
    assert.equal(auditPack(f.collection,f).present,7);
    fs.appendFileSync(path.join(f.root,f.review.audio[0].path),'changed bytes');
    check=auditPack(f.collection,f);
    assert.equal(check.missing.find(asset=>asset.id==='kill:1').status,'hash-mismatch');
    fs.unlinkSync(path.join(f.root,f.review.banners[0].path));
    check=auditPack(f.collection,f);
    const missingBanner=check.missing.find(asset=>asset.id==='banner:default');
    assert.equal(missingBanner.status,'missing-file');
    assert.equal(missingBanner.source,f.review.banners[0].path);
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});

test('legacy scaffold prints the reviewed inventory without creating fictitious asset folders',()=>{
  const f=partialFixture();
  try{
    const before=fs.readdirSync(path.join(f.root,'skin-packs'));
    const packs=scaffold(f);
    assert.equal(packs.length,1);
    assert.ok(packs[0].assets.some(asset=>asset.id==='fire:operator'&&asset.source===null));
    assert.deepEqual(fs.readdirSync(path.join(f.root,'skin-packs')),before);
    assert.ok(!fs.existsSync(path.join(f.root,'skin-packs','local')));
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});

test('legacy stage builds schema 2 and retains available media in partial packs', {skip:!ffmpegAvailable},()=>{
  const f=partialFixture();
  try{
    fs.mkdirSync(f.destination,{recursive:true});
    fs.writeFileSync(path.join(f.destination,'index.json'),JSON.stringify({schemaVersion:1,collections:[{id:f.collection.id,installed:true}]}));
    fs.writeFileSync(path.join(f.destination,'stale-unreviewed.ogg'),'old');
    const manifest=stage(f),written=readJSON(path.join(f.destination,'index.json'));
    assert.deepEqual(written,manifest);
    assert.equal(written.schemaVersion,2);
    assert.equal(written.resourceStatus,'partial');
    assert.equal(written.collections.length,1,'missing gunfire cannot skip an otherwise usable collection');
    const theme=written.collections[0].themes[0];
    assert.deepEqual(theme.fire,{vandal:null,phantom:null,sheriff:null,operator:null});
    assert.ok(theme.missing.includes('fire:vandal'));
    assert.ok(theme.missing.includes('kill:2'));
    assert.ok(theme.kills[1]);assert.equal(theme.banners.length,1);
    for(const url of [theme.kills[1],theme.banners[0].url])assert.ok(fs.statSync(path.join(f.destination,url.slice('/skin-packs/'.length))).size>0);
    assert.ok(!fs.existsSync(path.join(f.destination,'stale-unreviewed.ogg')));
    assert.equal(written.runtimeStatus,undefined,'a file build must not claim browser integration acceptance');
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
