import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {aggregateComparison, reportFor, validateComparison} from '../scripts/summarize-engine-comparison.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value));
const changeJson = (filename, change) => {
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  change(value);
  writeJson(filename, value);
};
const samples = (mean, count = 900) => ({count, droppedSampleCount: 0, min: mean / 2, max: mean * 2, mean});

function fixture(t, {optimization = false, diagnostics = false} = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-aggregation-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  fs.mkdirSync(path.join(base, 'results'));
  const metadata = optimization ? {benchmarkKind: 'optimization', labels: {old: '优化前', new: '优化后'}} : {};
  const cases = ['ascent', 'plummet'].map(id => {
    const scene = {meta: {id, seed: 20261105}, actors: [{id: 'target'}]};
    return {id, name: id, scene, sceneHash: hash(JSON.stringify(scene)), spawners: 1, actorTemplates: 1};
  });
  const order = [];
  for (const c of cases) for (const round of [1, 2, 3]) {
    for (const engine of round === 2 ? ['new', 'old'] : ['old', 'new']) order.push({caseId: c.id, round, engine});
  }
  const plan = {...metadata, seed: 20261105, width: 1280, height: 720, warmupSeconds: 5, measureSeconds: 15, cases, plan: order};
  writeJson(path.join(base, 'plan.json'), plan);
  const configuration = {
    width: 1280, height: 720, warmupSeconds: 5, measureSeconds: 15, samplingClock: 'simulation',
    audio: false, skin: 'native default', shadows: true, lowLatency: false, renderScale: 1,
    frameMode: 'refresh', maxFps: 0, sensitivity: .5, viewModelFov: 70,
  };
  for (const engine of ['old', 'new']) {
    const dir = path.join(base, engine);
    fs.mkdirSync(path.join(dir, 'js'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'js', 'game.js'), `// instrumented ${engine}`);
    fs.writeFileSync(path.join(dir, 'js', 'world.js'), `// world ${engine}`);
    for (const name of ['benchmark', 'metrics', 'render-stats']) fs.writeFileSync(path.join(dir, `__engine-${name}.mjs`), `// common ${name}`);
    writeJson(path.join(dir, '__engine-config.json'), {
      ...plan, engine, game: 'game.js', world: 'world.js', originalGameHash: hash(engine),
      ...(optimization ? {nativeStencil: true, originalWorldHash: hash(`world before instrumentation ${engine}`)} : {}),
    });
  }
  const files = order.map((entry, index) => {
    const environment = {
      userAgent: 'fixture browser', hardwareConcurrency: 8, deviceMemory: 16, devicePixelRatio: 1,
      buffer: [1280, 720], gpuVendor: 'fixture vendor', gpuRenderer: 'fixture renderer',
      visibility: 'visible', fullscreen: false, pointerLocked: false,
      context: {alpha: true, antialias: true, depth: true, desynchronized: false,
        failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance', premultipliedAlpha: true,
        preserveDrawingBuffer: false, stencil: optimization || entry.engine === 'new', xrCompatible: false},
    };
    const filename = path.join(base, 'results', `${String(index).padStart(2, '0')}-${entry.engine}.json`);
    writeJson(filename, {
      ...entry, runIndex: index, reason: 'completed', valid: true,
      validation: Object.fromEntries(['completed', 'noErrors', 'enoughFrames', 'sampleCoverage', 'elapsed',
        'simulation', 'phase', 'buffer', 'noCapture', 'unthrottled', 'nativeSkin'].map(key => [key, true])),
      errors: [], events: [], seed: plan.seed, sceneHash: cases.find(c => c.id === entry.caseId).sceneHash,
      engineHash: hash(entry.engine), spawners: 1, actorTemplates: 1, configuration,
      sampleSimulationSeconds: 15, simulationSeconds: 20, sampleWallSeconds: 15, sampleCoverageSeconds: 15,
      sampleStartTick: 640, sampleEndTick: 2560, elapsedSeconds: 21, inputTicks: 2560, skinStorage: null,
      environment, finalEnvironment: environment,
      metrics: {sampleCount: 900, droppedSampleCount: 0, averageFps: 60, onePercentLowFps: 50,
        p99FrameMs: 20, minFrameMs: 10, maxFrameMs: 25,
        stutterCounts: {over33_333Ms: 0, over50Ms: 0, over100Ms: 0}},
      rafMetrics: {averageFps: 60}, cpu: {tick: samples(.2), renderSubmit: samples(2)},
      draw: {calls: samples(100), triangles: samples(10000)},
      ...(diagnostics ? {
        gpuPacing: {checks: 1000, blocked: 100, cpuMs: samples(.01, 1000),
          statsStart: {maxInFlight: 2, checks: 200}, statsEnd: {maxInFlight: 2, checks: 1200}, storage: null},
        gpuTiming: {enabled: false, supported: false, samplesMs: [], summary: {count: 0, mean: null}, disjoint: false},
      } : {}),
    });
    return filename;
  });
  return {base, files};
}

