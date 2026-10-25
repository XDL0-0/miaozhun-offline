// Rebuild the twelve reviewed static Champions2026 kill states using retained local source PNGs.
// This tool performs no downloads and is not required at runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const ff=process.env.FFMPEG_PATH??'ffmpeg',cache=new Map();
const audit=JSON.parse(fs.readFileSync('skin-packs/audit/champions-banner-recipes.json','utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function readImage(f){if(cache.has(f))return cache.get(f);let png=fs.readFileSync(f),w=png.readUInt32BE(16),h=png.readUInt32BE(20);let r=spawnSync(ff,['-nostdin','-v','error','-i',f,'-f','rawvideo','-pix_fmt','rgba','pipe:1'],{maxBuffer:3000000});if(r.status)throw Error(r.stderr.toString());let obj={w,h,pixels:r.stdout};cache.set(f,obj);return obj;}
function draw(out,l){let img=readImage(l.png),sx=l.transform?.Scale?.X??1,sy=l.transform?.Scale?.Y??1;if(!sx||!sy||!l.tint.A)return;let tx=l.transform?.Translation?.X??0,ty=l.transform?.Translation?.Y??0;let off=l.offset??{},x0=192-img.w*sx/2+(off.Left??0)+tx,y0=192-img.h*sy/2+(off.Top??0)+ty;let tint=[l.tint.R,l.tint.G,l.tint.B].map(v=>v<=.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-.055);for(let y=Math.max(0,Math.floor(y0));y<Math.min(384,Math.ceil(y0+img.h*sy));y++)for(let x=Math.max(0,Math.floor(x0));x<Math.min(384,Math.ceil(x0+img.w*sx));x++){let u=Math.min(img.w-1,Math.max(0,(x+.5-x0)/sx-.5)),v=Math.min(img.h-1,Math.max(0,(y+.5-y0)/sy-.5));let ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;let rgba=[0,0,0,0];for(let [px,py,weight] of [[ix,iy,(1-fx)*(1-fy)],[Math.min(ix+1,img.w-1),iy,fx*(1-fy)],[ix,Math.min(iy+1,img.h-1),(1-fx)*fy],[Math.min(ix+1,img.w-1),Math.min(iy+1,img.h-1),fx*fy]]){let p=(py*img.w+px)*4,alpha=img.pixels[p+3]/255;rgba[3]+=alpha*weight;for(let c=0;c<3;c++)rgba[c]+=img.pixels[p+c]/255*alpha*weight;}
 let alpha=rgba[3]*l.tint.A,p=(y*384+x)*4;for(let c=0;c<3;c++)out[p+c]=rgba[c]*l.tint.A*tint[c]+out[p+c]*(1-alpha);out[p+3]=alpha+out[p+3]*(1-alpha);}}

for(const frame of audit.frames){
 if(!/^skin-packs\/media\/champions-2026\/banners\/(attacking|defending)\/kill-[1-6]\.png$/.test(frame.path))throw Error('Unsafe output path');
 const out=new Float32Array(384*384*4);
 for(const source of frame.layers){
  if(!/^skin-packs\/media\/champions-2026\/banner-sources\/[a-zA-Z0-9_/-]+\.png$/.test(source.path)||hash(source.path)!==source.sha256)throw Error('Unreviewed source PNG');
  draw(out,{...source,png:source.path});
 }
 const rgba=Buffer.alloc(out.length);
 for(let i=0;i<out.length;i+=4){const a=out[i+3];for(let c=0;c<3;c++)rgba[i+c]=a>0?Math.round(Math.min(1,out[i+c]/a)*255):0;rgba[i+3]=Math.round(Math.min(1,a)*255);}
 const result=spawnSync(ff,['-nostdin','-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s','384x384','-i','pipe:0','-frames:v','1','-c:v','png','-threads','1',frame.path],{input:rgba});
 if(result.error)throw result.error;if(result.status)throw Error(result.stderr.toString());
 if(hash(frame.path)!==frame.sha256)throw Error('Frame encoding differs from reviewed output: '+frame.path);
}
console.log('Rebuilt all12Champions2026bannerframes from retained local source PNGs');
