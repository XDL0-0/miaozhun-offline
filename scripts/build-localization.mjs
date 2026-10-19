import fs from 'node:fs';
import path from 'node:path';
import {applyLocaleCompatibility, localizeJavaScript} from '../patches/localization.mjs';

const han = /\p{Script=Han}/u;
const placeholders = value => [...value.matchAll(/\{(?:\d+|[A-Za-z_]\w*)\}/g)].map(match => match[0]).sort();

export function readEnglishCatalog(root) {
  const directory = path.join(root, 'patches/locales');
  const overrideFile = path.join(directory, 'overrides.en.json');
  const overrides = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
  const catalog = Object.create(null);
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.en.json') && !['overrides.en.json', 'minimap-callouts.en.json'].includes(name)).sort()) {
    const entries = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    for (const [key, value] of Object.entries(entries)) {
      if (!key || typeof value !== 'string' || !value.trim() || han.test(value)) throw new Error(`Invalid English translation: ${name}: ${key}`);
      if (JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))) throw new Error(`Translation placeholders differ: ${name}: ${key}`);
      if (Object.hasOwn(catalog, key) && catalog[key] !== value && !Object.hasOwn(overrides, key)) throw new Error(`Conflicting translation: ${key}`);
      catalog[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'string' || !value.trim() || han.test(value) || JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))) throw new Error(`Invalid terminology override: ${key}`);
    catalog[key] = value;
  }
  return catalog;
}

export function collectBundledPresentationStrings(directory) {
  const result = new Set();
  function add(value) { if (typeof value === 'string' && han.test(value)) result.add(value.trim()); }
  const base = path.join(directory, 'prod-api/api/v1/public/val/aimlab');
  const workshop = JSON.parse(fs.readFileSync(path.join(base, 'workshop'), 'utf8'));
  for (const item of workshop.data) { add(item.name); add(item.description); }
  for (const name of fs.readdirSync(path.join(base, 'scenes'))) {
    const scene = JSON.parse(fs.readFileSync(path.join(base, 'scenes', name), 'utf8')).data;
    add(scene.name); add(scene.description);
    const doc = JSON.parse(scene.doc);
    add(doc.meta?.name);
    for (const list of [doc.actors, doc.spawners, doc.dispatchers]) for (const item of list || []) add(item.name);
  }
  return [...result];
}

export function buildLocalization({root, directory = path.join(root, 'dist')}) {
  const catalog = readEnglishCatalog(root);
  const moduleDirectory = path.join(directory, 'js');
  const originals = Object.fromEntries(fs.readdirSync(moduleDirectory).filter(name => /\.(mjs|js)$/.test(name)).map(name => [name, fs.readFileSync(path.join(moduleDirectory, name), 'utf8')]));
  const sources = applyLocaleCompatibility(originals);
  const keys = new Set(), modules = {}, missing = new Set();
  function collect() {
    const localKeys = new Set();
    return {localKeys, collect({key}) {
      const trimmed = key.trim();
      keys.add(trimmed); localKeys.add(trimmed);
      if (!Object.hasOwn(catalog, trimmed)) missing.add(trimmed);
    }};
  }
  const transformed = {};
  for (const [filename, source] of Object.entries(sources)) {
    const collector = collect();
    transformed[filename] = localizeJavaScript(source, {filename, collect: collector.collect});
    if (collector.localKeys.size) modules[filename] = collector.localKeys.size;
  }
  const offlineCollector = collect();
  const offline = localizeJavaScript(fs.readFileSync(path.join(root, 'offline-runtime.js'), 'utf8'), {filename: 'offline-runtime.js', collect: offlineCollector.collect});
  modules['offline-runtime.js'] = offlineCollector.localKeys.size;
  const runtimeSource = fs.readFileSync(path.join(root, 'patches/i18n-runtime.js'), 'utf8');
  const runtimeCollector = collect();
  localizeJavaScript(runtimeSource, {collect: item => { if (item.key !== '简体中文') runtimeCollector.collect(item); }});
  modules['offline-i18n.js'] = runtimeCollector.localKeys.size;
  const bundledKeys = collectBundledPresentationStrings(directory);
  for (const key of bundledKeys) { keys.add(key); if (!Object.hasOwn(catalog, key)) missing.add(key); }
  const report = {schemaVersion: 1, languages: ['zh-CN', 'en'], defaultLanguage: 'zh-CN', catalogEntries: Object.keys(catalog).length, sourceKeys: keys.size, bundledPresentationKeys: bundledKeys.length, minimapCallouts: {}, modules, missing: [...missing]};
  function saveReport() { fs.writeFileSync(path.join(directory, 'localization-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  if (missing.size) { saveReport(); throw new Error(`English UI has ${missing.size} untranslated strings. See dist/localization-report.json.`); }
  const sceneNames = {};
  const sceneDirectory = path.join(directory, 'prod-api/api/v1/public/val/aimlab/scenes');
  for (const filename of fs.readdirSync(sceneDirectory)) {
    const scene = JSON.parse(JSON.parse(fs.readFileSync(path.join(sceneDirectory, filename), 'utf8')).data.doc);
    sceneNames[scene.meta.id] = [...new Set([scene.meta.name, ...[scene.actors, scene.spawners, scene.dispatchers].flatMap(items => (items || []).map(item => item.name))].filter(name => typeof name === 'string').map(name => name.trim()))];
  }
  const callouts = JSON.parse(fs.readFileSync(path.join(root, 'patches/locales/minimap-callouts.en.json'), 'utf8'));
  const minimapDirectory = path.join(directory, 'aim-maps');
  for (const filename of fs.readdirSync(minimapDirectory).filter(name => name.endsWith('.minimap.json'))) {
    const mapId = filename.slice(0, -'.minimap.json'.length), labels = callouts[mapId];
    const data = JSON.parse(fs.readFileSync(path.join(minimapDirectory, filename), 'utf8'));
    if (!labels) throw new Error(`Missing English minimap: ${mapId}`);
    for (const item of data.callouts) if (typeof labels[item.name] !== 'string' || !labels[item.name] || han.test(labels[item.name])) throw new Error(`Untranslated minimap label: ${mapId}: ${item.name}`);
    report.minimapCallouts[mapId] = data.callouts.length;
  }
  const runtime = runtimeSource
    .replace('/*__AIM_ENGLISH_CATALOG__*/{}', JSON.stringify(catalog))
    .replace('/*__AIM_SCENE_NAMES__*/{}', JSON.stringify(sceneNames))
    .replace('/*__AIM_MINIMAP_CALLOUTS__*/{}', JSON.stringify(callouts));
  for (const [filename, source] of Object.entries(transformed)) fs.writeFileSync(path.join(moduleDirectory, filename), source);
  fs.writeFileSync(path.join(directory, 'offline-runtime.js'), offline);
  fs.writeFileSync(path.join(directory, 'offline-i18n.js'), runtime);
  saveReport();
  return report;
}