test('historic engine-migration results retain their native stencil exception', t => {
  const {base} = fixture(t);
  const {summary} = aggregateComparison(base);
  assert.equal(summary.runCount, 12);
  assert.equal(summary.pairedRoundCount, 6);
  assert.equal(summary.benchmarkKind, 'engine-migration');
  assert.deepEqual(summary.environmentComparability.exception.nativeDefaults, {old: false, new: true});
  const report = reportFor(summary, base, path.join(base, '..', 'report'));
  assert.match(report, /新旧引擎固定场景性能对比/);
  assert.match(report, /old stencil=false，new stencil=true/);
});

test('same-engine optimization accepts native stencil on both sides and preserves diagnostics', t => {
  const {base} = fixture(t, {optimization: true, diagnostics: true});
  const {summary} = aggregateComparison(base);
  assert.equal(summary.environmentComparability.exception, null);
  assert.ok(summary.validation.pairs.every(pair => pair.allowedNativeContextDifference === null));
  assert.equal(summary.hashes.engines.old.originalWorld, hash('world before instrumentation old'));
  assert.equal(summary.runs[0].gpuPacing.blocked, 100);
  assert.deepEqual(summary.runs[0].gpuPacing.statsEnd, {maxInFlight: 2, checks: 1200});
  assert.equal(summary.runs[0].gpuTiming.enabled, false);
  assert.equal(summary.runs[0].gpuTiming.summary.count, 0);
  assert.equal(Object.hasOwn(summary.runs[0].gpuTiming, 'samplesMs'), false);
  const report = reportFor(summary, base, path.join(base, '..', 'report'));
  assert.match(report, /新引擎优化前后固定场景性能对比/);
  assert.match(report, /优化后相对优化前/);
  assert.match(report, /相同的原生 WebGL context 设置，stencil=true/);
  assert.match(report, /检查 CPU 均值/);
  assert.match(report, /各组 GPU timer 诊断/);
  assert.match(report, /GPU timer 未启用；仅保留状态元数据/);
  assert.match(report, /--before=/);
  assert.doesNotMatch(report, /stencil 差异|包含引擎与地图资源的版本变化|没有直接计数队列阻止提交次数/);
});

test('aggregation rejects a scene that no longer matches the captured plan', t => {
  const {base, files} = fixture(t, {optimization: true});
  changeJson(files[1], run => { run.sceneHash = hash('different scene'); });
  assert.throws(() => validateComparison(base), /scene\/seed differs from plan/);
});

test('aggregation rejects a changed benchmark configuration', t => {
  const {base, files} = fixture(t, {optimization: true});
  changeJson(files[1], run => { run.configuration.renderScale = .5; });
  assert.throws(() => validateComparison(base), /configuration differs from fixed protocol/);
});

test('aggregation rejects a config that disagrees with the paired plan', t => {
  const {base} = fixture(t, {optimization: true});
  changeJson(path.join(base, 'new', '__engine-config.json'), config => { config.width = 640; });
  assert.throws(() => validateComparison(base), /isolated configuration differs at width/);
});

test('optimization cannot inherit the old engine stencil default', t => {
  const {base} = fixture(t, {optimization: true});
  changeJson(path.join(base, 'old', '__engine-config.json'), config => { delete config.nativeStencil; });
  assert.throws(() => validateComparison(base), /optimization requires explicit native stencil=true/);
});

test('aggregation rejects a context inconsistent with the recorded native engine setting', t => {
  const {base, files} = fixture(t, {optimization: true});
  changeJson(files[0], run => {
    run.environment.context.stencil = false;
    run.finalEnvironment.context.stencil = false;
  });
  assert.throws(() => validateComparison(base), /unexpected native stencil setting/);
});

test('paired contexts must agree beyond their configured stencil setting', t => {
  const {base, files} = fixture(t, {optimization: true});
  changeJson(files[1], run => {
    run.environment.context.antialias = false;
    run.finalEnvironment.context.antialias = false;
  });
  assert.throws(() => validateComparison(base), /environment mismatch/);
});

test('aggregation rejects impossible GPU pacing counters', t => {
  const {base, files} = fixture(t, {optimization: true, diagnostics: true});
  changeJson(files[1], run => { run.gpuPacing.blocked = run.gpuPacing.checks + 1; });
  assert.throws(() => validateComparison(base), /invalid GPU pacing counts/);
});

test('aggregation rejects asymmetric GPU timer instrumentation', t => {
  const {base} = fixture(t, {optimization: true});
  changeJson(path.join(base, 'new', '__engine-config.json'), config => { config.gpuTiming = true; });
  assert.throws(() => validateComparison(base), /isolated configuration differs at gpuTiming/);
});

test('aggregation rejects a changed GPU budget despite valid counters', t => {
  const {base, files} = fixture(t, {optimization: true, diagnostics: true});
  changeJson(files[1], run => { run.gpuPacing.statsEnd.maxInFlight = 3; });
  assert.throws(() => validateComparison(base), /native two-frame budget/);
});
