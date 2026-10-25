// Read-only, deterministic audit of every source GLB referenced by the model
// catalogue. Run from the repository root with: node scripts/verify-weapon-tangents.mjs
// JSON is written only to stdout; redirect it to retain a reviewed audit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decodeWeaponGlb} from '../patches/weapon-models-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const local=url=>{
  if(!/^\/skin-packs\/models\/[a-z0-9/-]+\.(?:json|glb)$/.test(url))throw Error('Invalid local model path: '+url);
  return path.join(root,url.slice(1));
};
const readJSON=url=>JSON.parse(fs.readFileSync(local(url),'utf8'));
const attributeSpecs={position:['POSITION',3],normal:['NORMAL',3],uv:['TEXCOORD_0',2],uv1:['TEXCOORD_1',2],joint:['JOINTS_0',4],weight:['WEIGHTS_0',4]};
const componentTypes={5121:[Uint8Array,'getUint8',255],5123:[Uint16Array,'getUint16',65535],5125:[Uint32Array,'getUint32',4294967295],5126:[Float32Array,'getFloat32',1]};
const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};

// Parse source accessors independently of the runtime's tangent repair. In
// particular, recover the original index sequence and bone attributes before
// the renderer duplicates any vertex at a mirrored UV seam.
function sourceGLB(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<28||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length)throw Error('Invalid source GLB');
  let json,bin;
  for(let at=12;at<bytes.length;){
    const length=view.getUint32(at,true),type=view.getUint32(at+4,true);at+=8;
    if(at+length>bytes.length)throw Error('Truncated source GLB');
    if(type===0x4e4f534a)json=JSON.parse(bytes.subarray(at,at+length).toString('utf8').trim());
    else if(type===0x004e4942)bin=new DataView(bytes.buffer,bytes.byteOffset+at,length);
    at+=length;
  }
  if(!json||!bin)throw Error('Missing source GLB chunks');
  function accessor(index){
    const a=json.accessors[index],v=json.bufferViews[a?.bufferView],type=componentTypes[a?.componentType],size=sizes[a?.type];
    if(!a||!v||!type||!size||a.sparse||v.buffer!==0)throw Error('Unsupported source accessor');
    const [Type,method,maximum]=type,bytesPerValue=Type.BYTES_PER_ELEMENT,stride=v.byteStride??size*bytesPerValue,offset=(v.byteOffset??0)+(a.byteOffset??0);
    const end=offset+(a.count-1)*stride+size*bytesPerValue;
    if(stride<size*bytesPerValue||end>bin.byteLength||end>(v.byteOffset??0)+v.byteLength)throw Error('Invalid source accessor bounds');
    const values=new (a.normalized?Float32Array:Type)(a.count*size),divisor=a.normalized?maximum:1;
    for(let i=0;i<a.count;i++)for(let c=0;c<size;c++)values[i*size+c]=bin[method](offset+i*stride+c*bytesPerValue,true)/divisor;
    return values;
  }
  return {json,accessor,primitives:json.meshes.flatMap(mesh=>mesh.primitives)};
}

const report={
  schemaVersion:1,
  command:'node scripts/verify-weapon-tangents.mjs',
  status:'pass',
  inputs:{index:'/skin-packs/models/index.json',indexSha256:hash(fs.readFileSync(local('/skin-packs/models/index.json'))),runtime:'patches/weapon-models-runtime.mjs',runtimeSha256:hash(fs.readFileSync(path.join(root,'patches/weapon-models-runtime.mjs')))},
  checks:{sourceVertexAttributes:['position','normal','uv','uv1','joint','weight'],duplicateVertexAttributes:['position','normal','uv','uv1','joint','weight','tangent.xyz'],triangleOrderAndWinding:true,allCornerHandedness:true,uvDeterminantEpsilon:1e-12,orientationTolerance:1e-9},
  totals:{glbs:0,primitives:0,sourceVertices:0,decodedVertices:0,extraVertices:0,triangles:0,corners:0,signedCorners:0,ambiguousCorners:0,degenerateUVCorners:0,duplicateAttributeValuesChecked:0,failureCount:0},
  assets:[],failures:[]
};
function check(ok,context,message){
  if(ok)return;
  report.totals.failureCount++;report.status='fail';
  if(report.failures.length<100)report.failures.push({...context,message});
}

