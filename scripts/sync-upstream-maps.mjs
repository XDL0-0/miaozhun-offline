// Archive only publicly referenced map resources. Does not modify site/ or dist/.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  if(arg==='--offline')return ['offline',true];
  if(arg==='--refresh-minimaps')return ['refresh-minimaps',true];
  const at=arg.indexOf('=');
  if(!arg.startsWith('--')||at<0)throw new Error('Use --name=value arguments');
  const name=arg.slice(2,at);
  if(!['output','revisions'].includes(name))throw new Error('Unknown argument: '+name);
  return [name,arg.slice(at+1)];
}));
if(args.offline&&args['refresh-minimaps'])throw new Error('--offline and --refresh-minimaps cannot be combined');
const output=path.resolve(project,args.output??'upstream/aimpro-2026-11-05');
const revisionsFile=path.resolve(project,args.revisions??'upstream/aimpro-2026-11-05/asset-revisions.json');
const origin='https://aimpro.world';
const revisions=JSON.parse(await fs.readFile(revisionsFile,'utf8'));
const entries=Object.entries(revisions).filter(([url])=>url.startsWith('/aim-maps/'));
if(!entries.length)throw new Error('No maps in revision manifest');
const maps=[...new Set(entries.map(([url])=>url.match(/^\/aim-maps\/([a-z]+)\./)?.[1]))].sort();
if(maps.includes(undefined))throw new Error('Invalid map path');
const queue=entries.map(([logicalPath,revision])=>{
  if(!/^\/aim-maps\/[a-z]+\.[a-z0-9.]+$/.test(logicalPath)||!/^[a-f0-9]{12}$/.test(revision))throw new Error('Invalid asset revision');
  return {logicalPath,revision,path:`${logicalPath}.${revision}.enc`};
});
for(const map of maps)for(const ext of ['json','png'])queue.push({logicalPath:`/aim-maps/${map}.minimap.${ext}`,path:`/aim-maps/${map}.minimap.${ext}`});
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let previous;
try{previous=JSON.parse(await fs.readFile(path.join(output,'map-downloads.json'),'utf8'));}catch{}
const prior=new Map((previous?.assets??[]).map(row=>[row.path,row]));
const assets=[],failures=[];
await fs.mkdir(path.join(output,'assets','aim-maps'),{recursive:true});
let next=0;
async function worker(){
  while(next<queue.length){
    const asset=queue[next++],file=path.join(output,'assets',asset.path),url=origin+asset.path;
    try{
      const before=prior.get(asset.path);
      if(before&&(asset.revision||!args['refresh-minimaps'])){
        try{const bytes=await fs.readFile(file);if(digest(bytes)===before.sha256){assets.push(before);continue;}}catch{}
      }
      if(args.offline)throw new Error('Missing or altered local asset; offline mode cannot fetch');
      let response,bytes,error;
      for(let attempt=0;attempt<3;attempt++){
        try{
          response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(90000)});
          if(!response.ok){const e=new Error(`HTTP ${response.status}`);e.noRetry=[401,403,404,429].includes(response.status);throw e;}
          bytes=Buffer.from(await response.arrayBuffer());
          if(!bytes.length||response.headers.get('content-type')?.includes('text/html')||/^\s*</.test(bytes.subarray(0,60).toString()))throw new Error('Empty resource or HTML response');
          if(asset.path.endsWith('.json'))JSON.parse(bytes.toString('utf8'));
          error=null;break;
        }catch(e){error=e;if(e.noRetry)break;}
      }
      if(error)throw error;
      await fs.writeFile(file+'.partial',bytes);await fs.rename(file+'.partial',file);
      assets.push({...asset,url,bytes:bytes.length,sha256:digest(bytes),contentType:response.headers.get('content-type'),etag:response.headers.get('etag'),fetchedAt:new Date().toISOString()});
    }catch(error){failures.push({...asset,url,error:error.message});}
  }
}
await Promise.all(Array.from({length:4},worker));
assets.sort((a,b)=>a.path.localeCompare(b.path));
const baseline=path.join(project,'site/aim-maps');
const existingMaps=(await fs.readdir(baseline)).filter(x=>x.endsWith('.minimap.json')).map(x=>x.split('.')[0]);
const report={source:origin+'/aim',snapshot:'2026-11-05',scope:'All map assets referenced by the captured public client, plus its minimap metadata/images',maps,newMaps:maps.filter(x=>!existingMaps.includes(x)),expected:queue.length,succeeded:assets.length,totalBytes:assets.reduce((sum,x)=>sum+x.bytes,0),failures,assets};
await fs.writeFile(path.join(output,'map-downloads.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({maps,newMaps:report.newMaps,expected:queue.length,succeeded:assets.length,totalBytes:report.totalBytes,failures},null,2));
if(failures.length)process.exitCode=1;
