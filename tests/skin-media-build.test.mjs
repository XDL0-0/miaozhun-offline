import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSkinPacks} from '../scripts/build-skin-packs.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const toolsAvailable=spawnSync('ffmpeg',['-version']).status===0&&spawnSync('ffprobe',['-version']).status===0;

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aim-reviewed-media-'));
  const collection=read(path.join(projectRoot,'skin-packs/catalog.json')).collections.find(c=>c.id==='ora-by-onetap');
  const review=read(path.join(projectRoot,'skin-packs/asset-review.json'));
  collection.themes=['base'];
  review.audio=review.audio.filter(e=>e.collection===collection.id&&e.theme==='base'&&(e.id==='1'||e.role==='successive'));
  review.banners=review.banners.filter(e=>e.collection===collection.id&&e.theme==='base');
  review.fire=[];
  for(const entry of [...review.audio,...review.banners]){
    const target=path.join(root,entry.path);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(projectRoot,entry.path),target);
  }
  fs.writeFileSync(path.join(root,'skin-packs/catalog.json'),JSON.stringify({compiledOn:'2026-10-19',collections:[collection]}));
  fs.writeFileSync(path.join(root,'skin-packs/asset-review.json'),JSON.stringify(review));
  return {root,review,destination:path.join(root,'dist','skin-packs')};
}

function treeHashes(root,prefix=''){
  return Object.fromEntries(fs.readdirSync(path.join(root,prefix)).sort().flatMap(name=>{
    const relative=path.join(prefix,name),filename=path.join(root,relative);
    return fs.statSync(filename).isDirectory()?Object.entries(treeHashes(root,relative)):[[relative,digest(filename)]];
  }));
}

test('reviewed originals build valid, deterministic media with explicit missing fire', {skip:!toolsAvailable},()=>{
  const f=fixture();
  try{
    // The fixture contains no local/wiki-downloads directory.
    const manifest=buildSkinPacks(f),theme=manifest.collections[0].themes[0];
    assert.equal(manifest.schemaVersion,2);
    assert.equal(manifest.sourceStatus,'partial');
    assert.equal(manifest.resourceStatus,'partial');
    assert.deepEqual(Object.values(theme.fire),[null,null,null,null]);
    assert.deepEqual(Object.keys(theme.kills),['1']);
    assert.ok(theme.missing.includes('kill:2'));
    assert.ok(theme.missing.includes('fire:phantom'));
    assert.equal(theme.label,'Base');
    assert.equal(manifest.counts.audio,2);
    assert.equal(manifest.counts.banners,1);
    const ogg=path.join(f.destination,theme.successive.slice('/skin-packs/'.length));
    assert.equal(fs.readFileSync(ogg).subarray(0,4).toString(),'OggS');
    const probe=spawnSync('ffprobe',['-v','error','-show_streams','-of','json',ogg],{encoding:'utf8'});
    assert.equal(probe.status,0);
    assert.equal(JSON.parse(probe.stdout).streams[0].codec_name,'vorbis');
    const png=fs.readFileSync(path.join(f.destination,theme.banners[0].url.slice('/skin-packs/'.length)));
    assert.equal(png.readUInt32BE(16),300);
    assert.equal(png.readUInt32BE(20),300);
    assert.equal(png[25],6,'normalized banner keeps RGBA transparency');
    const before=treeHashes(f.destination);
    fs.writeFileSync(path.join(f.destination,'stale.ogg'),'old build');
    buildSkinPacks(f);
    assert.deepEqual(treeHashes(f.destination),before);
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});

test('future reviewed fire is supported and missing sources cannot leave stale URLs', {skip:!toolsAvailable},()=>{
  const f=fixture();
  try{
    // Reusing a fixture clip exercises the mapping contract only.
    const clip=f.review.audio.find(e=>e.id==='1');
    f.review.fire=[{collection:clip.collection,theme:clip.theme,weapon:'vandal',path:clip.path,sha256:clip.sha256}];
    fs.writeFileSync(path.join(f.root,'skin-packs/asset-review.json'),JSON.stringify(f.review));
    let manifest=buildSkinPacks(f),theme=manifest.collections[0].themes[0];
    assert.equal(manifest.counts.fire,1);
    assert.equal(manifest.counts.audio,3);
    assert.ok(theme.fire.vandal?.endsWith('/vandal.ogg'));
    fs.unlinkSync(path.join(f.root,clip.path));
    manifest=buildSkinPacks(f);theme=manifest.collections[0].themes[0];
    assert.equal(theme.fire.vandal,null);
    assert.equal(theme.kills['1'],undefined);
    assert.ok(theme.missing.includes('fire:vandal'));
    assert.ok(theme.missing.includes('kill:1'));
    assert.ok(!fs.existsSync(path.join(f.destination,'ora-by-onetap/fire/base/vandal.ogg')));
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});

test('unreviewed bytes fail before previous output is cleared',()=>{
  const f=fixture();
  try{
    fs.mkdirSync(f.destination,{recursive:true});
    fs.writeFileSync(path.join(f.destination,'previous-build'),'preserve');
    fs.appendFileSync(path.join(f.root,f.review.audio[0].path),'changed');
    assert.throws(()=>buildSkinPacks(f),/hash mismatch/);
    assert.equal(fs.readFileSync(path.join(f.destination,'previous-build'),'utf8'),'preserve');
    assert.throws(()=>buildSkinPacks({...f,destination:f.root}),/separate/);
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
