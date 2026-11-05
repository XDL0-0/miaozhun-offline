/**
 * Shared, descriptive benchmark statistics. Neither engine's native FPS/1% low
 * counter is used: supply intervals between consecutive measured frames in ms.
 *
 * Quantiles use linear interpolation at (n - 1) * p. 1% low is the reciprocal
 * of the mean of the slowest ceil(n * .01) intervals, NOT 1000 / p99FrameMs.
 * This function is self-contained so browser harnesses can inject toString().
 * Invalid intervals (non-numbers, non-finite values, zero, negatives) are
 * excluded and counted; they must not be interpreted as missed/zero-time frames.
 * Returns null when there are no valid intervals. Does not mutate the input.
 */
export function summarizeFrameTimes(frameIntervalsMs) {
  const input = Array.from(frameIntervalsMs ?? []);
  const sorted = input.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const sampleCount = sorted.length;
  if (!sampleCount) return null;
  const quantile = p => {
    const position = (sampleCount - 1) * p;
    const lower = Math.floor(position), upper = Math.ceil(position), weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };
  const elapsedMs = sorted.reduce((sum, value) => sum + value, 0);
  const averageFrameMs = sorted.reduce((mean, value) => mean + value / sampleCount, 0);
  const onePercentTailSampleCount = Math.ceil(sampleCount * .01);
  const slowTailMeanMs = sorted.slice(-onePercentTailSampleCount)
    .reduce((mean, value) => mean + value / onePercentTailSampleCount, 0);
  const p99FrameMs = quantile(.99);
  return {
    sampleCount,
    droppedSampleCount: input.length - sampleCount,
    elapsedMs,
    averageFrameMs,
    averageFps: 1000 / averageFrameMs,
    medianFrameMs: quantile(.5),
    p95FrameMs: quantile(.95),
    p99FrameMs,
    onePercentLowFps: 1000 / slowTailMeanMs,
    onePercentTailSampleCount,
    p99EquivalentFps: 1000 / p99FrameMs,
    minFrameMs: sorted[0],
    maxFrameMs: sorted[sampleCount - 1],
    stutterCounts: {
      over16_667Ms: sorted.filter(value => value > 16.667).length,
      over33_333Ms: sorted.filter(value => value > 33.333).length,
      over50Ms: sorted.filter(value => value > 50).length,
      over100Ms: sorted.filter(value => value > 100).length,
    },
  };
}

/**
 * Summarize finite numeric samples, including zero and negative values. Quantiles
 * use the same interpolated definition as frame metrics. Returns null if empty.
 * Self-contained for browser injection; input arrays/iterables are not mutated.
 */
export function summarizeSamples(values) {
  const input = Array.from(values ?? []);
  const sorted = input.filter(Number.isFinite).sort((a, b) => a - b);
  const count = sorted.length;
  if (!count) return null;
  const quantile = p => {
    const position = (count - 1) * p;
    const lower = Math.floor(position), upper = Math.ceil(position), weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };
  return {
    count,
    droppedSampleCount: input.length - count,
    mean: sorted.reduce((mean, value) => mean + value / count, 0),
    median: quantile(.5),
    min: sorted[0],
    max: sorted[count - 1],
    range: sorted[count - 1] - sorted[0],
    p95: quantile(.95),
    p99: quantile(.99),
  };
}

/**
 * Describe runs shaped as {engine: 'old'|'new', caseId: string, round, metrics}.
 * All finite, top-level numeric metric values are summarized separately for each
 * engine/case. Nested objects (e.g. stutterCounts) are deliberately not flattened.
 * Engine summaries include unpaired runs; paired changes only use rounds having
 * exactly one old and one new run. Missing, invalid, or duplicate round IDs are
 * reported and excluded from pairing. Numeric and string IDs remain distinct.
 *
 * cases[].comparisons[metric].percentChange compares engine medians; the
 * pairedPercentChange summary instead describes per-round percentage changes.
 * Percent change = 100 * (new - old) / abs(old), or null for a zero baseline.
 * Positive means an increase, NOT necessarily an improvement: frame times have
 * direction 'lower-is-better', FPS 'higher-is-better', other fields 'context-only'.
 * These are descriptive results; no significance/confidence claim is made.
 *
 * Returns null if no structurally valid runs exist. Browser injection requires
 * summarizeSamples to be defined too. Does not mutate runs or metrics.
 */
