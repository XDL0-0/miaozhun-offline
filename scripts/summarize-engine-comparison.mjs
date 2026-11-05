// Aggregate the fixed, paired native-engine benchmark; never starts a benchmark.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {summarizePairedRuns} from './engine-comparison-metrics.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const defaults = {
  base: path.join(repo, 'local-data/engine-comparison-2026-11-05'),
  output: path.join(repo, 'docs/engine-comparison-2026-11-05'),
};
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (a, b) => canonical(a) === canonical(b);
const assert = (condition, message) => { if (!condition) throw Error(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const runKey = run => JSON.stringify([run.caseId, run.round, run.engine]);
const safe = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const format = (value, digits = 2) => value === null || value === undefined ? '—' : value.toFixed(digits);
const percent = value => value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${format(value)}%`;
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const metricDefinitions = [
  ['averageFps', '平均 FPS', 2, 'higher-is-better', run => run.metrics?.averageFps],
  ['onePercentLowFps', '1% low FPS', 2, 'higher-is-better', run => run.metrics?.onePercentLowFps],
  ['p99FrameMs', 'P99 帧间隔（ms）', 3, 'lower-is-better', run => run.metrics?.p99FrameMs],
  ['renderSubmitMeanMs', '渲染提交 CPU（ms/次）', 3, 'lower-is-better', run => run.cpu?.renderSubmit?.mean],
  ['tickMeanMs', '逻辑 tick CPU（ms/次）', 3, 'lower-is-better', run => run.cpu?.tick?.mean],
  ['drawCallsMean', 'draw calls/帧', 1, 'context-only', run => run.draw?.calls?.mean],
  ['trianglesMean', '三角形/帧', 0, 'context-only', run => run.draw?.triangles?.mean],
  ['stuttersOver33_333Ms', '>33.333 ms 次数', 0, 'lower-is-better', run => run.metrics?.stutterCounts?.over33_333Ms],
  ['stuttersOver50Ms', '>50 ms 次数', 0, 'lower-is-better', run => run.metrics?.stutterCounts?.over50Ms],
  ['stuttersOver100Ms', '>100 ms 次数', 0, 'lower-is-better', run => run.metrics?.stutterCounts?.over100Ms],
];
const validationKeys = ['completed', 'noErrors', 'enoughFrames', 'sampleCoverage', 'elapsed', 'simulation', 'phase', 'buffer', 'noCapture', 'unthrottled', 'nativeSkin'];
const environmentKeys = ['userAgent', 'hardwareConcurrency', 'deviceMemory', 'devicePixelRatio', 'buffer', 'gpuVendor', 'gpuRenderer', 'context'];
const environmentSignature = environment => Object.fromEntries(environmentKeys.map(key => [key, environment[key]]));
const pairEnvironmentSignature = environment => ({
  ...environmentSignature(environment),
  context: Object.fromEntries(Object.entries(environment.context).filter(([key]) => key !== 'stencil')),
});
const nativeStencilDefaults = {old: false, new: true};
const defaultLabels = {
  'engine-migration': {old: '旧引擎', new: '新引擎'},
  optimization: {old: '优化前', new: '优化后'},
};
const gpuTimingSummary = ({samplesMs, ...diagnostics}) => diagnostics;

function argumentsFor(argv) {
  const result = {...defaults};
  let positional = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return {help: true};
    if (argument === '--output' || argument === '--base') {
      assert(argv[index + 1] && !argv[index + 1].startsWith('--'), `${argument} requires a directory`);
      result[argument.slice(2)] = path.resolve(argv[++index]);
    } else if (argument.startsWith('--output=') || argument.startsWith('--base=')) {
      const separator = argument.indexOf('=');
      assert(argument.length > separator + 1, `${argument.slice(0, separator)} requires a directory`);
      result[argument.slice(2, separator)] = path.resolve(argument.slice(separator + 1));
    } else {
      assert(!argument.startsWith('-') && !positional, `Unexpected argument: ${argument}`);
      result.base = path.resolve(argument);
      positional = true;
    }
  }
  return result;
}

function readJson(filename) {
  const bytes = fs.readFileSync(filename);
  try { return {value: JSON.parse(bytes.toString('utf8')), bytes, sha256: sha256(bytes)}; }
  catch (error) { throw Error(`Invalid JSON in ${filename}: ${error.message}`); }
}

function validateEnvironment(environment, label, plan) {
  assert(isObject(environment), `${label}: missing environment`);
  for (const key of environmentKeys) assert(Object.hasOwn(environment, key), `${label}: missing environment.${key}`);
  for (const key of ['userAgent', 'gpuVendor', 'gpuRenderer']) {
    assert(typeof environment[key] === 'string' && environment[key].length > 0, `${label}: invalid environment.${key}`);
  }
  assert(isObject(environment.context), `${label}: invalid WebGL context attributes`);
  assert(same(environment.buffer, [plan.width, plan.height]), `${label}: unexpected drawing buffer`);
  assert(environment.visibility === 'visible', `${label}: document was not visible`);
  assert(environment.fullscreen === false && environment.pointerLocked === false, `${label}: fullscreen or pointer lock enabled`);
}

export function validateComparison(base) {
  const planFile = readJson(path.join(base, 'plan.json'));
  const plan = planFile.value;
  assert(plan.seed === 20261105 && plan.width === 1280 && plan.height === 720
    && plan.warmupSeconds === 5 && plan.measureSeconds === 15, 'Plan does not match the fixed benchmark protocol');
  assert(Array.isArray(plan.plan) && plan.plan.length === 12, 'Plan must contain exactly 12 runs');
  assert(Array.isArray(plan.cases) && same(plan.cases.map(test => test.id).sort(), ['ascent', 'plummet']), 'Plan must contain ascent and plummet exactly once');
  const benchmarkKind = plan.benchmarkKind ?? 'engine-migration';
  assert(Object.hasOwn(defaultLabels, benchmarkKind), 'Unknown benchmark kind');
  assert(plan.gpuTiming === undefined || typeof plan.gpuTiming === 'boolean', 'Invalid GPU timing configuration');
  const labels = plan.labels ?? defaultLabels[benchmarkKind];
  assert(isObject(labels) && ['old', 'new'].every(engine => typeof labels[engine] === 'string' && labels[engine].trim()), 'Invalid benchmark labels');
  const caseMap = new Map(plan.cases.map(test => [test.id, test]));
  for (const test of plan.cases) {
    assert(isObject(test.scene) && sha256(JSON.stringify(test.scene)) === test.sceneHash, `${test.id}: scene hash mismatch in plan`);
  }
  const expectedKeys = new Set();
  for (const entry of plan.plan) {
    assert(caseMap.has(entry.caseId) && [1, 2, 3].includes(entry.round) && ['old', 'new'].includes(entry.engine), 'Invalid plan entry');
    assert(!expectedKeys.has(runKey(entry)), `Duplicate plan entry: ${runKey(entry)}`);
    expectedKeys.add(runKey(entry));
  }
  const expectedFiles = plan.plan.map((entry, index) => `${String(index).padStart(2, '0')}-${entry.engine}.json`);
  const resultsDir = path.join(base, 'results');
  const actualFiles = fs.readdirSync(resultsDir).filter(filename => filename.endsWith('.json')).sort();
  assert(same(actualFiles, [...expectedFiles].sort()), `Result set differs from plan. Missing: ${expectedFiles.filter(file => !actualFiles.includes(file)).join(', ') || 'none'}; unexpected: ${actualFiles.filter(file => !expectedFiles.includes(file)).join(', ') || 'none'}`);

  const engineConfigs = {};
  const nativeStencil = {};
  const hashes = {plan: planFile.sha256, engines: {}};
  for (const engine of ['old', 'new']) {
    const configFile = readJson(path.join(base, engine, '__engine-config.json'));
    const config = configFile.value;
    assert(config.engine === engine && same(config.plan, plan.plan), `${engine}: isolated configuration does not match plan`);
    for (const key of ['seed', 'width', 'height', 'warmupSeconds', 'measureSeconds', 'cases']) {
      assert(same(config[key], plan[key]), `${engine}: isolated configuration differs at ${key}`);
    }
    assert((config.benchmarkKind ?? 'engine-migration') === benchmarkKind, `${engine}: isolated configuration differs at benchmarkKind`);
    assert(same(config.labels ?? defaultLabels[benchmarkKind], labels), `${engine}: isolated configuration differs at labels`);
    assert((config.gpuTiming ?? false) === (plan.gpuTiming ?? false), `${engine}: isolated configuration differs at gpuTiming`);
    nativeStencil[engine] = config.nativeStencil ?? nativeStencilDefaults[engine];
    assert(typeof nativeStencil[engine] === 'boolean', `${engine}: invalid native stencil configuration`);
    if (benchmarkKind === 'optimization') assert(config.nativeStencil === true, `${engine}: optimization requires explicit native stencil=true`);
    else if (plan.benchmarkKind !== undefined || config.benchmarkKind !== undefined) assert(typeof config.nativeStencil === 'boolean', `${engine}: missing explicit native stencil configuration`);
    assert(/^[a-f0-9]{64}$/.test(config.originalGameHash), `${engine}: invalid original engine hash`);
    if (config.originalWorldHash !== undefined) assert(/^[a-f0-9]{64}$/.test(config.originalWorldHash), `${engine}: invalid original world hash`);
    if (config.actorRenderer) {
      assert(/^[a-f0-9]{64}$/.test(config.originalActorRendererHash), `${engine}: invalid actor renderer hash`);
      assert(sha256(fs.readFileSync(path.join(base, engine, 'js', config.actorRenderer))) === config.originalActorRendererHash,
        `${engine}: actor renderer changed after benchmark preparation`);
    }
    engineConfigs[engine] = config;
    hashes.engines[engine] = {
      originalGame: config.originalGameHash,
      ...(config.originalWorldHash === undefined ? {} : {originalWorld: config.originalWorldHash}),
      ...(config.actorRenderer ? {actorRenderer: config.originalActorRendererHash} : {}),
      instrumentedWorld: sha256(fs.readFileSync(path.join(base, engine, 'js', config.world))),
      instrumentedGame: sha256(fs.readFileSync(path.join(base, engine, 'js', config.game))),
      config: configFile.sha256,
      runtime: sha256(fs.readFileSync(path.join(base, engine, '__engine-benchmark.mjs'))),
      metrics: sha256(fs.readFileSync(path.join(base, engine, '__engine-metrics.mjs'))),
      renderStats: sha256(fs.readFileSync(path.join(base, engine, '__engine-render-stats.mjs'))),
    };
  }
  for (const file of ['runtime', 'metrics', 'renderStats']) {
    assert(hashes.engines.old[file] === hashes.engines.new[file], `Old/new benchmark ${file} differs`);
  }
  const expectedConfiguration = {
    width: plan.width, height: plan.height, warmupSeconds: plan.warmupSeconds, measureSeconds: plan.measureSeconds,
    samplingClock: 'simulation',
    audio: false, skin: 'native default', shadows: true, lowLatency: false, renderScale: 1,
    frameMode: 'refresh', maxFps: 0, sensitivity: .5, viewModelFov: 70,
  };
  const seen = new Set();
  const records = expectedFiles.map((filename, index) => {
    const file = readJson(path.join(resultsDir, filename));
    const run = file.value, expected = plan.plan[index];
    assert(isObject(run) && run.runIndex === index && runKey(run) === runKey(expected), `${filename}: identity differs from plan`);
    assert(!seen.has(runKey(run)), `${filename}: duplicate run`);
    seen.add(runKey(run));
    assert(run.valid === true && run.reason === 'completed', `${filename}: run was not valid/completed`);
    assert(isObject(run.validation) && validationKeys.every(key => run.validation[key] === true)
      && Object.values(run.validation).every(value => value === true), `${filename}: validation did not pass`);
    assert(Array.isArray(run.errors) && run.errors.length === 0, `${filename}: run contains errors`);
    const test = caseMap.get(run.caseId);
    assert(run.sceneHash === test.sceneHash && run.seed === plan.seed, `${filename}: scene/seed differs from plan`);
    assert(run.engineHash === engineConfigs[run.engine].originalGameHash, `${filename}: original engine hash differs from isolated configuration`);
    assert(run.spawners === test.spawners && run.actorTemplates === test.actorTemplates, `${filename}: scene population metadata differs from plan`);
    assert(same(run.configuration, expectedConfiguration), `${filename}: configuration differs from fixed protocol`);
    assert(Number.isFinite(run.sampleSimulationSeconds) && Math.abs(run.sampleSimulationSeconds - plan.measureSeconds) <= .05,
      `${filename}: simulation sample duration differs from 15 seconds`);
    assert(Number.isFinite(run.simulationSeconds) && Math.abs(run.simulationSeconds - plan.warmupSeconds - plan.measureSeconds) <= .05,
      `${filename}: total simulation duration differs from 20 seconds`);
    assert(Number.isFinite(run.sampleWallSeconds) && run.sampleWallSeconds >= plan.measureSeconds - .1,
      `${filename}: wall-clock sample duration is too short`);
    assert(Number.isFinite(run.sampleCoverageSeconds) && run.sampleCoverageSeconds >= plan.measureSeconds - .1,
      `${filename}: render sample coverage is too short`);
    assert(Number.isInteger(run.sampleStartTick) && run.sampleStartTick >= 0 && Number.isInteger(run.sampleEndTick)
      && run.sampleEndTick > run.sampleStartTick, `${filename}: invalid simulation sample tick bounds`);
    assert(Number.isFinite(run.elapsedSeconds) && run.elapsedSeconds >= run.sampleWallSeconds,
      `${filename}: invalid total wall-clock elapsed time`);
    assert(run.skinStorage === null, `${filename}: custom skin storage was present`);
    validateEnvironment(run.environment, filename, plan);
    validateEnvironment(run.finalEnvironment, `${filename} final`, plan);
    assert(run.environment.context.stencil === nativeStencil[run.engine], `${filename}: unexpected native stencil setting`);
    assert(same(environmentSignature(run.environment), environmentSignature(run.finalEnvironment)), `${filename}: environment changed during run`);
    assert(Array.isArray(run.events) && !run.events.some(event => event.visibility !== 'visible'), `${filename}: hidden document event`);
    assert(Number.isInteger(run.metrics?.sampleCount) && run.metrics.sampleCount >= 60 && run.metrics.droppedSampleCount === 0, `${filename}: invalid frame samples`);
    assert(Number.isFinite(run.metrics.minFrameMs) && run.metrics.minFrameMs > 0 && Number.isFinite(run.metrics.maxFrameMs)
      && run.metrics.maxFrameMs >= run.metrics.minFrameMs, `${filename}: invalid frame interval range`);
    for (const [label, samples] of [['tick CPU', run.cpu?.tick], ['render CPU', run.cpu?.renderSubmit], ['draw calls', run.draw?.calls], ['triangles', run.draw?.triangles]]) {
      assert(samples?.count > 0 && samples.droppedSampleCount === 0 && Number.isFinite(samples.min)
        && samples.min >= 0 && Number.isFinite(samples.max) && samples.max >= samples.min, `${filename}: invalid ${label} samples`);
    }
    if (run.gpuPacing !== undefined) {
      const pacing = run.gpuPacing;
      assert(isObject(pacing) && Number.isInteger(pacing.checks) && pacing.checks >= 0
        && Number.isInteger(pacing.blocked) && pacing.blocked >= 0 && pacing.blocked <= pacing.checks,
      `${filename}: invalid GPU pacing counts`);
      assert(pacing.storage === null && pacing.statsStart?.maxInFlight === 2 && pacing.statsEnd?.maxInFlight === 2,
        `${filename}: GPU pacing differs from the native two-frame budget`);
      if (pacing.cpuMs?.count > 0) assert(Number.isFinite(pacing.cpuMs.mean)
        && pacing.cpuMs.mean >= 0, `${filename}: invalid GPU pacing CPU summary`);
    }
    if (run.gpuTiming !== undefined) {
      assert(isObject(run.gpuTiming), `${filename}: invalid GPU timing diagnostics`);
      if (run.gpuTiming.enabled !== undefined) assert(run.gpuTiming.enabled === (plan.gpuTiming ?? false), `${filename}: GPU timing mode differs from plan`);
    }
    const metrics = Object.fromEntries(metricDefinitions.map(([name, , , , get]) => {
      const value = get(run);
      assert(Number.isFinite(value) && value >= 0, `${filename}: invalid ${name}`);
      if (name.startsWith('stutters')) assert(Number.isInteger(value) && value <= run.metrics.sampleCount, `${filename}: invalid stutter count`);
      return [name, value];
    }));
    return {filename, ...file, metrics};
  });
  const pairs = [];
  for (const test of plan.cases) for (const round of [1, 2, 3]) {
    const pair = records.filter(record => record.value.caseId === test.id && record.value.round === round);
    assert(pair.length === 2 && new Set(pair.map(record => record.value.engine)).size === 2, `${test.id} round ${round}: incomplete or duplicate pair`);
    const [a, b] = pair.map(record => record.value);
    for (const key of ['sceneHash', 'seed', 'configuration']) assert(same(a[key], b[key]), `${test.id} round ${round}: mismatched ${key}`);
    assert(same(pairEnvironmentSignature(a.environment), pairEnvironmentSignature(b.environment)), `${test.id} round ${round}: environment mismatch outside the configured native stencil settings`);
    pairs.push({caseId: test.id, round, files: pair.map(record => record.filename), matched: true,
      allowedNativeContextDifference: nativeStencil.old === nativeStencil.new ? null : {stencil: nativeStencil}});
  }
  return {plan, planFile, records, hashes, pairs, benchmarkKind, labels, nativeStencil};
}

export function reportFor(summary, base, output) {
  const {plan, configuration, environments, cases} = summary;
  const {benchmarkKind, labels, nativeStencil} = summary;
  const optimization = benchmarkKind === 'optimization';
  const hasPacing = summary.runs.some(run => run.gpuPacing !== undefined);
  const hasGpuTiming = summary.runs.some(run => run.gpuTiming !== undefined);
  const enabledGpuTiming = summary.runs.some(run => run.gpuTiming?.enabled === true);
  const wallTimes = summary.runs.map(run => run.sampleWallSeconds);
  const result = (id, metric) => cases.find(entry => entry.caseId === id).comparisons[metric].percentChange;
  const auditPath = path.join(base, 'environment-audit.json');
  const hasAudit = fs.existsSync(auditPath);
  const rafRange = summary.runs.map(run => run.rafMetrics.averageFps);
  const submittedRange = summary.runs.map(run => run.metrics.averageFps);
  const simulationTimes = summary.runs.map(run => run.sampleSimulationSeconds);
  const lines = [
    optimization ? '# 新引擎优化前后固定场景性能对比' : '# 新旧引擎固定场景性能对比', '',
    `${safe(labels.new)}相对${safe(labels.old)}的三轮中位数变化：亚海悬城渲染提交 CPU ${percent(result('ascent','renderSubmitMeanMs'))}、1% low ${percent(result('ascent','onePercentLowFps'))}；天枢云阙渲染提交 CPU ${percent(result('plummet','renderSubmitMeanMs'))}、1% low ${percent(result('plummet','onePercentLowFps'))}。CPU 提交更快不等于画面更流畅，应结合每轮波动判断。`, '',
    `全部 ${summary.runCount} 组结果通过校验：2 个场景，每场景 3 对；第 1、3 轮 old → new，第 2 轮 new → old。以下为描述性结果，不作统计显著性结论。`, '',
    optimization
      ? `比较对象为同一新引擎的优化前、后构建，old 表示${safe(labels.old)}，new 表示${safe(labels.new)}。结果对应本次整组改动，不能分别归因于某一项优化。本次不包含压力测试或原生无限帧率测量，预跑（pilot）不纳入统计。`
      : '比较对象为升级包整体，包含引擎与地图资源的版本变化；即使场景文档相同，也不能把差异因果归因于某段引擎代码或某个新增功能。旧版已有 batching/PVS。本次不包含压力测试或原生无限帧率测量，预跑（pilot）不纳入统计。', '',
    `测试在后台不展示的 Codex 内置浏览器（IAB）运行，但采样首尾及事件记录中的 document.visibilityState 均为 visible，以避免隐藏文档节流。绘图缓冲为 ${configuration.width}×${configuration.height}；每组 ${configuration.warmupSeconds} 秒模拟预热 + ${configuration.measureSeconds} 秒模拟采样，固定场景和随机种子 ${plan.seed}。采样以模拟时钟为准，首帧就绪前的启动暂停不计入这 5 秒模拟预热；记录实际墙钟时长，不按墙钟恰好 15 秒筛除慢帧。`, '',
    `实际采样墙钟时长为 ${format(Math.min(...wallTimes), 3)}–${format(Math.max(...wallTimes), 3)} 秒，模拟时长为 ${format(Math.min(...simulationTimes), 3)}–${format(Math.max(...simulationTimes), 3)} 秒。每组模拟采样时长须在 15±0.05 秒、总模拟时长在 20±0.05 秒内，采样墙钟与首末渲染跨度均须至少 14.9 秒；墙钟没有 15/20 秒上限。`, '',
    nativeStencil.old === nativeStencil.new
      ? `两组保留相同的原生 WebGL context 设置，stencil=${nativeStencil.old}；每对测试的 GPU、UA、缓冲尺寸及全部 context 属性严格一致。`
      : `保留各组配置中的原生 WebGL context 设置：old stencil=${nativeStencil.old}，new stencil=${nativeStencil.new}。每对测试的 GPU、UA、缓冲尺寸及其余 context 属性严格一致。stencil 差异属于比较构建的一部分，结果不能解释为隔离 stencil 后的纯引擎代码效应。`, '',
    '两版都使用 requestAnimationFrame 调度，当前环境约受 60 Hz 限制；这里的 FPS 是渲染回调间隔指标，不能推断原生无限帧率上限。CPU 数值仅覆盖逻辑 tick 和渲染提交的同步耗时，不包含异步 GPU 完成时间，也不是全进程 CPU 利用率。', '',
    `所有有效样本均保留：各轮原生绘制提交频率为 ${format(Math.min(...submittedRange))}–${format(Math.max(...submittedRange))} 次/秒，独立 RAF 回调为 ${format(Math.min(...rafRange))}–${format(Math.max(...rafRange))} 次/秒。原生调度保留 GPU fence 队列限流（默认最多 2 帧在途），可在进入渲染回调之前跳过绘制；这与 CPU 提交耗时降低可以同时发生。${hasPacing ? '下方列出已记录的队列检查及阻止提交次数；检查的 CPU 耗时不是 GPU 执行时间。' : '本次没有直接计数队列阻止提交次数。'}${enabledGpuTiming ? '附带的 GPU timer 诊断仅描述被查询的命令段，不能解释为整帧完成或显示器呈现时间。' : '本次 GPU timer 未启用，没有 GPU 执行时间样本。'}不能单凭这些诊断断定 GPU 算力瓶颈或归因于某个改动。`, '',
    hasAudit ? '测试后的隔离端口存储核对见 [environment-audit.json](environment-audit.json)；这不属于逐帧遥测。' : '本次未附测试后的隔离端口存储核对记录。', '',
    '音频及回放录制关闭，原生外观和默认 Vandal 枪械；无全屏、无指针锁定。输入脚本包含转向、开火、换弹、切换武器和检视，不包含玩家移动。阴影开启，renderScale=1，lowLatency=false。', '',
    ...environments.map((environment, index) => `环境 ${index + 1}：GPU 为 \`${safe(environment.gpuRenderer)}\`；厂商 \`${safe(environment.gpuVendor)}\`；devicePixelRatio=${environment.devicePixelRatio}，hardwareConcurrency=${environment.hardwareConcurrency}，deviceMemory=${environment.deviceMemory ?? '未提供'}。UA：\`${safe(environment.userAgent)}\`。`), '',
    '表中数值为 3 轮中位数［各轮最小值–最大值］；变化率为 (new 中位数 − old 中位数) / |old 中位数|。CPU、帧间隔和卡顿次数越低越好，FPS 越高越好，draw calls/三角形仅描述提交量。old 为 0 时变化率不定义。', '',
  ];
  for (const entry of cases) {
    const test = plan.cases.find(item => item.id === entry.caseId);
    lines.push(`**${safe(test.name)}（${entry.caseId}）**`, '', '| 指标 | old 中位数［范围］ | new 中位数［范围］ | new 相对 old |', '| --- | ---: | ---: | ---: |');
    for (const [metric, label, digits] of metricDefinitions) {
      const cell = engine => {
        const value = entry.engines[engine][metric];
        return `${format(value.median, digits)}［${format(value.min, digits)}–${format(value.max, digits)}］`;
      };
      lines.push(`| ${label} | ${cell('old')} | ${cell('new')} | ${percent(entry.comparisons[metric].percentChange)} |`);
    }
    const render = entry.comparisons.renderSubmitMeanMs.pairedPercentChange;
    const tick = entry.comparisons.tickMeanMs.pairedPercentChange;
    const paired = value => value ? `${percent(value.median)}［${percent(value.min)}–${percent(value.max)}］` : '基线为 0，未定义';
    lines.push('', `按相同轮次配对计算的 CPU 变化中位数［范围］：渲染提交 ${paired(render)}；逻辑 tick ${paired(tick)}。`, '');
  }
  lines.push('每组明细（CPU、draw calls 和三角形均为该组样本均值；帧间隔范围来自该组原始渲染采样）：', '',
    '| 场景 / 轮次 / 引擎 | 采样墙钟 s | 平均 FPS | 1% low | P99 ms | 帧间隔范围 ms | 渲染 CPU ms | tick CPU ms | calls / 三角形 | >33.333 / >50 / >100 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const run of summary.runs) {
    const m = run.metrics;
    lines.push(`| [${run.caseId} / ${run.round} / ${run.engine}](raw/${run.file}) | ${format(run.sampleWallSeconds, 3)} | ${format(m.averageFps)} | ${format(m.onePercentLowFps)} | ${format(m.p99FrameMs, 3)} | ${format(run.observedRanges.renderIntervalMs.min, 3)}–${format(run.observedRanges.renderIntervalMs.max, 3)} | ${format(m.renderSubmitMeanMs, 3)} | ${format(m.tickMeanMs, 3)} | ${format(m.drawCallsMean, 1)} / ${format(m.trianglesMean, 0)} | ${m.stuttersOver33_333Ms} / ${m.stuttersOver50Ms} / ${m.stuttersOver100Ms} |`);
  }
  if (hasPacing) {
    lines.push('', 'GPU 队列诊断（仅包含有记录的组；blocked 表示调度器阻止提交，不是慢帧数量）：', '',
      '| 场景 / 轮次 / 构建 | 检查次数 | 阻止提交次数 | 阻止占比 | 检查 CPU 均值 ms |',
      '| --- | ---: | ---: | ---: | ---: |');
    for (const run of summary.runs.filter(run => run.gpuPacing !== undefined)) {
      const pacing = run.gpuPacing;
      lines.push(`| ${run.caseId} / ${run.round} / ${safe(labels[run.engine])} | ${pacing.checks} | ${pacing.blocked} | ${pacing.checks ? format(pacing.blocked / pacing.checks * 100) + '%' : '—'} | ${format(pacing.cpuMs?.mean, 4)} |`);
    }
    lines.push('', '采样起止统计快照、存储设置及 CPU 汇总按原记录保存在 summary.json 的各组 gpuPacing 字段中。');
  }
  if (hasGpuTiming) {
    lines.push('', '<details>', '<summary>各组 GPU timer 诊断</summary>', '',
      enabledGpuTiming ? '以下保留采样器输出；计时覆盖被查询的命令段，未测量整帧完成、合成器或显示器呈现。' : 'GPU timer 未启用；仅保留状态元数据，没有 GPU 执行时间样本。', '', '```json',
      JSON.stringify(summary.runs.filter(run => run.gpuTiming !== undefined).map(run => ({caseId: run.caseId, round: run.round, engine: run.engine, gpuTiming: run.gpuTiming})), null, 2),
      '```', '', '</details>');
  }
  lines.push('', '平均 FPS = 1000 / 平均帧间隔；1% low = 1000 / 最慢 ceil(N×1%) 个帧间隔的均值，不等于 1000/P99。P99 使用线性插值分位数。卡顿为严格大于阈值的帧间隔数。三轮范围不代表置信区间。完整配置、WebGL context 属性、每组样本范围、配对变化及原始数据 SHA-256 见 [summary.json](summary.json)。', '',
    `计划 SHA-256：\`${summary.hashes.plan}\`。`,
    ...['old', 'new'].map(engine => `${engine} 原始游戏模块 SHA-256：\`${summary.hashes.engines[engine].originalGame}\`。`),
    ...['old', 'new'].filter(engine => summary.hashes.engines[engine].originalWorld).map(engine => `${engine} 原始地图渲染模块 SHA-256：\`${summary.hashes.engines[engine].originalWorld}\`。`),
    ...['old', 'new'].filter(engine => summary.hashes.engines[engine].actorRenderer).map(engine => `${engine} 角色渲染模块 SHA-256：\`${summary.hashes.engines[engine].actorRenderer}\`。`),
    ...plan.cases.map(test => `${test.id} 场景 SHA-256：\`${test.sceneHash}\`。`),
    `共同采样 runtime SHA-256：\`${summary.hashes.engines.old.runtime}\`；共同 metrics SHA-256：\`${summary.hashes.engines.old.metrics}\`。`, '',
    '重新汇总已有结果：', '', '```bash', `node scripts/summarize-engine-comparison.mjs ${shellQuote(base)} --output ${shellQuote(output)}`, '```', '',
    '重跑需要一个尚不存在的隔离目录；以下服务启动后，在后台不展示的 IAB 中打开首组 URL，并保持文档 visible。12 组会按计划自动跳转；全部完成后再汇总。', '', '```bash',
    (optimization
      ? "node scripts/create-engine-comparison.mjs --before='<保存的优化前构建目录>' --after='<保存的优化后构建目录>' --output=local-data/engine-comparison-reproduction"
      : 'node scripts/create-engine-comparison.mjs --output=local-data/engine-comparison-reproduction') + (plan.gpuTiming ? ' --gpu-timing' : ''),
    'node scripts/serve-engine-comparison.mjs local-data/engine-comparison-reproduction',
    '# 以后台不展示的 IAB 打开 http://127.0.0.1:18820/__engine-benchmark.html?run=0',
    '# 所有 12 组完成后，另一个终端执行：',
    'node scripts/summarize-engine-comparison.mjs local-data/engine-comparison-reproduction --output docs/engine-comparison-reproduction', '```', '',
    optimization
      ? '复现时将目录占位符替换为保存的优化前、后构建，使用同一采样脚本并先核对上述哈希。后台测试仍会占用真实 CPU/GPU，本报告只适用于这些固定场景与设置。'
      : '复现依赖原始备份、当前构建及同一采样脚本；先核对上述哈希。后台测试仍会占用真实 CPU/GPU，本报告只适用于这些固定场景与设置。', '');
  return lines.join('\n');
}

