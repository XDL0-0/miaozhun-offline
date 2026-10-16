import http from 'node:http';
import fs from 'node:fs';
const base='G:/TOOLS/AimOffline';
http.createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:18748'){res.writeHead(403);res.end();return}
 if(req.url==='/queue'){res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(base+'/asset-queue.json'));return}
 if(req.url==='/result'&&req.method==='POST'){const data=[];for await(const x of req)data.push(x);fs.writeFileSync(base+'/prefetch-result.json',Buffer.concat(data));res.end('ok');return}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><title>公开素材预载</title><style>body{font:17px system-ui;margin:40px;background:#15191e;color:#ddd}button{padding:14px}pre{white-space:pre-wrap}</style><h1>公开素材预载</h1><p>通过当前浏览器网络加载游戏公开资源，随后保存到离线目录。</p><button id="start">预载清单素材</button><p id="status">等待开始</p><progress id="progress"></progress><pre id="errors"></pre><script>
const start=document.querySelector('#start'),status=document.querySelector('#status'),progress=document.querySelector('#progress'),err=document.querySelector('#errors');
start.onclick=async()=>{start.disabled=true;let queue=await(await fetch('/queue')).json(),next=0,done=0,failed=0,errors=[];progress.max=queue.length;async function worker(){while(next<queue.length){let url=queue[next++];try{await fetch(url,{mode:'no-cors',credentials:'omit',cache:'reload',referrerPolicy:'no-referrer'});}catch(e){failed++;errors.push({url,error:e.message})}done++;status.textContent='已加载 '+done+' / '+queue.length+'，网络失败 '+failed;progress.value=done;err.textContent=errors.slice(-10).map(x=>x.url+' '+x.error).join('\\n');}}await Promise.all(Array.from({length:3},worker));await fetch('/result',{method:'POST',body:JSON.stringify({total:queue.length,done,failed,errors})});start.disabled=false;status.textContent='预载完成 '+done+' / '+queue.length+'，网络失败 '+failed;};
</script>`);
}).listen(18748,'127.0.0.1',()=>console.log('http://127.0.0.1:18748'));
