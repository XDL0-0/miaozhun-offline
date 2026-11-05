#!/usr/bin/env node
/**
 * Capture only scenes explicitly listed in a public workshop catalog.
 * Node >= 20; no dependencies, cookies, credentials, or private API calls.
 *
 * node scripts/sync-upstream-scenes.mjs \
 *   --catalog upstream/aimpro-2026-11-05/workshop.json \
 *   --output-dir upstream/aimpro-2026-11-05 \
 *   --baseline-dir site/prod-api/api/v1/public/val/aimlab/scenes
 *
 * --offline regenerates and validates exports from captured responses only.
 * --reuse skips valid captured responses and fetches only missing/invalid ones.
 * Scene status compares parsed documents, ignoring object key order and live
 * play counts. Response/metadata changes are reported separately.
 */
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ENDPOINT = 'https://aimpro.world/prod-api/api/v1/public/val/aimlab/scenes/';
const args = process.argv.slice(2);
const options = {
  catalog: 'upstream/aimpro-2026-11-05/workshop.json',
  'output-dir': 'upstream/aimpro-2026-11-05',
  'baseline-dir': 'site/prod-api/api/v1/public/val/aimlab/scenes',
  concurrency: 4,
  retries: 2,
  'timeout-ms': 25000,
  offline: false,
  reuse: false,
};
for (let i = 0; i < args.length; i += 1) {
  const name = args[i].replace(/^--/, '');
  if (name === 'help') {
    console.log('Usage: node scripts/sync-upstream-scenes.mjs [--catalog FILE] [--output-dir DIR] [--baseline-dir DIR] [--concurrency 1..4] [--retries 0..3] [--timeout-ms 1000..120000] [--reuse | --offline]');
    process.exit(0);
  }
  if (!args[i].startsWith('--') || !Object.hasOwn(options, name)) throw new Error(`Unknown option: ${args[i]}`);
  if (typeof options[name] === 'boolean') options[name] = true;
  else {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: --${name}`);
    options[name] = typeof options[name] === 'number' ? Number(args[++i]) : args[++i];
  }
}
for (const [name, min, max] of [['concurrency', 1, 4], ['retries', 0, 3], ['timeout-ms', 1000, 120000]]) {
  if (!Number.isInteger(options[name]) || options[name] < min || options[name] > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
}
const outputDir = path.resolve(options['output-dir']);
const scenesDir = path.join(outputDir, 'scenes');
const baselineDir = path.resolve(options['baseline-dir']);
if (baselineDir === scenesDir) throw new Error('Output scenes and baseline directory must differ');
const startedAt = new Date().toISOString();
const catalogText = await readFile(options.catalog, 'utf8');
const catalog = JSON.parse(catalogText);
if (catalog.code !== '00000' || !Array.isArray(catalog.data)) throw new Error('Expected successful workshop envelope with data[]');
const seenCodes = new Set();
for (const item of catalog.data) {
  if (typeof item.shareCode !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.shareCode)) throw new Error('Catalog contains an unsafe or invalid shareCode');
  if (seenCodes.has(item.shareCode)) throw new Error(`Duplicate catalog shareCode: ${item.shareCode}`);
  seenCodes.add(item.shareCode);
}
await mkdir(scenesDir, { recursive: true });
let previousCaptureReports = new Map();
try {
  const previousSummary = JSON.parse(await readFile(path.join(outputDir, 'scene-diff.json'), 'utf8'));
  previousCaptureReports = new Map((previousSummary.scenes || []).map((scene) => [scene.shareCode, scene]));
} catch (error) {
  if (error.code !== 'ENOENT') console.warn(`Previous summary could not be reused: ${error.message}`);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}
const pointerPart = (value) => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const pointerChild = (pointer, key) => `${pointer}/${pointerPart(key)}`;
const typeOf = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const docHash = (doc) => sha256(canonical(doc));
async function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, content);
  await rename(tmp, file);
}
async function writeJson(file, value) { await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }
function parseScene(text, code) {
  const envelope = JSON.parse(text);
  if (envelope.code !== '00000' || !isObject(envelope.data)) throw new Error(`Unsuccessful scene envelope: ${String(envelope.code)}`);
  if (envelope.data.shareCode !== code) throw new Error(`shareCode mismatch: requested ${code}, received ${envelope.data.shareCode}`);
  const encodedDoc = envelope.data.doc;
  const doc = typeof encodedDoc === 'string' ? JSON.parse(encodedDoc) : encodedDoc;
  if (!isObject(doc)) throw new Error('Scene doc must be an object or JSON-encoded object');
  return { text, envelope, doc, documentEncoding: typeof encodedDoc === 'string' ? 'json-string' : 'object' };
}

const baseline = new Map();
const baselineErrors = [];
let baselineFiles;
try { baselineFiles = await readdir(baselineDir, { withFileTypes: true }); }
catch (error) { throw new Error(`Cannot read baseline directory: ${error.message}`); }
for (const file of baselineFiles.filter((file) => file.isFile() && /^[a-zA-Z0-9_-]+(?:\.json)?$/.test(file.name))) {
  const code = file.name.replace(/\.json$/, '');
  try { baseline.set(code, parseScene(await readFile(path.join(baselineDir, file.name), 'utf8'), code)); }
  catch (error) { baselineErrors.push({ file: file.name, error: error.message }); }
}

// Structural schema inventories preserve array item types while ignoring indices.
function inventory(value, pointer = '', result = new Map()) {
  const types = result.get(pointer) || new Set();
  types.add(typeOf(value)); result.set(pointer, types);
  if (Array.isArray(value)) value.forEach((item) => inventory(item, `${pointer}/*`, result));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => inventory(item, pointerChild(pointer, key), result));
  return result;
}
function collectEnums(doc, result = new Map()) {
  function add(key, value) {
    if (value === undefined) return;
    const values = result.get(key) || new Set(); values.add(value); result.set(key, values);
  }
  add('/schemaVersion', doc.schemaVersion);
  add('/environment/map', doc.environment?.map);
  for (const spawner of doc.spawners || []) add('/spawners/*/kind', spawner.kind);
  for (const actor of doc.actors || []) {
    add('/actors/*/body/shape', actor.body?.shape);
    for (const behavior of actor.behaviors || []) add('/actors/*/behaviors/*/kind', behavior.kind);
  }
  return result;
}
const baselineSchema = new Map();
const baselineEnums = new Map();
for (const entry of baseline.values()) { inventory(entry.doc, '', baselineSchema); collectEnums(entry.doc, baselineEnums); }
const newSchema = new Map();
const newEnums = new Map();
const compatibility = new Map();
function addIssue(kind, jsonPointer, detail, shareCode) {
  const key = canonical({ kind, jsonPointer, detail });
  if (!compatibility.has(key)) compatibility.set(key, { kind, jsonPointer, detail, shareCodes: [] });
  compatibility.get(key).shareCodes.push(shareCode);
}

let accessDenied = false;
async function fetchScene(code) {
  const url = `${ENDPOINT}${encodeURIComponent(code)}`;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    if (accessDenied) throw new Error('Skipped after a public endpoint denied access; no bypass attempted');
    let retryable = false;
    try {
      const response = await fetch(url, {
        method: 'GET', credentials: 'omit', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(options['timeout-ms']),
      });
      if (response.status === 401 || response.status === 403) {
        accessDenied = true;
        throw new Error(`HTTP ${response.status}: public endpoint denied access`);
      }
      retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw new Error('Scene response exceeds 20 MiB limit');
      const parsed = parseScene(text, code);
      await atomicWrite(path.join(scenesDir, code), text);
      return { ...parsed, acquisition: 'fetched', attempts: attempt + 1, fetchedAt: new Date().toISOString() };
    } catch (error) {
      retryable ||= ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
      if (accessDenied || !retryable || attempt === options.retries) throw new Error(`${error.message} (attempts: ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 500 * (2 ** attempt))));
    }
  }
}
async function loadScene(item) {
  if (options.offline || options.reuse) {
    try {
      const parsed = parseScene(await readFile(path.join(scenesDir, item.shareCode), 'utf8'), item.shareCode);
      const previousReport = previousCaptureReports.get(item.shareCode);
      const fetchedAt = previousReport?.responseSha256 === sha256(parsed.text) ? previousReport.fetchedAt : null;
      return { ...parsed, acquisition: 'captured-file', attempts: 0, fetchedAt };
    } catch (error) {
      if (options.offline) throw error;
    }
  }
  return fetchScene(item.shareCode);
}

const spatialKeys = /^(position|positions|waypoints|points|path|route|routes|track|from|at|rotation|rotationY|rotationX|rotationZ|yaw|pitch|roll|orientation|quaternion|direction|faceTarget|size|groundSnap|pacing)$/i;
function spatialValues(value, pointer, result = []) {
  if (Array.isArray(value)) value.forEach((item, i) => spatialValues(item, pointerChild(pointer, i), result));
  else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const child = pointerChild(pointer, key);
      if (spatialKeys.test(key)) result.push({ jsonPointer: child, field: key, value: item });
      spatialValues(item, child, result);
    }
  }
  return result;
}
function spatialPoints(value, pointer, role, result = [], parentKey = '') {
  if (isObject(value) && ['x', 'y', 'z'].every((key) => Number.isFinite(value[key]))) {
    result.push({ jsonPointer: pointer, role: parentKey === 'size' ? 'extent' : role, value });
  }
  if (Array.isArray(value)) value.forEach((item, i) => spatialPoints(item, pointerChild(pointer, i), role, result, parentKey));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => spatialPoints(item, pointerChild(pointer, key), role, result, key));
  return result;
}
function rawDefinition(value, pointer) { return { jsonPointer: pointer, value }; }
function exportScene(item, entry) {
  const { doc, envelope } = entry;
  const actors = Array.isArray(doc.actors) ? doc.actors : [];
  const spawners = Array.isArray(doc.spawners) ? doc.spawners : [];
  const dispatchers = Array.isArray(doc.dispatchers) ? doc.dispatchers : [];
  const actorIds = new Map(actors.map((actor, index) => [actor.id, `/actors/${index}`]));
  const recordedTracks = actors.flatMap((actor, actorIndex) => (actor.behaviors || []).flatMap((behavior, behaviorIndex) => behavior.track ? [{
    ...rawDefinition(behavior.track, `/actors/${actorIndex}/behaviors/${behaviorIndex}/track`),
    actorTemplateId: actor.id,
    encoding: 'upstream-encoded-track; arrays retained verbatim, not expanded into frames',
  }] : []));
  for (const [key, values] of inventory(doc)) {
    const previous = baselineSchema.get(key);
    if (!previous) addIssue('new-field', key, { types: [...values].sort() }, item.shareCode);
    else {
      const added = [...values].filter((type) => !previous.has(type));
      if (added.length) addIssue('new-field-type', key, { baselineTypes: [...previous].sort(), addedTypes: added.sort() }, item.shareCode);
    }
  }
  for (const [key, values] of collectEnums(doc)) {
    for (const value of values) if (!baselineEnums.get(key)?.has(value)) addIssue('new-enum-value', key, { value }, item.shareCode);
  }
  inventory(doc, '', newSchema); collectEnums(doc, newEnums);
  for (const key of ['actors', 'spawners']) if (!Array.isArray(doc[key])) addIssue('invalid-required-array', `/${key}`, { actualType: typeOf(doc[key]) }, item.shareCode);
  if (!isObject(doc.playerSpawn?.position)) addIssue('missing-player-position', '/playerSpawn/position', {}, item.shareCode);
  if (item.mapId != null && doc.environment?.map !== item.mapId) addIssue('catalog-map-mismatch', '/environment/map', { catalogMapId: item.mapId, documentMapId: doc.environment?.map ?? null }, item.shareCode);
  for (const [index, spawner] of spawners.entries()) if (spawner.actorTemplateId && !actorIds.has(spawner.actorTemplateId)) addIssue('unresolved-actor-template', `/spawners/${index}/actorTemplateId`, { actorTemplateId: spawner.actorTemplateId }, item.shareCode);
  for (const [index, dispatcher] of dispatchers.entries()) for (const [routeIndex, route] of (dispatcher.routes || []).entries()) {
    if (route.templateId && !actorIds.has(route.templateId)) addIssue('unresolved-actor-template', `/dispatchers/${index}/routes/${routeIndex}/templateId`, { actorTemplateId: route.templateId }, item.shareCode);
  }
  const definitions = {
    playerSpawn: rawDefinition(doc.playerSpawn ?? null, '/playerSpawn'),
    spawners: spawners.map((spawner, index) => ({ ...rawDefinition(spawner, `/spawners/${index}`), actorTemplatePointer: actorIds.get(spawner.actorTemplateId) ?? null })),
    actors: actors.map((actor, index) => rawDefinition(actor, `/actors/${index}`)),
    dispatchers: dispatchers.map((dispatcher, index) => rawDefinition(dispatcher, `/dispatchers/${index}`)),
    rules: rawDefinition(doc.rules ?? null, '/rules'),
  };
  const points = [
    ...spatialPoints(doc.playerSpawn, '/playerSpawn', 'player-spawn'),
    ...spatialPoints(spawners, '/spawners', 'spawner-point'),
    ...spatialPoints(actors, '/actors', 'actor-route-point'),
    ...spatialPoints(dispatchers, '/dispatchers', 'dispatcher-point'),
  ];
  return {
    shareCode: item.shareCode, sceneKey: envelope.data.sceneKey, name: item.name,
    type: item.type, mapId: doc.environment?.map ?? item.mapId ?? null,
    catalogMapId: item.mapId ?? null, schemaVersion: doc.schemaVersion,
    source: {
      url: `${ENDPOINT}${encodeURIComponent(item.shareCode)}`, file: `scenes/${item.shareCode}`,
      documentPointer: '/data/doc', documentEncoding: entry.documentEncoding,
      responseSha256: sha256(entry.text), documentSha256: docHash(doc),
    },
    counts: {
      actorTemplates: actors.length,
      humanoidTemplates: actors.filter((actor) => actor.body?.shape === 'humanoid').length,
      spawners: spawners.length,
      humanoidSpawners: spawners.filter((spawner) => actors.find((actor) => actor.id === spawner.actorTemplateId)?.body?.shape === 'humanoid').length,
      fixedSpawners: spawners.filter((spawner) => spawner.kind === 'fixed').length,
      dispatchers: dispatchers.length,
      playerSpawnPoints: points.filter((point) => point.role === 'player-spawn').length,
      spawnerPoints: points.filter((point) => point.role === 'spawner-point').length,
      actorSpatialPoints: points.filter((point) => point.role === 'actor-route-point').length,
      waypoints: actors.reduce((count, actor) => count + (actor.behaviors || []).reduce((sum, behavior) => sum + (behavior.waypoints?.length || 0), 0), 0),
      dispatcherPoints: points.filter((point) => point.role === 'dispatcher-point').length,
      recordedTracks: recordedTracks.length,
      declaredTrackFrames: recordedTracks.reduce((count, track) => count + (Number.isInteger(track.value.n) ? track.value.n : 0), 0),
    },
    ...definitions,
    recordedTracks,
    points,
    spatialValues: [
      ...spatialValues(doc.playerSpawn, '/playerSpawn'), ...spatialValues(spawners, '/spawners'),
      ...spatialValues(actors, '/actors'), ...spatialValues(dispatchers, '/dispatchers'),
      ...spatialValues(doc.rules, '/rules'),
    ],
  };
}

let next = 0;
let finished = 0;
const results = new Array(catalog.data.length);
await Promise.all(Array.from({ length: options.concurrency }, async () => {
  while (next < catalog.data.length) {
    const index = next++;
    const item = catalog.data[index];
    try {
      const entry = await loadScene(item);
      const previous = baseline.get(item.shareCode);
      const documentSha256 = docHash(entry.doc);
      const status = !previous ? 'added' : documentSha256 === docHash(previous.doc) ? 'unchanged' : 'modified';
      const metadata = (envelope) => Object.fromEntries(Object.entries(envelope.data).filter(([key]) => key !== 'doc'));
      const oldMetadata = previous ? metadata(previous.envelope) : {};
      const currentMetadata = metadata(entry.envelope);
      const changedMetadataFields = [...new Set([...Object.keys(oldMetadata), ...Object.keys(currentMetadata)])].filter((key) => canonical(oldMetadata[key]) !== canonical(currentMetadata[key]));
      results[index] = {
        report: {
          shareCode: item.shareCode, sceneKey: item.sceneKey, name: item.name,
          mapId: entry.doc.environment?.map ?? item.mapId ?? null, status,
          acquisition: entry.acquisition, attempts: entry.attempts, fetchedAt: entry.fetchedAt ?? null,
          documentSha256, baselineDocumentSha256: previous ? docHash(previous.doc) : null,
          responseSha256: sha256(entry.text), responseChanged: previous ? sha256(entry.text) !== sha256(previous.text) : null,
          changedMetadataFields, sourceFile: `scenes/${item.shareCode}`,
        },
        exported: exportScene(item, entry),
      };
    } catch (error) {
      results[index] = { report: { shareCode: item.shareCode, sceneKey: item.sceneKey, name: item.name, mapId: item.mapId ?? null, status: 'failed', error: error.message } };
    }
    finished += 1;
    if (finished % 10 === 0 || finished === catalog.data.length) console.log(`Scenes ${finished}/${catalog.data.length}`);
  }
}));

const statusCounts = { added: 0, modified: 0, unchanged: 0, failed: 0 };
const perMap = {};
const totalDefinitions = {};
for (const { report, exported } of results) {
  statusCounts[report.status] += 1;
  const mapKey = report.mapId ?? '(custom)';
  perMap[mapKey] ??= { scenes: 0, added: 0, modified: 0, unchanged: 0, failed: 0, definitions: {} };
  perMap[mapKey].scenes += 1; perMap[mapKey][report.status] += 1;
  for (const [key, count] of Object.entries(exported?.counts || {})) {
    totalDefinitions[key] = (totalDefinitions[key] || 0) + count;
    perMap[mapKey].definitions[key] = (perMap[mapKey].definitions[key] || 0) + count;
  }
}
const jsonInventory = (value) => Object.fromEntries([...value].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, [...values].sort()]));
const completedAt = new Date().toISOString();
await writeJson(path.join(outputDir, 'robot-positions.json'), {
  formatVersion: 1, generatedAt: completedAt,
  catalog: { file: path.relative(outputDir, path.resolve(options.catalog)), sha256: sha256(catalogText), scenes: catalog.data.length },
  coordinatePolicy: 'Original values and axes are preserved without rounding, coordinate conversion, ground snapping, or runtime simulation. Array points are definitions, not a count of simultaneously active robots. Grid/area/pool choices and routes remain generators; no sampled positions are invented.',
  pointerPolicy: 'Read source.file as the original API envelope; read source.documentPointer and JSON.parse it when documentEncoding is json-string. All other jsonPointer fields are RFC 6901 pointers within this parsed scene document.',
  counts: { scenes: results.filter((result) => result.exported).length, failed: statusCounts.failed, ...totalDefinitions },
  scenes: results.filter((result) => result.exported).map((result) => result.exported),
  failures: results.filter((result) => result.report.status === 'failed').map((result) => result.report),
});
await writeJson(path.join(outputDir, 'scene-diff.json'), {
  formatVersion: 1, startedAt, completedAt,
  endpoint: ENDPOINT,
  mode: options.offline ? 'offline-validation' : options.reuse ? 'reuse-and-fetch' : 'fetch-all',
  settings: { concurrency: options.concurrency, retries: options.retries, timeoutMs: options['timeout-ms'] },
  catalog: { file: path.resolve(options.catalog), sha256: sha256(catalogText), scenes: catalog.data.length },
  baseline: { directory: baselineDir, scenes: baseline.size, errors: baselineErrors },
  statusPolicy: 'added/modified/unchanged compare canonical parsed scene documents by shareCode. Metadata and response hash differences are separate; live playCount does not make a document modified.',
  compatibilityPolicy: 'Structural and enum differences are relative to captured baseline scenes, not proof that the old client rejects them. Raw fields are retained. Runtime support must be verified against client code.',
  statusCounts, counts: totalDefinitions, perMap,
  absentFromCatalog: [...baseline.keys()].filter((code) => !seenCodes.has(code)),
  scenes: results.map((result) => result.report),
  compatibility: { issues: [...compatibility.values()].map((issue) => ({ ...issue, shareCodes: issue.shareCodes.sort() })).sort((a, b) => canonical(a).localeCompare(canonical(b))), baselineSchema: jsonInventory(baselineSchema), currentSchema: jsonInventory(newSchema), baselineEnums: jsonInventory(baselineEnums), currentEnums: jsonInventory(newEnums) },
});
console.log(JSON.stringify({ outputDir, statusCounts, counts: totalDefinitions, compatibilityIssues: compatibility.size, baselineErrors: baselineErrors.length }, null, 2));
if (statusCounts.failed || baselineErrors.length) process.exitCode = 1;
