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

function ffmpeg(args){
  const result=spawnSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...args],{maxBuffer:8*1024*1024});
  assert.equal(result.status,0,result.stderr?.toString());
  return result.stdout;
}

function timingSource(f){
  const sampleRate=48000,leadingSamples=35137,toneSamples=16879,tailSamples=19200;
  const sampleCount=leadingSamples+toneSamples+tailSamples,bytes=Buffer.alloc(44+sampleCount*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(sampleCount*2,40);
  for(let i=leadingSamples;i<sampleCount;i++){
    const frequency=i<leadingSamples+toneSamples?440:1760;
    bytes.writeInt16LE(Math.round(.4*32767*Math.cos(2*Math.PI*frequency*(i-leadingSamples)/sampleRate)),44+i*2);
  }
  const relative='skin-packs/media/fire-sources/timing-fixture.wav',filename=path.join(f.root,relative);
  fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes);
  f.review.audio=[];f.review.banners=[];
  const entry={collection:'ora-by-onetap',theme:'base',weapon:'vandal',path:relative,sha256:digest(filename),
    excerpt:{startSeconds:leadingSamples/sampleRate,endSeconds:(leadingSamples+toneSamples)/sampleRate}};
  f.review.fire=[entry];
  return {entry,filename,sampleRate,toneSamples};
}

function audioSamples(filename){
  const bytes=ffmpeg(['-i',filename,'-map','0:a:0','-vn','-ac','1','-ar','48000','-c:a','pcm_f32le','-f','f32le','pipe:1']);
  return Array.from({length:bytes.length/4},(_,i)=>bytes.readFloatLE(i*4));
}

const rms=samples=>Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
function toneAmplitude(samples,frequency,sampleRate){
  let real=0,imaginary=0;
  for(let i=0;i<samples.length;i++){
    const phase=2*Math.PI*frequency*i/sampleRate;
    real+=samples[i]*Math.cos(phase);imaginary+=samples[i]*Math.sin(phase);
  }
  return 2*Math.hypot(real,imaginary)/samples.length;
}

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
    const legacy=path.join(f.root,'legacy-conversion.ogg');
    ffmpeg(['-i',path.join(f.root,f.review.audio.find(e=>e.role==='successive').path),'-map','0:a:0','-vn','-sn','-dn','-map_metadata','-1',
      '-c:a','libvorbis','-q:a','5','-fflags','+bitexact','-flags:a','+bitexact',legacy]);
    assert.equal(digest(ogg),digest(legacy),'unexcerpted conversion retains the original byte output');
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

test('reviewed excerpts trim exact samples and apply only fixed reviewed gain and tail fade', {skip:!toolsAvailable},()=>{
  const f=fixture();
  try{
    const {entry,filename,sampleRate,toneSamples}=timingSource(f),originalHash=digest(filename);
    f.review.fire.push({...entry,weapon:'phantom',excerpt:{...entry.excerpt,gainDb:-6,fadeOutSeconds:.05}});
    fs.writeFileSync(path.join(f.root,'skin-packs/asset-review.json'),JSON.stringify(f.review));
    const manifest=buildSkinPacks(f),theme=manifest.collections[0].themes[0];
    const baseline=path.join(f.destination,theme.fire.vandal.slice('/skin-packs/'.length));
    const adjusted=path.join(f.destination,theme.fire.phantom.slice('/skin-packs/'.length));
    const probe=spawnSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=duration_ts,time_base','-of','json',baseline],{encoding:'utf8'});
    assert.equal(probe.status,0,probe.stderr);
    const stream=JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.time_base,'1/'+sampleRate);
    assert.equal(stream.duration_ts,toneSamples,'container duration matches the reviewed sample boundaries');
    const samples=audioSamples(baseline),processed=audioSamples(adjusted);
    assert.ok(Math.abs(samples.length-toneSamples)<=128,'decoded Vorbis padding is bounded by one short block');
    assert.equal(processed.length,samples.length);
    assert.ok(rms(samples.slice(0,480))>.2,'leading silence is removed');
    assert.ok(rms(samples.slice(-480))>.2,'the excerpt contains the selected tone through its tail');
    assert.ok(toneAmplitude(samples,440,sampleRate)>.37,'the selected event is preserved');
    assert.ok(toneAmplitude(samples,1760,sampleRate)<.01,'the following event is excluded');
    const gainRatio=rms(processed.slice(2400,7200))/rms(samples.slice(2400,7200));
    assert.ok(Math.abs(gainRatio-Math.pow(10,-6/20))<.015,'gain is the reviewed fixed decibel adjustment');
    assert.ok(rms(processed.slice(-240))<.02,'the reviewed fade removes the tail edge');
    assert.equal(digest(filename),originalHash,'reviewed original bytes are retained');
    const before=treeHashes(f.destination);
    buildSkinPacks(f);
    assert.deepEqual(treeHashes(f.destination),before);
    fs.unlinkSync(filename);
    const missing=buildSkinPacks(f).collections[0].themes[0];
    assert.equal(missing.fire.vandal,null);
    assert.equal(missing.fire.phantom,null);
    assert.ok(!fs.existsSync(baseline));
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});

