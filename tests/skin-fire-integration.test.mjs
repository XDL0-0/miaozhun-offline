import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSkinPacks} from '../scripts/build-skin-packs.mjs';
import {createSkinPackRuntime} from '../patches/skin-packs-runtime.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const catalog=read(path.join(projectRoot,'skin-packs/catalog.json'));
const review=read(path.join(projectRoot,'skin-packs/asset-review.json'));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const key=entry=>[entry.collection,entry.theme,entry.weapon].join('/');
const toolsAvailable=spawnSync('ffmpeg',['-version']).status===0&&spawnSync('ffprobe',['-version']).status===0;

test('reviewed gunfire covers all 30 combinations with separate ORA theme windows',()=>{
  const expected=catalog.collections.flatMap(collection=>collection.themes.flatMap(theme=>collection.weapons.map(weapon=>
    [collection.id,theme,weapon].join('/'))));
  assert.equal(expected.length,30);
  assert.deepEqual(review.fire.map(key).sort(),expected.sort());
  assert.equal(new Set(review.fire.map(entry=>entry.path)).size,14,'ten ordinary and four ORA original soundtracks are retained');
  const hashes=new Map();
  for(const entry of review.fire){
    assert.equal(path.extname(entry.path),'.m4a','the review points to retained original audio, not a generated excerpt');
    if(!hashes.has(entry.path))hashes.set(entry.path,digest(fs.readFileSync(path.join(projectRoot,entry.path))));
    assert.equal(hashes.get(entry.path),entry.sha256,key(entry));
    const {startSeconds,endSeconds,fadeOutSeconds}=entry.excerpt;
    assert.ok(Number.isFinite(startSeconds)&&startSeconds>=0,key(entry));
    assert.ok(endSeconds>startSeconds&&endSeconds-startSeconds<=5,key(entry));
    assert.ok(fadeOutSeconds>=0&&fadeOutSeconds<=Math.min(.2,endSeconds-startSeconds),key(entry));
  }
  const ora=catalog.collections.find(collection=>collection.id==='ora-by-onetap');
  for(const weapon of ora.weapons){
    const entries=review.fire.filter(entry=>entry.collection===ora.id&&entry.weapon===weapon);
    assert.deepEqual(entries.map(entry=>entry.theme).sort(),[...ora.themes].sort());
    assert.equal(new Set(entries.map(entry=>entry.path)).size,1,'each ORA gun retains its original full soundtrack');
    assert.equal(new Set(entries.map(entry=>entry.excerpt.startSeconds+':'+entry.excerpt.endSeconds)).size,5,
      weapon+' must not substitute the Base excerpt for another theme');
  }
});

function decode(input,entry){
  const isBytes=Buffer.isBuffer(input),args=['-nostdin','-hide_banner','-loglevel','error','-i',isBytes?'pipe:0':input,
    '-map','0:a:0','-vn',...(entry?['-ss',String(entry.excerpt.startSeconds),'-t',String(entry.excerpt.endSeconds-entry.excerpt.startSeconds)]:[]),
    '-ac','1','-ar','48000','-c:a','pcm_f32le','-f','f32le','pipe:1'];
  const result=spawnSync('ffmpeg',args,{...(isBytes?{input}:{}),maxBuffer:4*1024*1024});
  assert.equal(result.status,0,result.stderr?.toString());
  return Float32Array.from({length:result.stdout.length/4},(_,i)=>result.stdout.readFloatLE(i*4));
}

function correlation(actual,original,count){
  let cross=0,actualEnergy=0,originalEnergy=0;
  for(let i=256;i<count;i++){
    cross+=actual[i]*original[i];actualEnergy+=actual[i]**2;originalEnergy+=original[i]**2;
  }
  assert.ok(actualEnergy>0&&originalEnergy>0,'a mapped gunfire excerpt contains audible samples');
  return cross/Math.sqrt(actualEnergy*originalEnergy);
}

