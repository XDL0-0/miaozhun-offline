import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {catalog,requiredFiles,auditPack,scaffold,stage,validateCatalog} from '../scripts/skin-packs.mjs';

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
test('ORA includes its five separate themes and four gun categories',()=>{
  const ora=catalog.collections.find(c=>c.id==='ora-by-onetap');
  assert.equal(ora.tier,'Ultra');
  assert.deepEqual(ora.themes,['base','watch','renegade','raja','ignition']);
  assert.deepEqual(ora.weapons,['vandal','phantom','sheriff','operator']);
  assert.equal(requiredFiles(ora).length,4+5*11);
});
test('staging skips incomplete packs and copies only complete permitted local assets',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aim-skin-'));
  try{
    const source=path.join(tmp,'local'),dest=path.join(tmp,'dist');
    scaffold(source);
    const first=catalog.collections[0];
    assert.ok(auditPack(first,source).missing.length>0);
    const files=requiredFiles(first);
    for(const relative of files){
      const filename=path.join(source,first.id,relative);
      fs.mkdirSync(path.dirname(filename),{recursive:true});
      fs.writeFileSync(filename,relative.endsWith('.ogg')?'OggS data': 'PNG data');
    }
    const results=stage(source,dest);
    assert.equal(results.find(x=>x.id===first.id).installed,true);
    assert.ok(results.filter(x=>x.installed).length===1);
    assert.ok(fs.existsSync(path.join(dest,first.id,files[0])));
    assert.ok(!fs.existsSync(path.join(dest,'ora-by-onetap','themes','base','kill-1.ogg')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'index.json'),'utf8')).collections.length,catalog.collections.length);
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
