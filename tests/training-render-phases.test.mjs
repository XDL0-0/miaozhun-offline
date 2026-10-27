import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {beginTrainingRenderPhases} from '../scripts/training-render-phases.mjs';

test('exclusive render phases aggregate repeated names and account marker overhead separately',()=>{
 let clock=0;const make=vm.runInNewContext('('+beginTrainingRenderPhases.toString()+')',{performance:{now(){const at=clock;clock+=.1;return at;}}});
 const phases=make();phases.start(0);clock=2;phases.mark('actorPose');clock+=3;phases.mark('worldUpdate');clock+=4;phases.mark('sceneRender');clock+=5;
 const value=phases.finish(clock);
 assert.ok(Math.abs(value.phases.renderPreamble-2)<1e-9);assert.ok(Math.abs(value.phases.actorPose-3.1)<1e-9);
 assert.ok(Math.abs(value.phases.worldUpdate-4.1)<1e-9);assert.ok(Math.abs(value.phases.sceneRender-5.1)<1e-9);
 assert.ok(Math.abs(value.instrumentationMs-.3)<1e-9);
 assert.ok(Math.abs(Object.values(value.phases).reduce((sum,value)=>sum+value,0)+value.instrumentationMs-clock)<1e-9);
 assert.equal(phases.finish(clock),value);phases.mark('ignored');assert.equal(value.phases.ignored,undefined);
});
