// Capture public, referenced client dependencies for the retained 2026-11-05 build.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import acorn from './vendor/acorn.cjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=path.join(project,'upstream/aimpro-2026-11-05');
const root=path.join(snapshot,'client');
const origin='https://aimpro.world';
const revisions=JSON.parse(await fs.readFile(path.join(snapshot,'asset-revisions.json'),'utf8'));
await fs.mkdir(root,{recursive:true});
await fs.cp(path.join(snapshot,'source/js'),path.join(root,'js'),{recursive:true});
await fs.cp(path.join(snapshot,'assets'),root,{recursive:true});
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const pending=[],queued=new Set(),done=new Set(),assets=[],failures=[],excluded=[];
const extensions=/\.(?:js|css|png|jpg|jpeg|webp|avif|gif|svg|woff2?|ttf|ogg|mp3|wav|wasm|bin|glb|json|enc|ico|webmanifest)$/i;
function enqueue(input,from='/'){
  if(typeof input!=='string'||input.startsWith('data:')||input.startsWith('blob:')||input.includes('${'))return;
  let url;try{url=new URL(input,origin+from);}catch{return;}
  if(![origin,'https://static.ishoutu.cn','https://ishoutu.cn'].includes(url.origin))return;
  let pathname=url.pathname;
  if(pathname==='/images/default-avatar.svg'){excluded.push({path:pathname,from,reason:'Non-aim account-management fallback; absent at public origin'});return;}
  if(!extensions.test(pathname)||pathname.includes('..')||pathname.startsWith('/prod-api/'))return;
  if(revisions[pathname])pathname+='.'+revisions[pathname]+'.enc';

  if(!queued.has(pathname)){queued.add(pathname);pending.push({path:pathname,from});}
}
function inspect(text,url){
  if(url==='/aim-kernels/manifest.json'){
    for(const entry of JSON.parse(text).kernels??[])if(/^kernel-aimlab-\d+-[0-9a-f]{12}\.js$/.test(entry.file))enqueue('/aim-kernels/'+entry.file,url);
  }else if(url.endsWith('.css')){
    for(const match of text.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)|@import\s*["']([^"']+)["']/g))enqueue(match[1]??match[2],url);
  }else if(url.endsWith('.js')){
    const ast=acorn.parse(text,{ecmaVersion:'latest',sourceType:'module'});
    const entry=url.includes('/index.FoQE3geO.js');
    function walk(node){
      if(!node||typeof node!=='object')return;
      if(node.type==='ImportDeclaration'||node.type==='ImportExpression')enqueue(node.source.value,url);
      if(node.type==='Literal'&&typeof node.value==='string'&&(/^(?:\/|https?:\/\/)/.test(node.value)))enqueue(node.value,url);
      for(const value of Object.values(node))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(walk);else walk(value);}
    }
    walk(ast);
  }
}
for(const logical of Object.keys(revisions))enqueue(logical);
for(const file of await fs.readdir(path.join(root,'js')))enqueue('/js/'+file);
for(const map of ['ascent','bonsai','triad','plummet','jam','infinity','rook','duality','juliett'])for(const ext of ['json','png'])enqueue(`/aim-maps/${map}.minimap.${ext}`);
const html=await fs.readFile(path.join(snapshot,'source/index.html'),'utf8');
for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g))enqueue(m[1]);
// Explicit filenames requested by the retained KTX2 loader at its /basis/ path.
enqueue('/aim-kernels/manifest.json');
for(const map of ['ascent','split','haven','summit','lotus','abyss','corrode','bind','sunset'])for(const dir of ['map-covers','map-slices'])enqueue('/images/'+dir+'/'+map+'.webp');
enqueue('/images/map-splash/ascent.webp');
const agents=new Set(Object.keys(revisions).filter(p=>p.startsWith('/aim-agents/')&&p.endsWith('.bin')).map(p=>p.split('/').at(-1).split('.')[0]));
// Phoenix uses a built-in model, so its UI portraits have no revision-table
// agent binary from which to infer the name.
agents.add('phoenix');
for(const agent of agents)for(const dir of ['agent-art','agent-portraits'])enqueue('/images/'+dir+'/'+(dir==='agent-art'&&agent==='kayo'?'kay-o':agent)+'.webp');
enqueue('/basis/basis_transcoder.js');enqueue('/basis/basis_transcoder.wasm');
while(pending.length){
  const batch=pending.splice(0,4);
  await Promise.all(batch.map(async item=>{
    const file=path.join(root,item.path);let bytes,headers;
    try{
      try{bytes=await fs.readFile(file);}catch{}
      if(!bytes){
        let error;
        for(let attempt=0;attempt<3;attempt++)try{
          const response=await fetch(origin+item.path,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(90000)});
          if(!response.ok){const e=new Error('HTTP '+response.status);e.noRetry=[401,403,404,429].includes(response.status);throw e;}
          bytes=Buffer.from(await response.arrayBuffer());headers={contentType:response.headers.get('content-type'),etag:response.headers.get('etag')};
          if(!bytes.length||headers.contentType?.includes('text/html')||/^\s*<!doctype/i.test(bytes.subarray(0,100).toString()))throw Error('Invalid asset response');
          await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);error=null;break;
        }catch(e){error=e;if(e.noRetry)break;}
        if(error)throw error;
      }
      if(item.path.endsWith('.js')||item.path.endsWith('.css')||item.path==='/aim-kernels/manifest.json')inspect(bytes.toString('utf8'),item.path);
      done.add(item.path);assets.push({...item,url:origin+item.path,bytes:bytes.length,sha256:digest(bytes),...headers});
    }catch(error){failures.push({...item,error:error.message});}
  }));
  if(done.size%40<4)console.log(`Captured ${done.size}; queued ${pending.length}; failures ${failures.length}`);
}
assets.sort((a,b)=>a.path.localeCompare(b.path));
const report={origin,capturedAt:new Date().toISOString(),assets,failures,excluded,totalBytes:assets.reduce((sum,x)=>sum+x.bytes,0)};
await fs.writeFile(path.join(snapshot,'client-downloads.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({assets:assets.length,bytes:report.totalBytes,failures},null,2));
if(failures.length)process.exitCode=1;
