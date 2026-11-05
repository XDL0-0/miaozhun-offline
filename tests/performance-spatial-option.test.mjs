import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {readSpatialCellSizeOption,writePerformanceComparison} from '../scripts/create-performance-comparison.mjs';
import {applySpatialInstancingPatch} from '../patches/world-performance.mjs';
import {writeLegacyPerformanceInput,legacyPerformanceSourceFiles} from './fixtures/legacy-performance-modules.mjs';

const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('retained legacy fixture input needs no production build or optional diagnostic backups',t=>{
 const base=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(base,'aim-spatial-clean-input-test-'));
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(directory)),base);assert.ok(path.basename(directory).startsWith('aim-spatial-clean-input-test-'));fs.rmSync(directory,{recursive:true,force:true});});
 const before=legacyPerformanceSourceFiles.map(hash),input=writeLegacyPerformanceInput(path.join(directory,'input'));
 assert.deepEqual(legacyPerformanceSourceFiles.map(hash),before,'fixture assembly never changes retained sources');
 assert.deepEqual(fs.readdirSync(path.join(input,'js')).sort(),['CFqO0zvx.js','CymPR-fm.js','aQOfOAp-.js','index.C6F_bJRd.js'].sort());
 assert.equal(fs.existsSync(path.join(directory,'dist')),false,'fixture assembly does not require a production directory');
 assert.equal(fs.existsSync(path.join(directory,'qa-artifacts')),false);
 const native=fs.readFileSync(path.join(input,'js/CymPR-fm.js'),'utf8');
 assert.ok(native.includes('__aimWarmGate'),'real legacy readiness transform supplies installer anchors');
 assert.ok(!native.includes('/*__offlineTrainingFixture__*/'),'fixture input is clean even during other diagnostic sessions');
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

test('optional legacy spatial generator emits the exact patch only into a fresh overlay and records its size',t=>{
 const base=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(base,'aim-spatial-overlay-test-'));
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(directory)),base);assert.ok(path.basename(directory).startsWith('aim-spatial-overlay-test-'));fs.rmSync(directory,{recursive:true,force:true});});
 const input=writeLegacyPerformanceInput(path.join(directory,'input')),output=path.join(directory,'overlay'),name='aQOfOAp-.js';
 const relatives=['index.html','js/'+name,'js/CymPR-fm.js','js/CFqO0zvx.js'];
 const inputs=[...relatives.map(value=>path.join(input,value)),...legacyPerformanceSourceFiles],before=inputs.map(hash);
 const manifest=writePerformanceComparison({inputDir:input,outputDir:output,spatialCellSize:24});
 assert.deepEqual(inputs.map(hash),before,'All legacy inputs and retained sources stay byte-identical');
 const source=fs.readFileSync(path.join(input,'js',name),'utf8');
 assert.equal(fs.readFileSync(path.join(output,'dist/js',name),'utf8'),applySpatialInstancingPatch({[name]:source},{cellSize:24})[name]);
 assert.equal(manifest.measured,false);
 assert.deepEqual(manifest.experiments.spatialInstancing,{enabled:true,cellSize:24,module:'js/'+name,method:'Optional map instance grouping in world-space cells; geometry, materials, atlas attributes and original PVS identities are retained. Compare the same map and settings before accepting a change.'});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8')).experiments,manifest.experiments);
 assert.ok(fs.existsSync(path.join(output,'dist/js/CymPR-fm.js')),'The normal query-only fixture overlay is retained');
});
