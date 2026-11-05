import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {summarizeFrameTimes, summarizeSamples, summarizePairedRuns} from '../scripts/engine-comparison-metrics.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const run = (engine, round, metrics, caseId = 'range') => ({engine, round, metrics, caseId});

test('average FPS uses elapsed frame time rather than averaging instantaneous FPS', () => {
  const result = summarizeFrameTimes([10, 30]);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.elapsedMs, 40);
  assert.equal(result.averageFrameMs, 20);
  assert.equal(result.averageFps, 50);
  close(result.averageFps, result.sampleCount * 1000 / result.elapsedMs);
  assert.notEqual(result.averageFps, (1000 / 10 + 1000 / 30) / 2);
});

test('frame quantiles interpolate and 1% low averages the full slowest tail', () => {
  const intervals = Object.freeze(Array.from({length: 101}, (_, index) => index + 1).reverse());
  const result = summarizeFrameTimes(intervals);
  assert.equal(result.medianFrameMs, 51);
  assert.equal(result.p95FrameMs, 96);
  assert.equal(result.p99FrameMs, 100);
  assert.equal(result.onePercentTailSampleCount, 2);
  close(result.onePercentLowFps, 1000 / 100.5);
  assert.equal(result.p99EquivalentFps, 10);
  assert.notEqual(result.onePercentLowFps, result.p99EquivalentFps);
  assert.equal(result.minFrameMs, 1);
  assert.equal(result.maxFrameMs, 101);
  assert.equal(intervals[0], 101, 'input order remains intact');
  close(summarizeFrameTimes([10, 20, 30, 40]).p95FrameMs, 38.5);
  close(summarizeFrameTimes([10, 20, 30, 40]).p99FrameMs, 39.7);
});

test('one sample and fewer than 100 samples have a nonempty 1% tail', () => {
  const single = summarizeFrameTimes(new Float64Array([8]));
  assert.equal(single.averageFps, 125);
  assert.equal(single.onePercentLowFps, 125);
  assert.equal(single.p99EquivalentFps, 125);
  assert.equal(single.p99FrameMs, 8);
  assert.equal(single.onePercentTailSampleCount, 1);
  assert.equal(summarizeFrameTimes([5, 10, 20]).onePercentLowFps, 50);
  assert.equal(summarizeFrameTimes(Array(100).fill(10)).onePercentTailSampleCount, 1);
});

test('invalid intervals are dropped without coercion and empty summaries are null', () => {
  const invalid = [0, -10, NaN, Infinity, -Infinity, undefined, null, '10', false];
  const result = summarizeFrameTimes([...invalid, 10, 20]);
  assert.equal(result.droppedSampleCount, invalid.length);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.elapsedMs, 30);
  for (const input of [[], invalid, undefined, null]) assert.equal(summarizeFrameTimes(input), null);
});

test('stutter thresholds are strict, nested counts and preserve equality at boundaries', () => {
  const result = summarizeFrameTimes([16.667, 16.668, 33.333, 33.334, 50, 50.001, 100, 100.001]);
  assert.deepEqual(result.stutterCounts, {over16_667Ms: 7, over33_333Ms: 5, over50Ms: 3, over100Ms: 1});
});

test('sample summaries allow zero and negative numbers and count invalid entries', () => {
  const values = Object.freeze([10, -10, 0, 20, '5', NaN, Infinity, null]);
  const result = summarizeSamples(values);
  const {p95, p99, ...exact} = result;
  assert.deepEqual(exact, {count: 4, droppedSampleCount: 4, mean: 5, median: 5, min: -10, max: 20, range: 30});
  close(p95, 18.5);
  close(p99, 19.7);
  assert.equal(summarizeSamples([0]).mean, 0);
  assert.equal(summarizeSamples(new Float64Array([2, 4])).median, 3);
  for (const input of [[], [null, NaN], undefined, null]) assert.equal(summarizeSamples(input), null);
});

test('frame and sample functions can be independently injected without module closures', () => {
  const frame = vm.runInNewContext(`(${summarizeFrameTimes.toString()})([10, 20])`);
  const sample = vm.runInNewContext(`(${summarizeSamples.toString()})([-10, 0, 10])`);
  assert.equal(frame.averageFps, 1000 / 15);
  assert.equal(sample.median, 0);
});

