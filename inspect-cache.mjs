import fs from 'node:fs';
import path from 'node:path';
const root='C:/Users/17373/AppData/Local/Microsoft/Edge/User Data/Default/Cache/Cache_Data';
const found=[];
for(const name of fs.readdirSync(root)){
 const file=path.join(root,name);let fd;
 try{
  fd=fs.openSync(file,'r');const b=Buffer.alloc(2048);const n=fs.readSync(fd,b,0,b.length,0);const head=b.subarray(0,n);
  const text=head.toString('utf8');
  const m=text.match(/https:\/\/ishoutu\.cn\/[^\x00-\x20"<>]+/);
  if(m) found.push({file:name,size:fs.statSync(file).size,url:m[0].split('?')[0],hex:head.subarray(0,32).toString('hex')});
 }catch{}finally{if(fd!==undefined)fs.closeSync(fd)}
}
fs.writeFileSync('G:/TOOLS/AimOffline/cache-inventory.json',JSON.stringify(found,null,2));
console.log(JSON.stringify({count:found.length,files:found},null,2));
