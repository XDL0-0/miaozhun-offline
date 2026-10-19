import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalogFile=path.join(projectRoot,'skin-packs','catalog.json');
export const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
export const localRoot=path.join(projectRoot,'skin-packs','local');
export const destinationRoot=path.join(projectRoot,'dist','skin-packs');

export function requiredFiles(collection){
  const result=[];
  for(const weapon of collection.weapons)result.push(`weapons/${weapon}/fire.ogg`);
  for(const theme of collection.themes){
    for(let n=1;n<=5;n++)result.push(`themes/${theme}/kill-${n}.ogg`);
    result.push(`themes/${theme}/successive.ogg`);
    for(const layer of ['emblem','frame','ring','pip','headshot'])result.push(`themes/${theme}/${layer}.png`);
  }
  return result;
}

export function auditPack(collection,sourceRoot=localRoot){
  const present=[],missing=[];
  for(const relative of requiredFiles(collection)){
    const file=path.join(sourceRoot,collection.id,...relative.split('/'));
    if(fs.existsSync(file)&&fs.statSync(file).isFile()&&fs.statSync(file).size>0)present.push(relative);
    else missing.push(relative);
  }
  return {id:collection.id,present:present.length,expected:present.length+missing.length,complete:missing.length===0,missing};
}

export function validateCatalog(){
  const ids=new Set();
  for(const collection of catalog.collections){
    if(!/^[a-z0-9-]+$/.test(collection.id)||ids.has(collection.id))throw new Error('Invalid/duplicate collection id: '+collection.id);
    ids.add(collection.id);
    if(!collection.weapons.length||!collection.themes.length)throw new Error('Empty weapon/theme list: '+collection.id);
    for(const part of [...collection.weapons,...collection.themes])if(!/^[a-z0-9-]+$/.test(part))throw new Error('Unsafe segment: '+part);
  }
  return true;
}

export function scaffold(root=localRoot){
  validateCatalog();
  for(const item of catalog.collections){
    const files=requiredFiles(item);
    for(const relative of files)fs.mkdirSync(path.join(root,item.id,path.dirname(relative)),{recursive:true});
    fs.writeFileSync(path.join(root,item.id,'REQUIRED_ASSETS.txt'),files.join('\n')+'\n');
  }
}

export function stage(sourceRoot=localRoot,destRoot=destinationRoot){
  validateCatalog();
  fs.mkdirSync(destRoot,{recursive:true});
  const results=[];
  for(const collection of catalog.collections){
    const check=auditPack(collection,sourceRoot);
    if(!check.complete){results.push({id:collection.id,installed:false,present:check.present,expected:check.expected});continue}
    // Copy only expected paths; never bring in arbitrary scripts or unreviewed files.
    const target=path.join(destRoot,collection.id);
    for(const relative of requiredFiles(collection)){
      const source=path.join(sourceRoot,collection.id,relative);
      const dest=path.join(target,relative);
      fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);
    }
    results.push({id:collection.id,installed:true,present:check.present,expected:check.expected});
  }
  fs.writeFileSync(path.join(destRoot,'index.json'),JSON.stringify({schemaVersion:1,collections:results},null,2)+'\n');
  return results;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const choice=process.argv[2]??'--audit';
  if(!['--scaffold','--audit','--stage'].includes(choice)){
    console.error('Usage: node scripts/skin-packs.mjs [--scaffold|--audit|--stage]');
    process.exitCode=2;
  }else{
    validateCatalog();
    if(choice==='--scaffold')scaffold();
    const checks=choice==='--stage'?stage():catalog.collections.map(item=>auditPack(item));
    console.log(JSON.stringify({action:choice,packs:checks},null,2));
  }
}
