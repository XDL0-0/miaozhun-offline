import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root='G:/TOOLS/AimOffline',queueFile=root+'/asset-queue.json';
const page=`<!doctype html><meta charset="utf-8"><title>离线素材补齐</title><style>body{font:16px system-ui;background:#101419;color:#ddd;margin:40px}button{padding:12px 24px;background:#63e1a7;border:0;border-radius:6px;cursor:pointer}pre{white-space:pre-wrap;line-height:1.6}progress{width:600px}</style><h1>瞄准专家 · 离线素材补齐</h1><p>将清单内的公开训练素材保存到本机，不上传账号或个人数据。</p><button id="start">开始补齐素材</button><p id="status">等待开始</p><progress id="progress" value="0" max="1"></progress><pre id="log"></pre><script>
const start=document.getElementById('start'),status=document.getElementById('status'),progress=document.getElementById('progress'),log=document.getElementById('log');
start.onclick=async()=>{start.disabled=true;let q=await(await fetch('/queue')).json(),next=0,done=0,failed=0;progress.max=q.length;const errors=[];async function worker(){while(next<q.length){const asset=q[next++];try{const r=await fetch(asset,{credentials:'omit',referrerPolicy:'no-referrer',cache:'default'});if(!r.ok)throw new Error('HTTP '+r.status);let type=r.headers.get('content-type')||'application/octet-stream';if(type.includes('text/html')&&!asset.endsWith('.html'))throw new Error('返回了错误页面');const data=await r.arrayBuffer();const saved=await fetch('/save?url='+encodeURIComponent(asset),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Asset-Type':type},body:data});if(!saved.ok)throw new Error('本地保存失败');}catch(e){failed++;errors.push({url:asset,error:e.message});}done++;progress.value=done;status.textContent='已处理 '+done+' / '+q.length+'，失败 '+failed;log.textContent=errors.slice(-12).map(e=>e.url+' — '+e.error).join('\\n');}}await Promise.all(Array.from({length:4},worker));await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({total:q.length,done,failed,errors})});status.textContent='完成：'+done+' / '+q.length+'，失败 '+failed;start.disabled=false;};
</script>`;
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1:18747');
 if(req.headers.host!=='127.0.0.1:18747'){res.writeHead(403);res.end();return}
 const queue=fs.existsSync(queueFile)?JSON.parse(fs.readFileSync(queueFile,'utf8')):[];
 if(u.pathname==='/queue'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(queue));return}
 if(u.pathname==='/save'&&req.method==='POST'){
  const original=u.searchParams.get('url');if(!queue.includes(original)){res.writeHead(403);res.end();return}
  const asset=new URL(original),file=path.resolve(root+'/site','.'+decodeURIComponent(asset.pathname));
  if(!file.startsWith(path.resolve(root+'/site')+path.sep)){res.writeHead(403);res.end();return}
  const chunks=[];let total=0;try{for await(const chunk of req){total+=chunk.length;if(total>200000000)throw new Error('too large');chunks.push(chunk)}fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.concat(chunks));res.end('saved')}catch(e){res.writeHead(500);res.end('failed')}return;
 }
 if(u.pathname==='/result'&&req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);fs.writeFileSync(root+'/acquisition-result.json',Buffer.concat(chunks));res.end('ok');return}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page+'<h2>公开文件链接</h2>'+queue.map((x,i)=>'<p><a href="'+x+'" download>'+i+' '+x+'</a></p>').join(''));
}).listen(18747,'127.0.0.1',()=>console.log('素材获取页面：http://127.0.0.1:18747'));