try{
  const index=readJSON(report.inputs.index),packages=[...new Set([...Object.values(index.models),...Object.values(index.variants).flatMap(Object.values)])].sort();
  const urls=[...new Set(packages.flatMap(url=>readJSON(url).parts.map(part=>part.url)))].sort();
  for(const url of urls){
    const bytes=fs.readFileSync(local(url)),source=sourceGLB(bytes),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),decoded=decodeWeaponGlb(buffer);
    const asset={url,sha256:hash(bytes),primitives:0,sourceVertices:0,decodedVertices:0,extraVertices:0,triangles:0,corners:0,signedCorners:0,ambiguousCorners:0,degenerateUVCorners:0,duplicateAttributeValuesChecked:0};
    check(source.primitives.length===decoded.primitives.length,{url},'Primitive count changed');
    for(let pi=0;pi<decoded.primitives.length;pi++){
      const p=decoded.primitives[pi],original=source.primitives[pi],context={url,primitive:pi},oldIndex=source.accessor(original.indices),originalCount=source.json.accessors[original.attributes.POSITION].count,count=p.position.length/3;
      const expected={};
      for(const [name,[semantic]]of Object.entries(attributeSpecs))if(original.attributes[semantic]!==undefined){
        const values=source.accessor(original.attributes[semantic]);
        if(name==='position'||name==='normal'){
          const transformed=new Float32Array(values.length),scale=name==='position'?100:1;
          for(let i=0;i<values.length;i+=3){transformed[i]=values[i]*scale;transformed[i+1]=-values[i+2]*scale;transformed[i+2]=values[i+1]*scale;}
          expected[name]=transformed;
        }else expected[name]=values;
      }
      check(count>=originalCount,context,'Original vertices removed');
      check(p.material===(original.material??0),context,'Triangle material changed');
      check(p.index.length===oldIndex.length&&p.index.length%3===0,context,'Triangle count changed');
      const originalOf=new Map();
      for(let k=0;k<p.index.length;k++){
        const v=p.index[k],old=oldIndex[k];
        check(Number.isInteger(v)&&v>=0&&v<count,{...context,corner:k},'Index outside decoded vertices');
        if(v<originalCount)check(v===old,{...context,corner:k},'Original triangle corner/order/winding changed');
        else if(originalOf.has(v))check(originalOf.get(v)===old,{...context,corner:k},'Duplicate combines different source vertices');
        else originalOf.set(v,old);
      }
      check(originalOf.size===count-originalCount,context,'Unreferenced duplicate vertices');
      for(const [name,[,size]]of Object.entries(attributeSpecs)){
        const values=p[name],before=expected[name];
        check(before?values?.length===count*size:!values,context,'Attribute count/presence changed: '+name);
        if(!values||!before)continue;
        for(let i=0;i<before.length;i++)check(values[i]===before[i],{...context,attribute:name,value:i},'Original vertex attribute changed');
        for(const [v,old]of originalOf)for(let c=0;c<size;c++){
          check(values[v*size+c]===before[old*size+c],{...context,attribute:name,vertex:v,sourceVertex:old,component:c},'Duplicate vertex attribute changed');
          asset.duplicateAttributeValuesChecked++;
        }
      }
      check(p.tangent?.length===count*4,context,'Missing or incomplete tangent frame');
      if(p.tangent){
        for(const [v,old]of originalOf)for(let c=0;c<3;c++){
          check(p.tangent[v*4+c]===p.tangent[old*4+c],{...context,vertex:v,sourceVertex:old,component:c},'Duplicate tangent direction changed');
          asset.duplicateAttributeValuesChecked++;
        }
        for(let k=0;k<p.index.length;k+=3){
          const [a,b,c]=p.index.subarray(k,k+3),du1=p.uv[b*2]-p.uv[a*2],dv1=p.uv[b*2+1]-p.uv[a*2+1],du2=p.uv[c*2]-p.uv[a*2],dv2=p.uv[c*2+1]-p.uv[a*2+1],det=du1*dv2-du2*dv1;
          const degenerate=Math.abs(det)<=report.checks.uvDeterminantEpsilon;
          const B=degenerate?[0,0,0]:[0,1,2].map(axis=>((p.position[c*3+axis]-p.position[a*3+axis])*du1-(p.position[b*3+axis]-p.position[a*3+axis])*du2)/det);
          for(let corner=0;corner<3;corner++){
            const v=p.index[k+corner],[nx,ny,nz]=p.normal.subarray(v*3,v*3+3),[tx,ty,tz,w]=p.tangent.subarray(v*4,v*4+4);
            check(Math.abs(w)===1&&[tx,ty,tz].every(Number.isFinite),{...context,corner:k+corner},'Nonfinite tangent or handedness outside +/-1');
            const orientation=((ny*tz-nz*ty)*B[0]+(nz*tx-nx*tz)*B[1]+(nx*ty-ny*tx)*B[2])*w;
            if(degenerate)asset.degenerateUVCorners++;
            else{
              check(Number.isFinite(orientation)&&orientation>=-report.checks.orientationTolerance,{...context,corner:k+corner,orientation},'Tangent handedness opposes triangle UV bitangent');
              if(Math.abs(orientation)<=report.checks.uvDeterminantEpsilon)asset.ambiguousCorners++;else asset.signedCorners++;
            }
          }
        }
      }
      asset.primitives++;asset.sourceVertices+=originalCount;asset.decodedVertices+=count;asset.extraVertices+=count-originalCount;asset.triangles+=p.index.length/3;asset.corners+=p.index.length;
    }
    report.assets.push(asset);report.totals.glbs++;
    for(const key of Object.keys(asset))if(typeof asset[key]==='number')report.totals[key]+=asset[key];
  }
  report.totals.extraVertexPercent=report.totals.extraVertices/report.totals.sourceVertices*100;
}catch(error){check(false,{},error.stack??String(error));}
console.log(JSON.stringify(report,null,2));
if(report.status!=='pass')process.exitCode=1;