test('actual gunfire outputs preserve the reviewed sound and play all 30 selections from decoded cache', {skip:!toolsAvailable},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aim-real-fire-')),destination=path.join(root,'dist/skin-packs');
  try{
    // Exercise the real builder and retained source bytes without rebuilding unrelated effects or shared dist.
    fs.mkdirSync(path.join(root,'skin-packs'),{recursive:true});
    fs.writeFileSync(path.join(root,'skin-packs/catalog.json'),JSON.stringify(catalog));
    fs.writeFileSync(path.join(root,'skin-packs/asset-review.json'),JSON.stringify({schemaVersion:1,audio:[],banners:[],fire:review.fire}));
    for(const source of new Set(review.fire.map(entry=>entry.path))){
      const target=path.join(root,source);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(projectRoot,source),target);
    }
    const manifest=buildSkinPacks({root,destination});
    assert.equal(manifest.schemaVersion,2);
    assert.equal(manifest.counts.fire,30);
    assert.equal(manifest.counts.missingFire,0);
    assert.equal(manifest.counts.audio,30);
    const urls=manifest.collections.flatMap(collection=>collection.themes.flatMap(theme=>Object.values(theme.fire)));
    assert.equal(new Set(urls).size,30,'every weapon and theme has its own runtime mapping');
    const fetched=new Map(),decoded=new Map(),sources=[],oraHashes=new Set();let decoderCreations=0;
    const runtime=createSkinPackRuntime({
      storage:{getItem:()=>null,setItem(){}},
      async fetcher(url){
        fetched.set(url,(fetched.get(url)??0)+1);
        if(url==='/skin-packs/index.json')return {ok:true,json:async()=>read(path.join(destination,'index.json'))};
        const bytes=fs.readFileSync(path.join(destination,url.slice('/skin-packs/'.length)));
        return {ok:true,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
      },
      makeDecoder(){decoderCreations++;return {async decodeAudioData(bytes){
        const input=Buffer.from(bytes),hash=digest(input),samples=decode(input);
        decoded.set(hash,(decoded.get(hash)??0)+1);
        return {hash,samples,duration:samples.length/48000};
      }}},
      makeImage(){assert.fail('the gunfire fixture has no banners')},
    });
    const context={state:'running',currentTime:12,
      createBufferSource(){const source={connect(){},disconnect(){},start(at){this.started=at}};sources.push(source);return source},
      createGain(){return {gain:{value:1},connect(){},disconnect(){}}}},master=context.createGain();
    assert.ok(await runtime.initialize());
    for(const entry of review.fire){
      const theme=manifest.collections.find(collection=>collection.id===entry.collection).themes.find(theme=>theme.id===entry.theme);
      const url=theme.fire[entry.weapon],filename=path.join(destination,url.slice('/skin-packs/'.length)),output=fs.readFileSync(filename);
      assert.equal(output.subarray(0,4).toString(),'OggS',key(entry));
      const probe=spawnSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=duration_ts,time_base','-of','json',filename],{encoding:'utf8'});
      assert.equal(probe.status,0,probe.stderr);
      const stream=JSON.parse(probe.stdout).streams[0],[numerator,denominator]=stream.time_base.split('/').map(Number);
      assert.ok(Math.abs(stream.duration_ts*numerator/denominator-(entry.excerpt.endSeconds-entry.excerpt.startSeconds))<=numerator/denominator,
        key(entry)+' has the reviewed container duration within one native sample');
      const hash=digest(output);
      if(entry.collection==='ora-by-onetap')oraHashes.add(hash);
      await runtime.select(entry.weapon,{collection:entry.collection,theme:entry.theme});
      assert.equal(runtime.availability(entry.weapon).fire,'ready',key(entry));
      const counts=[...fetched],decodes=[...decoded];
      for(let shot=0;shot<3;shot++){
        assert.equal(runtime.playFire(context,master,entry.weapon,15+shot*.1),true,key(entry));
        assert.equal(sources.at(-1).buffer.hash,hash,key(entry));
      }
      assert.deepEqual([...fetched],counts,'playback performs no fetch');
      assert.deepEqual([...decoded],decodes,'playback performs no decode');
      const actual=sources.at(-1).buffer.samples,original=decode(path.join(root,entry.path),entry);
      const sampleCount=Math.round((entry.excerpt.endSeconds-entry.excerpt.startSeconds)*48000);
      assert.ok(Math.abs(actual.length-sampleCount)<=1024,key(entry)+' has the reviewed duration within one Vorbis long block');
      const beforeFade=Math.floor((entry.excerpt.endSeconds-entry.excerpt.startSeconds-entry.excerpt.fadeOutSeconds)*48000)-256;
      const count=Math.min(beforeFade,actual.length,original.length);
      assert.ok(correlation(actual,original,count)>.98,key(entry)+' matches its reviewed source window before the tail fade');
    }
    assert.equal(oraHashes.size,20,'all ORA guns and themes produce distinct audio bytes');
    assert.equal(decoderCreations,1);
    assert.equal(fetched.size,31,'the manifest and 30 actual gunfire files were fetched');
    assert.ok([...fetched.values()].every(count=>count===1));
    assert.ok([...decoded.values()].every(count=>count===1));
    for(const entry of review.fire)await runtime.select(entry.weapon,{collection:entry.collection,theme:entry.theme});
    assert.ok([...fetched.values()].every(count=>count===1),'returning to an earlier skin retains decoded cache');
    assert.ok([...decoded.values()].every(count=>count===1),'returning to an earlier theme does not decode again');
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});
