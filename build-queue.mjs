import fs from 'node:fs';
const root='G:/TOOLS/AimOffline';
let candidates=JSON.parse(fs.readFileSync(root+'/material-candidates.json'));
if(fs.existsSync(root+'/module-candidates.json'))candidates.push(...JSON.parse(fs.readFileSync(root+'/module-candidates.json')));
if(fs.existsSync(root+'/font-candidates.json'))candidates.push(...JSON.parse(fs.readFileSync(root+'/font-candidates.json')));
const paths=[...new Set(candidates.map(x=>'/'+x.path.replace(/^\/+/,'' )).filter(p=>!fs.existsSync(root+'/site'+p)))];
const limit=Number(process.argv[2])||paths.length;
fs.writeFileSync(root+'/asset-queue.json',JSON.stringify(paths.slice(0,limit).map(p=>'https://ishoutu.cn'+p),null,2));
console.log({queued:Math.min(paths.length,limit),missing:paths.length});
