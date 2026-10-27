import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readSpatialCellSizeOption,writePerformanceComparison} from '../scripts/create-performance-comparison.mjs';
import {applySpatialInstancingPatch} from '../patches/world-performance.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

// A live diagnostic overlay may be installed while this test runs. Follow only
// exact manifest hashes to its preserved source, without changing that session.
function cleanInput(relative,root=repository){
 let buffer=fs.readFileSync(path.join(root,'dist',relative));
 const audit=path.join(root,'qa-artifacts'),candidates=(fs.existsSync(audit)?fs.readdirSync(audit,{withFileTypes:true}):[]).filter(entry=>entry.isDirectory()).flatMap(entry=>{
  const directory=path.join(audit,entry.name),manifest=path.join(directory,'deployed-files.json');
  if(!fs.existsSync(manifest))return [];
  return JSON.parse(fs.readFileSync(manifest,'utf8')).filter(value=>value.name===relative).map(entry=>({directory,entry}));
 });
 const seen=new Set();
 for(;;){
  const current=digest(buffer);if(seen.has(current))break;seen.add(current);
  const match=candidates.find(value=>value.entry.deployedSha256===current&&value.entry.originalSha256&&value.entry.originalSha256!==current);
  if(!match)break;
  buffer=fs.readFileSync(path.join(match.directory,'production-backup',relative));
  assert.equal(digest(buffer),match.entry.originalSha256,'Active overlay backup must match its manifest');
 }
 return buffer;
}

test('clean checkout input needs no optional diagnostic artifacts directory',t=>{
 const base=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(base,'aim-spatial-clean-input-test-'));
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(directory)),base);assert.ok(path.basename(directory).startsWith('aim-spatial-clean-input-test-'));fs.rmSync(directory,{recursive:true,force:true});});
 fs.mkdirSync(path.join(directory,'dist/js'),{recursive:true});
 const original=Buffer.from('export const clean=true;');
 fs.writeFileSync(path.join(directory,'dist/js/example.js'),original);
 assert.equal(fs.existsSync(path.join(directory,'qa-artifacts')),false);
 assert.deepEqual(cleanInput('js/example.js',directory),original);
 assert.equal(fs.existsSync(path.join(directory,'qa-artifacts')),false,'Reading clean input does not create diagnostics directories');
});

test('spatial CLI option is explicit, positive and finite; invalid or duplicate arguments fail closed',()=>{
 assert.equal(readSpatialCellSizeOption([]),null);
 assert.equal(readSpatialCellSizeOption(['--output','example','--spatial-cell-size','24']),24);
 assert.equal(readSpatialCellSizeOption(['--spatial-cell-size=24']),24);
 assert.equal(readSpatialCellSizeOption(['--spatial-cell-size','12.5']),12.5);
 for(const value of ['',undefined,'--output','0','-1','NaN','Infinity','1e999','0x18','24px']){
  assert.throws(()=>readSpatialCellSizeOption(['--spatial-cell-size',value]),/positive finite/);
 }
 assert.throws(()=>readSpatialCellSizeOption(['--spatial-cell-size=']),/positive finite/);
 assert.throws(()=>readSpatialCellSizeOption(['--spatial-cell-size','24','--spatial-cell-size=12']),/only once/);
 for(const spatialCellSize of [0,-1,NaN,Infinity,false,'']){
  assert.throws(()=>writePerformanceComparison({spatialCellSize}),/positive finite/,'API validates before filesystem work');
 }
});

test('optional spatial generator emits the exact patch only into a fresh overlay and records its size',t=>{
 const base=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(base,'aim-spatial-overlay-test-'));
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(directory)),base);assert.ok(path.basename(directory).startsWith('aim-spatial-overlay-test-'));fs.rmSync(directory,{recursive:true,force:true});});
 const input=path.join(directory,'input'),output=path.join(directory,'overlay'),name='aQOfOAp-.js';
 const relatives=['index.html','js/'+name,'js/CymPR-fm.js','js/CFqO0zvx.js'];
 const inputs=relatives.map(value=>path.join(repository,'dist',value)),before=inputs.map(hash);
 fs.mkdirSync(path.join(input,'js'),{recursive:true});
 for(const relative of relatives)fs.writeFileSync(path.join(input,relative),cleanInput(relative));
 const manifest=writePerformanceComparison({inputDir:input,outputDir:output,spatialCellSize:24});
 assert.deepEqual(inputs.map(hash),before,'All production modules stay byte-identical');
 const source=fs.readFileSync(path.join(input,'js',name),'utf8');
 assert.equal(fs.readFileSync(path.join(output,'dist/js',name),'utf8'),applySpatialInstancingPatch({[name]:source},{cellSize:24})[name]);
 assert.equal(manifest.measured,false);
 assert.deepEqual(manifest.experiments.spatialInstancing,{enabled:true,cellSize:24,module:'js/'+name,method:'Optional map instance grouping in world-space cells; geometry, materials, atlas attributes and original PVS identities are retained. Compare the same map and settings before accepting a change.'});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8')).experiments,manifest.experiments);
 assert.ok(fs.existsSync(path.join(output,'dist/js/CymPR-fm.js')),'The normal query-only fixture overlay is retained');
});
