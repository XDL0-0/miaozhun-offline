// Read only public ishoutu.cn resources; never copy cookies, credentials or unrelated cache entries.
// Format: Chromium net/disk_cache/blockfile/{disk_format.h,addr.h}.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root='C:/Users/17373/AppData/Local/Microsoft/Edge/User Data/Default/Cache/Cache_Data';
const dest='G:/TOOLS/AimOffline/site';
const blocks=new Map();
function readAddr(addr,size){
 if(!addr||size<=0||size>500_000_000)return Buffer.alloc(0);
 const type=(addr>>>28)&7;
 if(type===0)return fs.readFileSync(path.join(root,'f_'+(addr&0x0fffffff).toString(16).padStart(6,'0'))).subarray(0,size);
 const num=(addr>>>16)&255,blockSize=[0,36,256,1024,4096,8,104,48][type];
 if(!blocks.has(num))blocks.set(num,fs.readFileSync(path.join(root,'data_'+num)));
 const buf=blocks.get(num),offset=8192+(addr&65535)*blockSize;
 return buf.subarray(offset,offset+size);
}
const entries=[];
for(const name of fs.readdirSync(root).filter(n=>/^data_\d+$/.test(n))){
 const buf=fs.readFileSync(path.join(root,name));
 if(buf.length<8192)continue;
 // EntryStore lives in 256-byte blocks, not response-body files.
 if(buf.readUInt32LE(12)!==256)continue;
 for(let off=8192;off+256<=buf.length;off+=256){
  const len=buf.readInt32LE(off+32),state=buf.readInt32LE(off+20);
  if(len<=0||len>8192||state!==0)continue;
  let key;
  try{const long=buf.readUInt32LE(off+36);key=(long?readAddr(long,len):buf.subarray(off+96,off+96+len)).toString('utf8');}catch{continue}
  const urls=key.match(/https:\/\/(?:static\.)?ishoutu\.cn\/[^\x00-\x20]+/g);if(!urls)continue;
  const url=urls.at(-1); let u;try{u=new URL(url)}catch{continue}
  if(!['ishoutu.cn','static.ishoutu.cn'].includes(u.hostname))continue;
  if(u.pathname.startsWith('/prod-api/')&&!u.pathname.includes('/public/'))continue;
  const size=buf.readInt32LE(off+44),addr=buf.readUInt32LE(off+60);
  if(size<=0||!addr)continue;
  try{
   const headers=readAddr(buf.readUInt32LE(off+56),buf.readInt32LE(off+40)).toString('latin1');
   const status=headers.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1];
   if(status!=='200')continue;
   const type=headers.match(/content-type:\s*([^\x00\r\n]+)/i)?.[1]??'';
   const encoding=headers.match(/content-encoding:\s*([^\x00\r\n]+)/i)?.[1]?.trim();
   let body=readAddr(addr,size);
   try{if(encoding==='gzip')body=zlib.gunzipSync(body);else if(encoding==='br')body=zlib.brotliDecompressSync(body);else if(encoding==='deflate')body=zlib.inflateSync(body)}catch{}
   const rel=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html';
   if(rel.split('/').includes('..'))continue;
   const file=path.join(dest,rel);
   const creation=buf.readBigUInt64LE(off+24).toString();
   entries.push({url:u.origin+u.pathname,query:!!u.search,type,bytes:body.length,creation,file,body});
  }catch{}
 }
}
entries.sort((a,b)=>BigInt(a.creation)<BigInt(b.creation)?-1:1);
const written=new Map();for(const e of entries){fs.mkdirSync(path.dirname(e.file),{recursive:true});fs.writeFileSync(e.file,e.body);const {body,...meta}=e;written.set(e.url,meta)}
fs.writeFileSync('G:/TOOLS/AimOffline/site-cache-manifest.json',JSON.stringify([...written.values()],null,2));
console.log(JSON.stringify({count:written.size,totalBytes:[...written.values()].reduce((s,e)=>s+e.bytes,0),scenes:[...written.values()].filter(e=>e.url.includes('/aimlab/scenes/')).length,maps:[...written.values()].filter(e=>/\/aim-maps\/[^/]+\.glb\.enc$/.test(e.url)).map(e=>({url:e.url,bytes:e.bytes}))},null,2));