export function summarizePairedRuns(runs) {
  const input = Array.from(runs ?? []);
  const valid = input.filter(run => run && (run.engine === 'old' || run.engine === 'new')
    && typeof run.caseId === 'string' && run.caseId.length > 0
    && run.metrics && typeof run.metrics === 'object' && !Array.isArray(run.metrics));
  if (!valid.length) return null;
  const validRound = round => (typeof round === 'number' && Number.isFinite(round))
    || (typeof round === 'string' && round.length > 0);
  const percentChange = (oldValue, newValue) => oldValue === 0 ? null : 100 * ((newValue - oldValue) / Math.abs(oldValue));
  const direction = metric => /Fps$/.test(metric) ? 'higher-is-better'
    : /FrameMs$/.test(metric) ? 'lower-is-better' : 'context-only';
  const caseIds = [...new Set(valid.map(run => run.caseId))];
  const cases = caseIds.map(caseId => {
    const caseRuns = valid.filter(run => run.caseId === caseId);
    const metricNames = [...new Set(caseRuns.flatMap(run => Object.keys(run.metrics)
      .filter(name => Number.isFinite(run.metrics[name]))))].sort();
    const engineRuns = {old: caseRuns.filter(run => run.engine === 'old'), new: caseRuns.filter(run => run.engine === 'new')};
    const engines = Object.fromEntries(['old', 'new'].map(engine => [engine, Object.fromEntries(
      metricNames.map(metric => [metric, summarizeSamples(engineRuns[engine].map(run => run.metrics[metric]))]),
    )]));
    const rounds = new Map();
    let missingRoundCount = 0;
    for (const run of caseRuns) {
      if (!validRound(run.round)) { missingRoundCount++; continue; }
      if (!rounds.has(run.round)) rounds.set(run.round, {old: [], new: []});
      rounds.get(run.round)[run.engine].push(run);
    }
    const pairs = [], unpairedRounds = [], duplicateRounds = [];
    for (const [round, group] of rounds) {
      for (const engine of ['old', 'new']) {
        if (group[engine].length > 1) duplicateRounds.push({round, engine, count: group[engine].length});
      }
      if (group.old.length !== 1 || group.new.length !== 1) {
        unpairedRounds.push({round, oldRunCount: group.old.length, newRunCount: group.new.length});
        continue;
      }
      const metrics = Object.fromEntries(metricNames.flatMap(metric => {
        const oldValue = group.old[0].metrics[metric], newValue = group.new[0].metrics[metric];
        return Number.isFinite(oldValue) && Number.isFinite(newValue)
          ? [[metric, {old: oldValue, new: newValue, delta: newValue - oldValue, percentChange: percentChange(oldValue, newValue)}]] : [];
      }));
      pairs.push({round, metrics});
    }
    const comparisons = Object.fromEntries(metricNames.map(metric => {
      const oldMedian = engines.old[metric]?.median ?? null, newMedian = engines.new[metric]?.median ?? null;
      const comparable = oldMedian !== null && newMedian !== null;
      return [metric, {
        direction: direction(metric),
        oldMedian,
        newMedian,
        delta: comparable ? newMedian - oldMedian : null,
        percentChange: comparable ? percentChange(oldMedian, newMedian) : null,
        pairedDelta: summarizeSamples(pairs.map(pair => pair.metrics[metric]?.delta)),
        pairedPercentChange: summarizeSamples(pairs.map(pair => pair.metrics[metric]?.percentChange)),
      }];
    }));
    return {
      caseId,
      runCounts: {old: engineRuns.old.length, new: engineRuns.new.length},
      engines,
      comparisons,
      pairing: {pairedRoundCount: pairs.length, missingRoundCount, unpairedRounds, duplicateRounds},
      pairs,
    };
  });
  return {
    runCount: valid.length,
    droppedRunCount: input.length - valid.length,
    caseCount: cases.length,
    pairedRoundCount: cases.reduce((sum, entry) => sum + entry.pairing.pairedRoundCount, 0),
    notes: [
      'Descriptive results only; a small number of runs does not establish statistical significance.',
      'Positive percent change means an increase. Lower frame times and higher FPS are better.',
      'Engine summaries include unpaired runs; paired summaries exclude missing or duplicate rounds.',
      'Percent change is undefined (null) when the old baseline is zero.',
    ],
    cases,
  };
}
