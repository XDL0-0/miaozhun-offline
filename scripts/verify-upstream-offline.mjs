#!/usr/bin/env node
// Local-only acceptance checks for the retained 2026-11-05 engine package.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {parse} from './vendor/acorn.cjs';
import {inspectPrivateMap, inspectImage} from './validate-upstream-maps.mjs';
import {weaponMaterialTextures} from '../patches/weapon-body-materials-runtime.mjs';
import {decodeWeaponGlb, decodeWeaponEnvironment} from '../patches/weapon-models-runtime.mjs';
import {decodeWeaponMotion} from '../patches/weapon-motion-runtime.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.join(repository, 'upstream/aimpro-2026-11-05');
const expectedMaps = ['ascent','bonsai','duality','infinity','jam','juliett','plummet','rook','triad'];
const codecHash = 'bf57e15ea770dd98d419b11b251fabb30b28e422bc092a5580b1df245195eba4';
const schemaHash = 'eb88ea6c8eb090183694eddbdbb546c5757a50a46e2c164bb682b60e7fee5c57';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const walkFiles = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walkFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) if (value && typeof value === 'object') for (const child of Array.isArray(value) ? value : [value]) if (child?.type) walk(child, visit);
}
function walkValues(value, visit, pointer = '') {
  if (typeof value === 'string') visit(value, pointer);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walkValues(item, visit, pointer + '/' + key);
}
export function resolveReference(input, owner = '/') {
  ensure(typeof input === 'string', 'Resource reference is not a string');
  if (/^(?:data:|blob:|#)/i.test(input)) return null;
  const decoded = decodeURIComponent(input);
  if (/^(?:data:|blob:|#)/i.test(decoded)) return null;
  ensure(!decoded.includes('\\') && !decoded.split(/[/?#]/).includes('..'), 'Unsafe resource path: ' + input);
  const url = new URL(input, 'http://127.0.0.1:18746' + owner);
  ensure(url.origin === 'http://127.0.0.1:18746', 'External resource reference: ' + input);
  return decodeURIComponent(url.pathname);
}

// Only actual syntax nodes are requests. Object keys, source strings, and
// embedded shader/library source are deliberately not searched with regexes.
export function inspectModuleDependencies(source) {
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const references = [], unresolvedImports = [];
  walk(ast, node => {
    if (['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type) && node.source) {
      if (typeof node.source.value === 'string') references.push({value: node.source.value, kind: node.type === 'ImportExpression' ? 'dynamic import' : 'static import'});
      else unresolvedImports.push({offset: node.start, expression: source.slice(node.start, node.end).slice(0,180)});
    }
    if (node.type === 'VariableDeclarator' && node.id?.name === '__vite__mapDeps') walk(node.init, child => {
      if (child.type === 'ArrayExpression') for (const element of child.elements) if (typeof element?.value === 'string') references.push({value: element.value, kind: 'Vite preload'});
    });
    if (node.type === 'NewExpression' && node.callee?.name === 'URL' && node.arguments[1]?.type === 'MemberExpression' && node.arguments[1].object?.type === 'MetaProperty' && typeof node.arguments[0]?.value === 'string') references.push({value: node.arguments[0].value, kind: 'module URL'});
  });
  return {references, unresolvedImports};
}

function moduleExports(source, expectedHash, names) {
  ensure(sha256(source) === expectedHash, 'Unreviewed executable module: SHA-256 mismatch');
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  ensure(!ast.body.some(node => node.type === 'ImportDeclaration'), 'Validation module imports another module');
  const exports = ast.body.filter(node => node.type === 'ExportNamedDeclaration');
  const symbols = Object.fromEntries(exports.flatMap(node => node.specifiers.map(spec => [spec.exported.name, spec.local.name])));
  for (const name of names) ensure(symbols[name], 'Missing validation export: ' + name);
  let code = source;
  for (const node of [...exports].reverse()) code = code.slice(0,node.start) + code.slice(node.end);
  return code + '\nglobalThis.__exports={' + names.map(name => JSON.stringify(name) + ':' + symbols[name]).join(',') + '};';
}

export function createPackageCodec(source, root) {
  const location = Object.freeze({hostname: 'aimpro.world'}), fetched = new Set();
  const localFetch = async input => {
    const url = new URL(String(input), 'https://aimpro.world');
    ensure(url.origin === 'https://aimpro.world' && !url.search && !url.hash && /^\/aim-(?:maps|viewmodel|weapons|agents)\/[a-zA-Z0-9_.-]+\.enc$/.test(url.pathname), 'Blocked codec request: ' + url.href);
    const file = path.join(root, url.pathname.slice(1));
    ensure(fs.existsSync(file), 'Missing local codec input: ' + url.pathname);
    fetched.add(url.pathname);
    return new Response(fs.readFileSync(file), {status:200});
  };
  const context = vm.createContext({window: Object.freeze({location}), location, fetch: localFetch, crypto: Object.freeze({subtle: crypto.webcrypto.subtle}), TextEncoder, TextDecoder, Response, Blob, DecompressionStream, Uint8Array, ArrayBuffer, DataView, atob}, {codeGeneration:{strings:false,wasm:false}});
  vm.runInContext(moduleExports(source,codecHash,['e']), context, {timeout:2000});
  return {fetched, async decode(logicalPath) {
    const family = {'aim-maps':'map','aim-viewmodel':'viewmodel','aim-weapons':'weapon','aim-agents':'agent'}[logicalPath.split('/')[1]];
    ensure(family && /^\/aim-(?:maps|viewmodel|weapons|agents)\/[a-zA-Z0-9_.-]+$/.test(logicalPath), 'Unsafe decode path: ' + logicalPath);
    context.__path=logicalPath; context.__family=family;
    return Buffer.from(await vm.runInContext('__exports.e(__path,__family)',context,{timeout:2000}));
  }};
}

export function createSceneValidator(source) {
  const context = vm.createContext({}, {codeGeneration:{strings:false,wasm:false}});
  vm.runInContext(moduleExports(source,schemaHash,['p','w']),context,{timeout:2000});
  return serialized => {
    context.__serialized=serialized;
    return vm.runInContext('__exports.p(__serialized)',context,{timeout:2000});
  };
}

// Read the native actor registry as data. Do not execute the renderer or
// mistake its embedded base64 meshes and object aliases for network requests.
export function inspectActorRegistry(source, binaryData, requireAsset) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),definitions=new Map();
  for(const node of ast.body)if(node.type==='VariableDeclaration')for(const d of node.declarations)if(d.id.type==='Identifier')definitions.set(d.id.name,d.init);
  function literal(node,depth=0){
    ensure(node&&depth<20,'Unsupported/cyclic actor registry data');
    if(node.type==='Literal')return node.value;
    if(node.type==='Identifier')return literal(definitions.get(node.name),depth+1);
    if(node.type==='ArrayExpression')return node.elements.map(n=>literal(n,depth+1));
    if(node.type==='ObjectExpression')return Object.fromEntries(node.properties.map(p=>{ensure(p.type==='Property'&&!p.computed,'Nonliteral actor property');return[p.key.name??p.key.value,literal(p.value,depth+1)];}));
    if(node.type==='UnaryExpression'&&node.operator==='-')return -literal(node.argument,depth+1);
    if(node.type==='BinaryExpression'&&node.operator==='+')return literal(node.left,depth+1)+literal(node.right,depth+1);
    if(node.type==='ConditionalExpression'){const a=literal(node.consequent,depth+1),b=literal(node.alternate,depth+1);ensure(a===b,'Actor URL depends on runtime origin');return a;}
    throw new Error('Nonliteral actor registry expression: '+node.type);
  }
  const agents=literal(definitions.get('FB')),bones=literal(definitions.get('Jw')),builtins=literal(definitions.get('to')),textures=literal(definitions.get('JF'));
  const models=[];
  ensure(Object.keys(agents).length===28&&bones.length>0,'Unexpected actor registry');
  for(const [id,meta] of Object.entries(agents)){
    for(const name of ['bin','albedo','ao','orm'])if(meta[name])requireAsset('/aim-agents/'+meta[name],'/','native actor '+id);
    const bytes=binaryData.get('/aim-agents/'+meta.bin),layout=meta.layout;
    ensure(bytes&&Array.isArray(layout)&&layout.length===7&&layout.every(n=>Number.isSafeInteger(n)&&n>=0),'Missing agent binary/layout: '+id);
    const lengths=[meta.verts*6,meta.verts*3,meta.verts*4,meta.verts*4,meta.verts*4,meta.tris*6,bones.length*64];
    ensure(layout[6]+lengths[6]===bytes.length,'Native actor binary length mismatch: '+id);
    for(let i=0;i<7;i++)ensure(layout[i]+lengths[i]<=(layout[i+1]??bytes.length),'Overlapping actor binary sections: '+id);
    for(let i=0;i<meta.tris*3;i++)ensure(bytes.readUInt16LE(layout[5]+i*2)<meta.verts,'Agent index outside vertices: '+id);
    for(let i=0;i<meta.verts*4;i++)ensure(bytes[layout[3]+i]<bones.length,'Agent skin bone out of range: '+id);
    for(let i=layout[6];i<bytes.length;i+=4)ensure(Number.isFinite(bytes.readFloatLE(i)),'Nonfinite inverse bind matrix: '+id);
    models.push({id,vertices:meta.verts,triangles:meta.tris,bones:bones.length,bytes:bytes.length});
  }
  for(const [name,variable,normalWidth] of [['phoenix','sD',2],['bot','fD',1]]){
    const data=literal(definitions.get(variable)),decoded={};
    for(const [key,value] of Object.entries(data)){ensure(typeof value==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(value),'Invalid embedded mesh encoding');decoded[key]=Buffer.from(value,'base64');}
    const vertices=decoded.pos.length/6;
    ensure(Number.isInteger(vertices)&&vertices>0&&decoded.nrm.length===vertices*3*normalWidth&&decoded.uv.length===vertices*4&&decoded.skinIndex.length===vertices*4&&decoded.skinWeight.length===vertices*4&&decoded.idx.length%6===0,'Invalid embedded mesh sections: '+name);
    for(let at=0;at<decoded.idx.length;at+=2)ensure(decoded.idx.readUInt16LE(at)<vertices,'Embedded mesh index out of bounds: '+name);
    models.push({id:name,vertices,triangles:decoded.idx.length/6,embedded:true});
  }
  const looks=new Map();
  for(const [id,meta] of Object.entries(builtins)){
    ensure(['phoenix','bot'].includes(meta.mesh),'Unknown builtin actor mesh');
    const urls=['albedo','ao','orm'].filter(key=>meta[key]).map(key=>textures[meta[key]]?.url);
    ensure(urls.every(url=>typeof url==='string'),'Missing builtin actor texture');
    for(const url of urls)requireAsset(url,'/','builtin actor '+id);
    looks.set(id,{model:meta.mesh,textures:urls,embeddedGeometry:true});
  }
  for(const [id,meta] of Object.entries(agents))looks.set(id,{model:'/aim-agents/'+meta.bin,textures:['albedo','ao','orm'].filter(key=>meta[key]).map(key=>'/aim-agents/'+meta[key])});
  return {models,looks};
}

export async function verifyPackage(root = path.join(repository,'dist')) {
  root=path.resolve(root);
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),root,success:false,engineBuild:'aimpro-2026-11-05',network:'No network: only hash-pinned codec/schema execute, and codec fetch reads local package files.',failures:[],resources:[],maps:[],scenes:[],modules:{checked:0,references:0,unresolvedImports:[]},requirements:[],kernels:[],kernelFingerprintMismatches:[],skinPacks:null,
    limitations:['This command does not open a browser or prove interactive rendering, input, FPS, or all conditional network paths.','Map meshopt payloads are authenticated and structurally checked, not decompressed/rendered. Image containers and dimensions are checked, not decoded to pixels.','Nonliteral dynamic imports are reported separately; the legacy kernel manifest is exhaustively checked. Raw binary payloads without metadata are authenticated, not semantically decoded.']};
  const fail=(stage,asset,error)=>report.failures.push({stage,path:asset,error:String(error?.message??error)});
  const check=(stage,asset,fn)=>{try{return fn();}catch(error){fail(stage,asset,error);return null;}};
  const file=p=>path.join(root,p.replace(/^\//,''));
  const has=p=>fs.existsSync(file(p))&&fs.statSync(file(p)).isFile();
  const requireAsset=(input,owner='/',kind='resource')=>{
    let p;try{p=resolveReference(input,owner);if(!p)return null;}catch(error){fail(kind,owner,error);return null;}
    let resolved=p;
    if(revisions[p])resolved=p+'.'+revisions[p]+'.enc';
    // The native third-person weapon loader reads shared textures from viewmodel.
    else if(/^\/aim-weapons\/[^/]+\.(?:png|jpe?g)$/.test(p)&&revisions[p.replace('/aim-weapons/','/aim-viewmodel/')]){const alias=p.replace('/aim-weapons/','/aim-viewmodel/');resolved=alias+'.'+revisions[alias]+'.enc';}
    const entry={path:p,resolved,owner,kind};requirements.set([p,owner,kind].join('\0'),entry);
    if(!has(resolved))fail(kind,p,'Missing local resource (resolved '+resolved+')');
    return resolved;
  };
  const requirements=new Map();
  let revisions={};
  const downloaded=check('source inventory','client-downloads.json',()=>readJson(path.join(snapshot,'client-downloads.json')));
  const acquisitions=new Map((downloaded?.assets??[]).map(entry=>[entry.path,entry]));
  check('revision inventory','asset-revisions.json',()=>{revisions=readJson(path.join(snapshot,'asset-revisions.json'));ensure(Object.keys(revisions).length===577,'Expected 577 resource revisions');for(const [logical,revision] of Object.entries(revisions))ensure(/^\/aim-(?:maps|viewmodel|weapons|agents)\/[\w.-]+$/.test(logical)&&/^[a-f0-9]{12}$/.test(revision),'Unsafe revision entry: '+logical);});
  const manifest=check('package manifest','/offline-manifest.json',()=>{const m=readJson(file('/offline-manifest.json'));ensure(m.engineBuild==='aimpro-2026-11-05'&&m.version>=5&&m.sceneCount===100&&m.network==='local-only','Wrong engine/offline manifest');ensure(JSON.stringify([...m.maps].sort())===JSON.stringify(expectedMaps),'Wrong map inventory');ensure(m.defaultLanguage==='zh-CN'&&JSON.stringify(m.languages)===JSON.stringify(['zh-CN','en']),'Bilingual defaults missing');return m;});
  const files=check('package inventory','/',()=>walkFiles(root))??[];
  report.fileCount=files.length;
  const codecSource=check('codec','source/js/ATp_kJvD.js',()=>fs.readFileSync(path.join(snapshot,'source/js/ATp_kJvD.js'),'utf8'));
  const codec=codecSource&&check('codec','/js/ATp_kJvD.js',()=>{
    const actual=fs.readFileSync(file('/js/ATp_kJvD.js'),'utf8');
    const expected=codecSource.replace("const v=()=>typeof window<'u'?window[ak(0x16e)][ak(0x306)]:''","const v=()=>'aimpro.world'");
    ensure(actual===expected,'Packaged codec differs from reviewed domain-only patch');
    return createPackageCodec(codecSource,root);
  });
  const decodedJson=new Map(),binarySizes=new Map(),agentBinaries=new Map();
  for(const [logical,revision] of Object.entries(revisions)) {
    const storedPath=logical+'.'+revision+'.enc';
    try {
      const stored=fs.readFileSync(file(storedPath)),capture=acquisitions.get(storedPath);
      ensure(capture&&capture.bytes===stored.length&&capture.sha256===sha256(stored),'Captured asset SHA-256/size mismatch');
      ensure(codec,'Codec was not verified');
      const bytes=await codec.decode(logical);
      ensure(bytes.length>0,'Empty decrypted resource');
      const resource={path:logical,storedPath,storedBytes:stored.length,sha256:sha256(stored),decodedBytes:bytes.length,decodedSha256:sha256(bytes),integrity:'authenticated and decompressed'};
      if(logical.endsWith('.json')){const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));ensure(object(data)||Array.isArray(data),'Invalid JSON root');decodedJson.set(logical,data);resource.format='JSON';}
      else if(logical.endsWith('.glb')){const result=inspectPrivateMap(bytes);decodedJson.set(logical,result.metadata);report.maps.push({map:path.basename(logical,'.glb'),...result.summary});resource.format='VMP1';}
      else if(/\.(?:png|avif|ktx2)$/.test(logical))resource.image=inspectImage(bytes);
      else if(/\.jpe?g$/.test(logical)){ensure(bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217,'Invalid JPEG framing');resource.format='JPEG';}
      else if(logical.endsWith('.bin')){binarySizes.set(logical,bytes.length);if(logical.startsWith('/aim-agents/'))agentBinaries.set(logical,bytes);resource.format='authenticated binary';}
      else throw new Error('Unrecognized encrypted payload type');
      report.resources.push(resource);
    }catch(error){fail('encrypted resource',storedPath,error);}
  }
  report.encryptedResources=report.resources.length;
  report.codecFetches=codec?.fetched.size??0;
  const actorRegistry=check('native actor geometry','/js/Do4sYkfr.js',()=>inspectActorRegistry(fs.readFileSync(file('/js/Do4sYkfr.js'),'utf8'),agentBinaries,requireAsset));
  report.actorModels=actorRegistry?.models??[];
  for(const [owner,data] of decodedJson) {
    walkValues(data,(value,pointer)=>{
      if(value.startsWith('/Game/')||value.startsWith('data:')||pointer==='/source'||!/(?:^|\/)[\w.-]+\.(?:bin|json|png|jpe?g|avif|webp|ktx2|gltf|glb|ogg|wav|mp3)$/i.test(value))return;
      requireAsset(value,owner,'manifest reference '+pointer);
    });
    if(owner.endsWith('.json')&&(data.offsets||data.parts?.some(part=>object(part)&&Number.isInteger(part.pos))))check('binary metadata',owner,()=>{
      const binary=owner.replace(/\.json$/,'.bin'),size=binarySizes.get(binary);
      ensure(size!==undefined,'Metadata has no decoded binary companion');
      for(const [key,range] of Object.entries(data.offsets??{}))if(Array.isArray(range)){ensure(range.length===2&&range.every(n=>Number.isSafeInteger(n)&&n>=0)&&range[0]+range[1]<=size,'Binary range out of bounds: '+key);}
      for(const part of data.parts??[])if(object(part))for(const key of ['pos','nrm','uv','idx'])if(part[key]!==undefined)ensure(Number.isSafeInteger(part[key])&&part[key]>=0&&part[key]<size,'Part offset out of bounds: '+key);
    });
  }
  check('map inventory','/aim-maps/',()=>ensure(JSON.stringify(report.maps.map(m=>m.map).sort())===JSON.stringify(expectedMaps),'Not all nine VMP1 maps validated'));
  for(const map of expectedMaps)check('map metadata','/aim-maps/'+map,()=>{
    for(const suffix of ['glb','collision.json','lightmaps.json','lights.json','pvs.json','surfaces.json'])ensure(decodedJson.has(`/aim-maps/${map}.${suffix}`),'Missing decoded map component: '+suffix);
    if(['bonsai','infinity','jam','plummet'].includes(map))ensure(decodedJson.has(`/aim-maps/${map}.ropes.json`),'Missing rope metadata');
    requireAsset(`/aim-maps/${map}.minimap.json`,'/','minimap');requireAsset(`/aim-maps/${map}.minimap.png`,'/','minimap');
    ensure(object(readJson(file(`/aim-maps/${map}.minimap.json`))),'Invalid minimap metadata');inspectImage(fs.readFileSync(file(`/aim-maps/${map}.minimap.png`)),'image/png');
  });
  // Check each acquired non-code asset against the public capture. Code/styles
  // are deliberately patched by the build and checked through their live graph.
  let capturedAssets=0;
  for(const capture of acquisitions.values())if(!/\.(?:js|css|enc)$/.test(capture.path))check('captured asset integrity',capture.path,()=>{
    const bytes=fs.readFileSync(file(capture.path));ensure(bytes.length===capture.bytes&&sha256(bytes)===capture.sha256,'Captured bytes changed');capturedAssets++;
  });
  report.capturedAssets=capturedAssets;
  for(const absolute of files){const owner='/'+path.relative(root,absolute).split(path.sep).join('/');
    if(/\.(?:mjs|js)$/.test(owner))check('JavaScript graph/syntax',owner,()=>{
      const result=inspectModuleDependencies(fs.readFileSync(absolute,'utf8'));report.modules.checked++;
      for(const ref of result.references){requireAsset(ref.value,owner,ref.kind);report.modules.references++;}
      for(const item of result.unresolvedImports)report.modules.unresolvedImports.push({path:owner,...item});
    });
    else if(owner.endsWith('.css'))check('CSS references',owner,()=>{
      const css=fs.readFileSync(absolute,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
      for(const match of css.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)|@import\s*["']([^"']+)["']/g))requireAsset(match[1]??match[2],owner,'CSS URL');
    });
    else if(/\.woff2?$/.test(owner))check('font signature',owner,()=>{ensure(fs.readFileSync(absolute).subarray(0,4).toString()===(owner.endsWith('woff2')?'wOF2':'wOFF'),'Invalid font signature');});
  }
  check('offline entry','/index.html',()=>{
    const html=fs.readFileSync(file('/index.html'),'utf8'),i18n=html.indexOf('src="/offline-i18n.js"'),runtime=html.indexOf('src="/offline-runtime.js"'),entry=html.indexOf('src="/js/index.FoQE3geO.js"');
    ensure(i18n>=0&&runtime>i18n&&entry>runtime,'Language/offline guards must precede the new engine entry');
    ensure(html.includes('__AIM_NO_THIRD_PARTY_STATS__=true'),'Third-party statistics are not disabled');
    for(const match of html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi))requireAsset(match[1],'/index.html','HTML resource');
  });
  await checkOfflineGuard(root,report.failures);
  check('legacy kernels','/aim-kernels/manifest.json',()=>{
    const entries=readJson(file('/aim-kernels/manifest.json')).kernels;
    ensure(Array.isArray(entries)&&entries.length===45,'Expected 45 retained legacy kernels');
    ensure(new Set(entries.map(k=>k.fingerprint)).size===45,'Duplicate legacy fingerprints');
    for(const entry of entries){
      ensure(/^[a-f0-9]{64}$/.test(entry.fingerprint)&&entry.file===`kernel-${entry.rulesVersion}-${entry.fingerprint.slice(0,12)}.js`,'Invalid legacy kernel identity');
      const p='/aim-kernels/'+entry.file;requireAsset(p,'/aim-kernels/manifest.json','legacy kernel');
      const capture=acquisitions.get(p),actual=sha256(fs.readFileSync(file(p)));
      ensure(capture&&actual===capture.sha256,'Legacy kernel captured SHA-256 mismatch: '+entry.file);
      const fingerprintMatchesFile=actual===entry.fingerprint;
      // The captured native loader uses fingerprint as a replay identity; it
      // does not hash the fetched module. Preserve the upstream identity and
      // report discrepancies honestly while requiring exact captured bytes.
      if(!fingerprintMatchesFile)report.kernelFingerprintMismatches.push({file:entry.file,manifestFingerprint:entry.fingerprint,capturedAndPackagedSha256:actual});
      report.kernels.push({...entry,sha256:actual,capturedBytesMatch:true,fingerprintMatchesFile});
    }
  });
  if(report.kernelFingerprintMismatches.length)report.limitations.push(`${report.kernelFingerprintMismatches.length} upstream legacy kernel fingerprints differ from their captured file SHA-256. Their original replay identities and filenames are preserved; every packaged kernel matches captured bytes. These fingerprint comparisons are not claimed to pass.`);
  const sceneBase='/prod-api/api/v1/public/val/aimlab';
  const parseScene=check('scene schema','/js/B3BEvzMF.js',()=>createSceneValidator(fs.readFileSync(file('/js/B3BEvzMF.js'),'utf8')));
  const catalog=check('scene catalogue',sceneBase+'/workshop',()=>{
    const value=readJson(file(sceneBase+'/workshop')),source=readJson(path.join(snapshot,'workshop.json'));
    ensure(value.code==='00000'&&Array.isArray(value.data)&&value.data.length===100,'Expected 100 successful workshop entries');
    ensure(new Set(value.data.map(s=>s.shareCode)).size===100,'Duplicate scene share codes');
    ensure(JSON.stringify(value)===JSON.stringify(source),'Workshop differs from acquired source');return value.data;
  })??[];
  for(const item of catalog)check('scene document',sceneBase+'/scenes/'+item.shareCode,()=>{
    ensure(/^[a-zA-Z0-9_-]{1,128}$/.test(item.shareCode),'Unsafe scene identifier');
    const p=sceneBase+'/scenes/'+item.shareCode,envelope=readJson(file(p)),source=readJson(path.join(snapshot,'scenes',item.shareCode)),data=envelope.data;
    ensure(envelope.code==='00000'&&data?.shareCode===item.shareCode&&typeof data.doc==='string','Invalid serialized scene envelope');
    ensure(source.data.doc===data.doc,'Serialized scene differs from original capture');
    const byteLength=Buffer.byteLength(data.doc);ensure(data.docBytes===undefined||data.docBytes===byteLength,'Scene document byte length mismatch');
    ensure(parseScene,'Native schema validator unavailable');const doc=parseScene(data.doc);
    ensure(!doc.environment.map||expectedMaps.includes(doc.environment.map),'Unavailable scene map');
    ensure((item.mapId??null)===(doc.environment.map??null),'Catalogue and scene map differ');
    const looks=new Set(doc.actors.filter(a=>a.body?.shape==='humanoid').map(a=>a.body?.look??'default'));
    for(const look of looks){
      const model=actorRegistry?.looks.get(look);ensure(model,'Actor look is not in native registry: '+look);
      for(const p of [...model.textures,...(model.embeddedGeometry?[]:[model.model])])requireAsset(p,'/','scene actor '+item.shareCode);
    }
    const behaviorKinds={};for(const actor of doc.actors)for(const behavior of actor.behaviors)behaviorKinds[behavior.kind]=(behaviorKinds[behavior.kind]??0)+1;
    report.scenes.push({code:item.shareCode,name:item.name,map:doc.environment.map??null,docBytes:byteLength,docSha256:sha256(data.doc),schema:'package B3BEvzMF.js export p executed',actorTemplates:doc.actors.length,spawners:doc.spawners.length,dispatchers:doc.dispatchers?.length??0,sequencers:doc.sequencers?.length??0,blocks:doc.blocks.length,looks:[...looks],behaviorKinds});
  });
  report.sceneCount=report.scenes.length;
  report.robots={actorTemplates:report.scenes.reduce((n,s)=>n+s.actorTemplates,0),spawners:report.scenes.reduce((n,s)=>n+s.spawners,0),dispatchers:report.scenes.reduce((n,s)=>n+s.dispatchers,0),sequencers:report.scenes.reduce((n,s)=>n+s.sequencers,0),behaviorKinds:report.scenes.reduce((result,s)=>{for(const [kind,n] of Object.entries(s.behaviorKinds))result[kind]=(result[kind]??0)+n;return result;},{})};
  report.skinPacks=verifySkins(root,requireAsset,report.failures);
  if(manifest&&report.skinPacks)check('skin manifest counts','/offline-manifest.json',()=>{ensure(manifest.weaponModels?.weapons===26,'Manifest must retain 26 skin/weapon combinations');for(const [key,value] of Object.entries(report.skinPacks.weaponModels??{}))ensure(manifest.weaponModels?.[key]===value,'Offline model count mismatch: '+key);});
  report.requirements=[...requirements.values()];
  report.success=report.failures.length===0&&report.encryptedResources===577&&report.maps.length===9&&report.scenes.length===100&&report.kernels.length===45;
  return report;
}

export async function checkOfflineGuard(root,failures) {
  const file='/offline-runtime.js';
  try {
    const source=fs.readFileSync(path.join(root,file),'utf8'),end=source.indexOf(" const favoriteKey=");
    ensure(end>0,'Offline guard boundary missing');
    const requests=[],location={href:'http://127.0.0.1:18746/aim',origin:'http://127.0.0.1:18746'};
    function XMLHttpRequest(){};XMLHttpRequest.prototype.open=function(method,url){requests.push(url);};
    const window={fetch:async url=>{requests.push(url);return new Response('local');}};
    const context=vm.createContext({window,location,XMLHttpRequest,navigator:{sendBeacon(){throw new Error('Native beacon must not run');}},Request,URL,Response},{codeGeneration:{strings:false,wasm:false}});
    vm.runInContext(source.slice(0,end)+'})();',context,{timeout:1000});
    for(const url of ['/aim-maps/test','https://aimpro.world/test','https://ishoutu.cn/test','https://static.ishoutu.cn/test'])await window.fetch(url);
    for(const url of ['https://example.com/test','//example.com/test']){let blocked=false;try{await window.fetch(url);}catch{blocked=true;}ensure(blocked,'External fetch not blocked: '+url);}
    let blocked=false;try{new XMLHttpRequest().open('GET','https://example.com/test');}catch{blocked=true;}ensure(blocked,'External XHR not blocked');
    ensure(context.navigator.sendBeacon('https://example.com/test','x')===false,'Beacon not blocked');
    ensure(requests.every(url=>new URL(String(url),location.href).origin===location.origin),'Guard forwarded an external request');
  }catch(error){failures.push({stage:'offline network guards',path:file,error:error.message});}
}

// Keep the existing offline verifier's skin/model acceptance criteria intact.
// This is deliberately separate from the engine resource codec.
function verifySkins(root, registerAsset, failures) {
 const packageRoot=repository;
 const has=p=>fs.existsSync(path.join(root,p.replace(/^\//,'')));
 const requireAsset=(url,source)=>registerAsset(url,'/',source);
 requireAsset('/skin-packs/index.json','skin pack catalogue');
let skinPacks=null;
if(has('/skin-packs/index.json')){
 try{
  const manifest=readJson(path.join(root,'skin-packs/index.json'));
  if(manifest.schemaVersion!==2)throw new Error('Unsupported skin manifest version');
  const counts={audio:0,killAudio:0,successiveAudio:0,banners:0,layeredBanners:0,bannerLayers:0,fire:0,missingFire:0,eligibleFireCombinations:0},layerUrls=new Set();
  function skinAsset(url,kind){
   if(typeof url!=='string'||!/^\/skin-packs\/[a-z0-9/-]+\.(?:ogg|png)$/.test(url))throw new Error('Unsafe skin asset URL');
   requireAsset(url,'skin pack '+kind);
   if(!has(url))return;
   const bytes=fs.readFileSync(path.join(root,url.slice(1)));
   if(kind==='banner-layer'){
    if(bytes.length<26||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(16)>1024||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(20)>1024)throw new Error('Invalid native-size skin banner layer: '+url);
   }else if(kind==='banner'){
    if(bytes.length<26||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==300||bytes.readUInt32BE(20)!==300||bytes[25]!==6)throw new Error('Invalid normalized RGBA skin banner: '+url);
   }else if(bytes.subarray(0,4).toString()!=='OggS')throw new Error('Invalid Ogg skin audio: '+url);
  }
  for(const collection of manifest.collections)for(const theme of collection.themes){
   for(const weapon of collection.weapons.filter(weapon=>weapon!=='melee')){counts.eligibleFireCombinations++;if(theme.fire[weapon]){skinAsset(theme.fire[weapon],'fire');counts.fire++;counts.audio++}else counts.missingFire++}
   for(const url of Object.values(theme.kills)){skinAsset(url,'kill');counts.audio++;counts.killAudio++}
   if(theme.successive){skinAsset(theme.successive,'successive');counts.audio++;counts.successiveAudio++}
   for(const banner of theme.banners){
    skinAsset(banner.url,'banner');counts.banners++;
    if(banner.frames){
     if(!Array.isArray(banner.frames)||banner.frames.length<5||banner.frames.length>6)throw new Error('Invalid skin banner frames');
     for(const url of banner.frames)skinAsset(url,'banner');
    }
    if(banner.layers){
     if(!['frame','ring','emblem','pip'].every(layer=>banner.layers[layer])||!(banner.pipRadius>0&&banner.pipRadius<=150)||!Array.isArray(banner.headshotOffset)||banner.headshotOffset.length!==2||banner.headshotOffset.some(value=>!Number.isFinite(value)||Math.abs(value)>150))throw new Error('Invalid skin banner geometry');
     for(const url of [...Object.values(banner.layers),banner.headshot].filter(Boolean)){skinAsset(url,'banner-layer');layerUrls.add(url)}
     if(banner.pipSprite){
      const {source,size}=banner.pipSprite,pip=has(banner.layers.pip)?fs.readFileSync(path.join(root,banner.layers.pip.slice(1))):null;
      if(!Array.isArray(source)||source.length!==4||source.some(value=>!Number.isInteger(value))||source[0]<0||source[1]<0||source[2]<=0||source[3]<=0||!Array.isArray(size)||size.length!==2||size.some(value=>!Number.isFinite(value)||value<=0||value>150)||pip&&(source[0]+source[2]>pip.readUInt32BE(16)||source[1]+source[3]>pip.readUInt32BE(20)))throw new Error('Invalid skin pip sprite geometry');
     }
     counts.layeredBanners++;
    }
   }
  }
  counts.bannerLayers=layerUrls.size;
  for(const [key,value]of Object.entries(counts))if(manifest.counts[key]!==value)throw new Error('Skin manifest count mismatch: '+key);
  skinPacks={resourceStatus:manifest.resourceStatus,...counts};
 }catch(error){failures.push({path:'/skin-packs/index.json',stage:'skin pack integrity',error:error.message})}
}
// Weapon appearances are ordinary local GLBs/PNGs, independent of the encrypted
// default models. Verify every material/attachment before certifying offline use.
try{
 const indexPath='/skin-packs/models/index.json';requireAsset(indexPath,'weapon model catalogue');
 const index=readJson(path.join(root,indexPath.slice(1))),seen=new Set();
 const catalog=readJson(path.join(packageRoot,'skin-packs/catalog.json'));
 const expected=catalog.collections.flatMap(c=>c.weapons.map(w=>c.id+'/'+w)).sort();
 if(expected.length!==26||index.counts.weapons!==26)throw new Error('Expected 26 weapon/skin combinations');
 if(index.schemaVersion!==1||JSON.stringify(Object.keys(index.models??{}).sort())!==JSON.stringify(expected))throw new Error('Incomplete weapon model catalogue');
 const safe=url=>typeof url==='string'&&/^\/skin-packs\/models\/[a-z0-9/-]+\.(?:json|png|glb|bin\.gz)$/.test(url);
 const fxPath='/skin-packs/models/fire-effects.json';requireAsset(fxPath,'skin firing effects');
 const fx=readJson(path.join(root,fxPath.slice(1)));
 for(const texture of Object.values(fx.textures??{})){if(!safe(texture.file))throw new Error('Invalid skin effect texture');requireAsset(texture.file,fxPath);seen.add(texture.file);}
 const packages=new Map(Object.entries(index.models));
 for(const [base,themes]of Object.entries(index.variants??{}))for(const [theme,url]of Object.entries(themes))packages.set(base+'/'+theme,url);
 for(const [key,url]of packages){
  if(!safe(url))throw new Error('Invalid weapon model package path');requireAsset(url,indexPath);
  const pack=readJson(path.join(root,url.slice(1)));
  if(pack.schemaVersion!==1||!([pack.collection+'/'+pack.weapon,pack.collection+'/'+pack.weapon+'/'+pack.theme].includes(key))||pack.parts.filter(p=>p.role==='body').length!==1||pack.parts.filter(p=>p.role==='magazine').length!==(pack.weapon==='melee'?0:1))throw new Error('Incomplete weapon model '+key);
  for(const part of pack.parts){
   if(!safe(part.url))throw new Error('Invalid weapon GLB path');requireAsset(part.url,key+' '+part.role);seen.add(part.url);
   const bytes=fs.readFileSync(path.join(root,part.url.slice(1))),decoded=decodeWeaponGlb(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
   if(decoded.primitives.some(p=>p.material>=part.materials.length||!p.position.every(Number.isFinite)))throw new Error('Invalid weapon geometry '+key);
   // Inventory retained source maps as well as visible/preloaded maps. Hidden
   // surfaces keep their original files offline but do not upload them.
   for(const mat of part.materials)for(const texture of weaponMaterialTextures({...mat,hidden:false})){
    if(!safe(texture))throw new Error('Invalid weapon texture path');requireAsset(texture,key+' '+mat.name);seen.add(texture);
    const png=fs.readFileSync(path.join(root,texture.slice(1)));
    if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)>4096||png.readUInt32BE(20)>4096)throw new Error('Invalid weapon texture '+texture);
   }
   for(const mat of part.materials)if(mat.environment){
    const meta=mat.environment;if(!safe(meta.data))throw new Error('Invalid weapon environment path');requireAsset(meta.data,key+' '+mat.name+' HDR reflection');
    if(!seen.has(meta.data)){
     const bytes=gunzipSync(fs.readFileSync(path.join(root,meta.data.slice(1))));decodeWeaponEnvironment(meta,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));seen.add(meta.data);
    }
   }
  }
  if(pack.weapon!=='melee'&&(!fx.guns[key]?.hip?.length||!pack.motions?.actions?.reload?.arms)||!pack.motions?.actions?.inspect?.arms)throw new Error('Incomplete skin motions/effects '+key);
  for(const clip of Object.values(pack.motions.clips)){
   if(!safe(clip.data))throw new Error('Invalid skin motion path');requireAsset(clip.data,key+' original animation');seen.add(clip.data);
   const bytes=gunzipSync(fs.readFileSync(path.join(root,clip.data.slice(1))));decodeWeaponMotion(clip,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
  }
  for(const action of Object.values(pack.motions.actions))for(const track of Object.values(action))for(const s of track.segments){if(!pack.motions.clips[s.clip]||!(s.to>s.from)||!(s.rate>0))throw new Error('Invalid skin montage segment '+key);}
  for(const url of pack.effects.textures){if(!safe(url))throw new Error('Invalid skin sprite path');requireAsset(url,key+' preloaded fire sprite');}
 }
 if(index.counts.assets!==seen.size)throw new Error('Weapon model asset count mismatch: expected '+index.counts.assets+', found '+seen.size);
 if(skinPacks)skinPacks.weaponModels={...index.counts};
}catch(error){failures.push({path:'/skin-packs/models/index.json',stage:'weapon model integrity',error:error.message})}

 return skinPacks;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.includes('--help'))console.log('Usage: node scripts/verify-upstream-offline.mjs [--root=dist] [--report=verification-upstream.json]\nReads local files only. Exits 1 on any failed or missing required check.');
 else{
  ensure(args.every(arg=>arg.startsWith('--root=')||arg.startsWith('--report=')),'Unknown argument; use --help');
  const root=path.resolve(args.find(arg=>arg.startsWith('--root='))?.slice(7)??path.join(repository,'dist'));
  const reportFile=path.resolve(args.find(arg=>arg.startsWith('--report='))?.slice(9)??path.join(repository,'verification-upstream.json'));
  const report=await verifyPackage(root);
  fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({success:report.success,root,files:report.fileCount,encryptedResources:report.encryptedResources,scenes:report.sceneCount,maps:report.maps.length,kernels:report.kernels.length,kernelFingerprintMismatches:report.kernelFingerprintMismatches.length,robots:report.robots,skinPacks:report.skinPacks,modules:report.modules.checked,unresolvedImports:report.modules.unresolvedImports,limitations:report.limitations,failures:report.failures,report:reportFile},null,2));
  process.exitCode=report.success?0:1;
 }
}