test('paired results use case and round, with per-engine median/range and metric direction', () => {
  const runs = [
    run('new', 2, {averageFps: 90, p99FrameMs: 12}),
    run('old', 1, {averageFps: 100, p99FrameMs: 20}),
    run('new', 1, {averageFps: 120, p99FrameMs: 10}),
    run('old', 2, {averageFps: 60, p99FrameMs: 16}),
    run('old', 1, {averageFps: 20}, 'hall'),
    run('new', 1, {averageFps: 10}, 'hall'),
  ];
  const saved = structuredClone(runs), result = summarizePairedRuns(runs);
  const range = result.cases.find(entry => entry.caseId === 'range');
  assert.equal(result.runCount, 6);
  assert.equal(result.caseCount, 2);
  assert.equal(result.pairedRoundCount, 3);
  assert.deepEqual(range.runCounts, {old: 2, new: 2});
  assert.equal(range.engines.old.averageFps.median, 80);
  assert.equal(range.engines.old.averageFps.range, 40);
  assert.equal(range.comparisons.averageFps.percentChange, 31.25);
  assert.equal(range.comparisons.averageFps.pairedPercentChange.median, 35);
  assert.notEqual(range.comparisons.averageFps.percentChange, range.comparisons.averageFps.pairedPercentChange.median);
  assert.equal(range.comparisons.averageFps.direction, 'higher-is-better');
  assert.equal(range.comparisons.p99FrameMs.direction, 'lower-is-better');
  assert.equal(range.pairs.find(pair => pair.round === 1).metrics.p99FrameMs.percentChange, -50);
  assert.equal(result.cases.find(entry => entry.caseId === 'hall').comparisons.averageFps.percentChange, -50);
  assert.match(result.notes[0], /does not establish statistical significance/);
  assert.deepEqual(runs, saved);
});

test('unpaired and duplicate rounds are reported and cannot silently affect paired changes', () => {
  const result = summarizePairedRuns([
    run('old', 1, {averageFps: 100}), run('new', 1, {averageFps: 110}),
    run('old', 2, {averageFps: 50}),
    run('old', 3, {averageFps: 20}), run('old', 3, {averageFps: 40}), run('new', 3, {averageFps: 200}),
    run('new', undefined, {averageFps: 1000}),
    run('old', '4', {averageFps: 10}), run('new', 4, {averageFps: 100}),
  ]);
  const entry = result.cases[0];
  assert.equal(entry.pairing.pairedRoundCount, 1);
  assert.equal(entry.pairing.missingRoundCount, 1);
  assert.equal(entry.pairing.unpairedRounds.length, 4);
  assert.deepEqual(entry.pairing.duplicateRounds, [{round: 3, engine: 'old', count: 2}]);
  assert.equal(entry.comparisons.averageFps.pairedPercentChange.count, 1);
  assert.equal(entry.comparisons.averageFps.pairedPercentChange.median, 10);
  assert.equal(entry.engines.new.averageFps.max, 1000, 'unpaired observations are retained in engine summaries');
});

test('zero baselines keep deltas and yield null percentages, not Infinity or a fabricated gain', () => {
  const result = summarizePairedRuns([
    run('old', 1, {averageFps: 0, p99FrameMs: 0, elapsedMs: 100}),
    run('new', 1, {averageFps: 10, p99FrameMs: 0, elapsedMs: 100}),
  ]).cases[0];
  assert.equal(result.comparisons.averageFps.delta, 10);
  assert.equal(result.comparisons.averageFps.percentChange, null);
  assert.equal(result.comparisons.averageFps.pairedPercentChange, null);
  assert.equal(result.comparisons.p99FrameMs.percentChange, null);
  assert.equal(result.pairs[0].metrics.averageFps.percentChange, null);
  assert.equal(result.comparisons.elapsedMs.direction, 'context-only');
  assert.equal(result.comparisons.averageFps.pairedDelta.median, 10);
});

test('invalid runs and missing metrics are counted without inventing comparisons', () => {
  const result = summarizePairedRuns([
    null, {}, run('other', 1, {averageFps: 10}), run('old', 1, null),
    run('old', 1, {averageFps: 100, p99FrameMs: 20, stutterCounts: {over50Ms: 1}}),
    run('new', 1, {averageFps: NaN, p99FrameMs: 10}),
  ]);
  assert.equal(result.droppedRunCount, 4);
  assert.equal(result.cases[0].engines.new.averageFps, null);
  assert.equal(result.cases[0].comparisons.averageFps.percentChange, null);
  assert.equal(result.cases[0].comparisons.averageFps.pairedDelta, null);
  assert.equal(result.cases[0].comparisons.p99FrameMs.percentChange, -50);
  assert.equal(result.cases[0].pairs[0].metrics.averageFps, undefined);
  assert.equal(result.cases[0].comparisons.stutterCounts, undefined);
  for (const input of [[], [null, {}], undefined, null]) assert.equal(summarizePairedRuns(input), null);
});
