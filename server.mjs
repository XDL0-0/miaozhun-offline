import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const port=18746,host='127.0.0.1';
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.enc':'application/octet-stream','.wasm':'application/wasm','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.ogg':'audio/ogg','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.bin':'application/octet-stream'};
mime['.mjs']='application/javascript; charset=utf-8';
const csp="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
let missing=new Map();
const ok=data=>({code:'00000',data,msg:'本地离线数据'});
function json(res,data,status=200){let b=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(b)}
function serve(req,res,file,asJson=false){
 const stat=fs.statSync(file),ext=path.extname(file).toLowerCase();
 const headers={'Content-Type':asJson?'application/json; charset=utf-8':mime[ext]??'application/octet-stream','Cache-Control':'no-cache','Content-Length':stat.size};
 const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 if(range){let start=Number(range[1]),end=range[2]?Number(range[2]):stat.size-1;if(start>=stat.size||end<start){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return}end=Math.min(end,stat.size-1);Object.assign(headers,{'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Accept-Ranges':'bytes'});res.writeHead(206,headers);fs.createReadStream(file,{start,end}).pipe(res);return}
 res.writeHead(200,headers);if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',csp);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const requestHost=req.headers.host??'';
 if(![`${host}:${port}`,`localhost:${port}`].includes(requestHost)){res.writeHead(403);res.end();return}
 let u;try{u=new URL(req.url,`http://${host}:${port}`)}catch{res.writeHead(400);res.end();return}
 let urlPath;try{urlPath=decodeURIComponent(u.pathname)}catch{res.writeHead(400);res.end();return}
 if(urlPath==='/__offline/health'){json(res,{app:'aim-offline',ready:fs.existsSync(path.join(root,'index.html'))});return}
 if(urlPath==='/__offline/diagnostics'){json(res,{app:'aim-offline',missing:[...missing].map(([url,count])=>({url,count}))});return}
 if(urlPath==='/__offline/client-error'&&req.method==='POST'){req.resume();json(res,ok(null));return}
 if(urlPath==='/__offline/clear-diagnostics'&&req.method==='POST'){missing.clear();req.resume();json(res,ok(null));return}
 if(!['GET','HEAD'].includes(req.method)){
  req.resume();
  if(urlPath.includes('/plays/')||urlPath.includes('/seen')||urlPath.includes('/error-reports')){json(res,ok(null));return}
  json(res,{code:'OFFLINE_ONLY',data:null,msg:'离线版只在本机保存成绩，不支持账号、排行榜或上传分享。'});return;
 }
 if(urlPath==='/'||urlPath==='/aim'||urlPath.startsWith('/aim/')||urlPath==='/index.html'){serve(req,res,path.join(root,'index.html'));return}
 const file=path.resolve(root,'.'+urlPath);
 if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return}
 if(fs.existsSync(file)&&fs.statSync(file).isFile()){serve(req,res,file,urlPath.startsWith('/prod-api/'));return}
 if(urlPath.startsWith('/prod-api/')){
  if(urlPath.endsWith('/leaderboard')){json(res,ok({list:[],records:[],total:0}));return}
  if(urlPath.endsWith('/drill-plays')||urlPath.endsWith('/drill-averages')){json(res,ok({}));return}
  if(urlPath.endsWith('/bulletin')){json(res,ok(null));return}
  if(urlPath.includes('/scenes/')){json(res,{code:'OFFLINE_MISSING',msg:'这个场景尚未保存在本机。',data:null});return}
  json(res,ok([]));return;
 }
 missing.set(urlPath,(missing.get(urlPath)||0)+1);res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('资源未保存在本机：'+urlPath);
});
server.on('error',err=>{if(err.code==='EADDRINUSE')process.exit(0);console.error(err);process.exit(1)});
server.listen(port,host,()=>console.log(`aim-offline ready: http://${host}:${port}/aim`));
