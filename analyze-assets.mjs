import fs from 'node:fs';import path from 'node:path';
const root='G:/TOOLS/AimOffline/site';
let files=fs.readdirSync(root+'/js').filter(n=>n.endsWith('.js'));
const assets=new Set(),missing=new Set(),hints=[];
for(const name of files){const s=fs.readFileSync(root+'/js/'+name,'utf8');
 for(const m of s.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+\.js)["']/g)){let f=path.resolve(root+'/js',m[1]);if(!fs.existsSync(f))missing.add(path.basename(f));}
 for(const m of s.matchAll(/["'`]([^"'`\s]{0,180}(?:\.glb|\.gltf|\.ktx2|\.wasm|\.json|\.webp|\.zip|\.mp3|\.ogg|\.wav)[^"'`\s]{0,80})["'`]/g))assets.add(m[1]);
 if(/ascent.*(?:glb|ktx)|aim-maps|\/aimlab\/scenes/.test(s)){for(const term of ['aim-maps','ascent','glb','ktx2','/aimlab/scenes','https://']){let at=s.indexOf(term);if(at>=0)hints.push({file:name,term,context:s.slice(Math.max(0,at-140),at+300)});}}
}
console.log(JSON.stringify({missingImports:[...missing],assets:[...assets],hints},null,2));