test('invalid reviewed excerpts fail before previous output is cleared',()=>{
  const f=fixture();
  try{
    const clip=f.review.audio.find(e=>e.id==='1');
    const entry={collection:clip.collection,theme:clip.theme,weapon:'vandal',path:clip.path,sha256:clip.sha256};
    fs.mkdirSync(f.destination,{recursive:true});
    fs.writeFileSync(path.join(f.destination,'previous-build'),'preserve');
    const invalid=[null,[],{},
      {startSeconds:-.01,endSeconds:1},{startSeconds:'0',endSeconds:1},
      {startSeconds:0,endSeconds:null},{startSeconds:1,endSeconds:1},{startSeconds:1,endSeconds:0},
      {startSeconds:0,endSeconds:5.001},{startSeconds:0,endSeconds:1,gainDb:null},
      {startSeconds:0,endSeconds:1,gainDb:-18.001},{startSeconds:0,endSeconds:1,gainDb:18.001},
      {startSeconds:0,endSeconds:1,fadeOutSeconds:null},{startSeconds:0,endSeconds:1,fadeOutSeconds:-.001},
      {startSeconds:0,endSeconds:1,fadeOutSeconds:.201},{startSeconds:0,endSeconds:.05,fadeOutSeconds:.051},
      {startSeconds:0,endSeconds:1,fadeInSeconds:.1}];
    for(const excerpt of invalid){
      f.review.fire=[{...entry,excerpt}];
      fs.writeFileSync(path.join(f.root,'skin-packs/asset-review.json'),JSON.stringify(f.review));
      assert.throws(()=>buildSkinPacks(f),/Invalid reviewed audio excerpt/,JSON.stringify(excerpt));
      assert.equal(fs.readFileSync(path.join(f.destination,'previous-build'),'utf8'),'preserve');
    }
    for(const field of ['startSeconds','endSeconds','gainDb','fadeOutSeconds']){
      f.review.fire=[{...entry,excerpt:{startSeconds:0,endSeconds:1,[field]:'nonfinite'}}];
      fs.writeFileSync(path.join(f.root,'skin-packs/asset-review.json'),JSON.stringify(f.review).replace('"nonfinite"','1e400'));
      assert.throws(()=>buildSkinPacks(f),/Invalid reviewed audio excerpt/,'nonfinite '+field);
      assert.equal(fs.readFileSync(path.join(f.destination,'previous-build'),'utf8'),'preserve');
    }
    f.review.fire=[];f.review.banners[0].excerpt={startSeconds:0,endSeconds:1};
    fs.writeFileSync(path.join(f.root,'skin-packs/asset-review.json'),JSON.stringify(f.review));
    assert.throws(()=>buildSkinPacks(f),/banners cannot have audio excerpts/);
    assert.equal(fs.readFileSync(path.join(f.destination,'previous-build'),'utf8'),'preserve');
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