export function aggregateComparison(base) {
  const {plan, records, hashes, pairs, benchmarkKind, labels, nativeStencil} = validateComparison(base);
  const aggregated = summarizePairedRuns(records.map(({value: run, metrics}) => ({engine: run.engine, caseId: run.caseId, round: run.round, metrics})));
  assert(aggregated?.runCount === 12 && aggregated.droppedRunCount === 0 && aggregated.pairedRoundCount === 6
    && aggregated.cases.every(entry => entry.pairing.pairedRoundCount === 3 && entry.pairing.missingRoundCount === 0
      && entry.pairing.unpairedRounds.length === 0 && entry.pairing.duplicateRounds.length === 0), 'Aggregation produced incomplete pairs');
  for (const entry of aggregated.cases) for (const [name, , , direction] of metricDefinitions) entry.comparisons[name].direction = direction;
  const environments = [...new Map(records.map(({value: run}) => {
    const signature = environmentSignature(run.environment);
    return [canonical(signature), signature];
  })).values()];
  const summary = {
    schemaVersion: 3, generatedAt: new Date().toISOString(), sourceDirectory: base,
    benchmarkKind, labels, nativeStencil,
    validation: {valid: true, plannedRunCount: 12, pairs},
    environmentComparability: {
      matchedProperties: environmentKeys,
      exception: nativeStencil.old === nativeStencil.new ? null : {property: 'context.stencil', nativeDefaults: nativeStencil,
        reason: 'Configured native stencil settings are preserved; all other context properties must match within each pair.'},
    },
    plan: {...plan, benchmarkKind, labels, cases: plan.cases.map(({scene, ...test}) => test)},
    configuration: records[0].value.configuration, environments, hashes,
    metricDefinitions: Object.fromEntries(metricDefinitions.map(([name, label, , direction]) => [name, {label, direction}])),
    ...aggregated,
    runs: records.map(({filename, value: run, sha256: hash, bytes, metrics}) => ({
      file: filename, sha256: hash, bytes: bytes.length, runIndex: run.runIndex,
      caseId: run.caseId, round: run.round, engine: run.engine, sceneHash: run.sceneHash, engineHash: run.engineHash,
      valid: run.valid, validation: run.validation, sampleCount: run.metrics.sampleCount,
      sampleStartTick: run.sampleStartTick, sampleEndTick: run.sampleEndTick,
      sampleWallSeconds: run.sampleWallSeconds, sampleSimulationSeconds: run.sampleSimulationSeconds,
      sampleCoverageSeconds: run.sampleCoverageSeconds, elapsedSeconds: run.elapsedSeconds,
      simulationSeconds: run.simulationSeconds, inputTicks: run.inputTicks, metrics,
      rafMetrics: run.rafMetrics, environment: run.environment, finalEnvironment: run.finalEnvironment,
      ...(run.gpuPacing === undefined ? {} : {gpuPacing: run.gpuPacing}),
      ...(run.gpuTiming === undefined ? {} : {gpuTiming: gpuTimingSummary(run.gpuTiming)}),
      observedRanges: {
        renderIntervalMs: {min: run.metrics.minFrameMs, max: run.metrics.maxFrameMs},
        tickCpuMs: {min: run.cpu.tick.min, max: run.cpu.tick.max},
        renderSubmitCpuMs: {min: run.cpu.renderSubmit.min, max: run.cpu.renderSubmit.max},
        drawCalls: {min: run.draw.calls.min, max: run.draw.calls.max},
        triangles: {min: run.draw.triangles.min, max: run.draw.triangles.max},
      },
    })),
  };
  return {summary, records};
}

