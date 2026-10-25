import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localizeJavaScript} from '../patches/localization.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function collectUiStrings(directory = path.join(root, 'dist')) {
  const modules = {};
  for (const name of fs.readdirSync(path.join(directory, 'js')).filter(name => /\.(?:mjs|js)$/.test(name))) {
    const keys = new Set();
    localizeJavaScript(fs.readFileSync(path.join(directory, 'js', name), 'utf8'), {filename: name, collect: item => keys.add(item.key)});
    if (keys.size) modules[name] = [...keys];
  }
  const keys = new Set();
  localizeJavaScript(fs.readFileSync(path.join(root, 'offline-runtime.js'), 'utf8'), {collect: item => keys.add(item.key)});
  modules['offline-runtime.js'] = [...keys];
  return modules;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = collectUiStrings();
  const destination = process.argv[2] || '/tmp/miaozhun-localization-keys.json';
  fs.writeFileSync(destination, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({destination, modules: Object.keys(data).length, unique: new Set(Object.values(data).flat()).size}));
}