function main() {
  const args = argumentsFor(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/summarize-engine-comparison.mjs [BASE] [--base BASE] [--output OUTPUT]\nDefaults: local-data/engine-comparison-2026-11-05 → docs/engine-comparison-2026-11-05\nValidates all 12 planned runs before writing raw/*.json, summary.json, and report.md.');
    return;
  }
  const {base, output} = args;
  assert(output !== base && !output.startsWith(base + path.sep), 'Output must be outside the benchmark source directory');
  const {summary, records} = aggregateComparison(base);
  const rawDirectory = path.join(output, 'raw');
  if (fs.existsSync(rawDirectory)) {
    const expected = new Set(records.map(record => record.filename));
    assert(fs.readdirSync(rawDirectory).every(filename => expected.has(filename)), 'Output/raw contains unrelated files; choose a fresh output directory');
  }
  const report = reportFor(summary, base, output);
  // No output is created until every input, pair, and aggregate passes validation.
  fs.mkdirSync(rawDirectory, {recursive: true});
  if (fs.existsSync(path.join(base, 'environment-audit.json'))) fs.copyFileSync(path.join(base, 'environment-audit.json'), path.join(output, 'environment-audit.json'));
  for (const record of records) fs.writeFileSync(path.join(rawDirectory, record.filename), record.bytes);
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'report.md'), report);
  console.log(`Validated ${summary.runCount} runs / ${summary.pairedRoundCount} pairs. Wrote ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(`Engine comparison aggregation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
