import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from '../scripts/vendor/acorn.cjs';
import {localizeJavaScript, templateKey, applyLocaleCompatibility} from '../patches/localization.mjs';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const runtimeSource = read('../patches/i18n-runtime.js');
const languageKey = 'al-offline-language';
const clone = value => JSON.parse(JSON.stringify(value));
const catalog = {
  '界面语言': 'Interface Language',
  '瞄准专家 · 离线版': 'Aim Expert · Offline Edition',
  '设置': 'Settings',
  '训练': 'Training',
  '已选{0}，共{1}项': '{1} items; selected {0}',
  '外层{0}结束': 'outer {0} end',
  '内层{0}': 'inner {0}',
  '简单': 'Easy',
  '普通': 'Normal',
  '中等': 'Medium',
  '困难': 'Hard',
  '简单 · 训练': 'Easy · Training',
  '困难 — 训练': 'Hard — Training',
  '训练说明': 'Training instructions',
  '零': 'Cypher',
  '一': '1',
  '两': '2',
  '切换语言前无法保存当前场景，请先导出场景后重试。': 'Unable to save the current scene before changing language. Export the scene and try again.',
};
const bundledSceneNames = {'bundled-doc': ['简单 · 训练', '困难 — 训练', '训练', '零']};
const minimapCallouts = {
  bonsai: {'B区高台': 'B Rafters'},
  plummet: {'B区高台': 'B Tower'},
  infinity: {'B区高台': 'B Nest'},
};

function element(tag) {
  return {
    tagName: tag, children: [], attributes: {}, events: {},
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.events[name] = listener; },
  };
}

function runtime({href = 'https://offline.example/aim?drill=tracking#run', saved, storage, blocked = false, english = catalog, sceneNames = bundledSceneNames, callouts = minimapCallouts} = {}) {
  const values = storage ?? new Map(saved === undefined ? [] : [[languageKey, saved]]);
  const replacements = [];
  const alerts = [];
  const localStorage = {
    getItem(key) { if (blocked) throw new Error('Storage unavailable'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage unavailable'); values.set(key, value); },
  };
  const document = {documentElement: {}, title: '', createElement: element};
  const location = {href, replace(url) { replacements.push(url); this.href = url; }};
  const context = vm.createContext({URL, document, localStorage, location, alert: message => alerts.push(message)});
  let source = runtimeSource;
  for (const [marker, value] of [['/*__AIM_ENGLISH_CATALOG__*/{}', english], ['/*__AIM_SCENE_NAMES__*/{}', sceneNames], ['/*__AIM_MINIMAP_CALLOUTS__*/{}', callouts]]) {
    assert.equal(source.split(marker).length, 2, `${marker} must occur exactly once`);
    source = source.replace(marker, () => JSON.stringify(value));
  }
  vm.runInContext(source, context);
  return {context, i18n: context.__aimI18n, document, values, replacements, location, alerts};
}

function execute(source, environment, filename = 'behavior-fixture.js') {
  // Client modules have separate lexical scopes, even when evaluated in one VM.
  return vm.runInContext(`{\n${localizeJavaScript(source, {filename})}\n}`, environment.context);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}

function walk(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child?.type) { const found = walk(child, predicate); if (found) return found; }
    }
  }
  return null;
}

function nodeSource(source, predicate, description) {
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const node = walk(ast, predicate);
  assert(node, `could not find ${description} in retained client source`);
  return source.slice(node.start, node.end);
}

const compatibilityNames = ['DuBWfmzx.js', 'B9C9f4Y8.js', 'DCKWp-_u.js', 'DtLCYWdy.js', 'index.C6F_bJRd.js', 'BW23heFo.js', 'tmIeW3Ig.js', 'ClAFWwpi.js', 'DqtmD7Xr.js', 'DVK7uRSu.js', 'CymPR-fm.js', 'aQOfOAp-.js'];
const originals = Object.fromEntries(compatibilityNames.map(name => [name, read(`../site/js/${name}`)]));
const compatible = applyLocaleCompatibility(originals);

test('runtime defaults to Chinese, persists English, and can return to Chinese across reloads', async () => {
  const first = runtime();
  assert.equal(first.i18n.language, 'zh-CN');
  assert.equal(first.document.documentElement.lang, 'zh-CN');
  assert.equal(first.document.title, '瞄准专家 · 离线版');
  assert.equal(first.i18n.t('设置'), '设置');
  await first.i18n.setLanguage('en');
  assert.equal(first.values.get(languageKey), 'en');
  const english = runtime({href: first.location.href, storage: first.values});
  assert.equal(english.i18n.language, 'en');
  assert.equal(english.document.documentElement.lang, 'en');
  assert.equal(english.document.title, 'Aim Expert · Offline Edition');
  assert.equal(english.i18n.t('设置'), 'Settings');
  await english.i18n.setLanguage('zh-CN');
  const chinese = runtime({href: english.location.href, storage: english.values});
  assert.equal(chinese.i18n.language, 'zh-CN');
  assert.equal(chinese.i18n.t('设置'), '设置');
  assert.equal(new URL(chinese.location.href).searchParams.get('drill'), 'tracking');
  assert.equal(new URL(chinese.location.href).hash, '#run');
  assert.equal(first.replacements.length, 1);
  assert.equal(english.replacements.length, 1);
});

test('explicit language overrides persistence and storage failures retain a working URL fallback', async () => {
  const explicit = runtime({href: 'https://offline.example/aim?ui-language=zh-CN', saved: 'en'});
  assert.equal(explicit.i18n.language, 'zh-CN');
  assert.equal(runtime({saved: 'unsupported'}).i18n.language, 'zh-CN');
  const restricted = runtime({blocked: true});
  await restricted.i18n.setLanguage('en');
  const url = new URL(restricted.location.href);
  assert.equal(url.searchParams.get('ui-language'), 'en');
  assert.equal(url.searchParams.get('drill'), 'tracking');
  assert.equal(url.hash, '#run');
  const reloaded = runtime({blocked: true, href: url.href});
  assert.equal(reloaded.i18n.language, 'en');
  assert.equal(reloaded.i18n.t('设置'), 'Settings');
  await reloaded.i18n.setLanguage('zh-CN');
  assert.equal(runtime({blocked: true, href: reloaded.location.href}).i18n.language, 'zh-CN');
});

test('invalid or unchanged language does not reload; a successful save removes the fallback query', async () => {
  const current = runtime({href: 'https://offline.example/aim?ui-language=en&drill=a#last'});
  await current.i18n.setLanguage('en');
  await current.i18n.setLanguage('fr');
  assert.equal(current.replacements.length, 0);
  await current.i18n.setLanguage('zh-CN');
  const url = new URL(current.location.href);
  assert.equal(url.searchParams.has('ui-language'), false);
  assert.equal(url.searchParams.get('drill'), 'a');
  assert.equal(url.hash, '#last');
  assert.equal(current.values.get(languageKey), 'zh-CN');
});

test('translation preserves surrounding whitespace and unknown or user-provided strings', () => {
  const {i18n} = runtime({saved: 'en'});
  assert.equal(i18n.t(' \n设置\t '), ' \nSettings\t ');
  assert.equal(i18n.t(' \n自定义场景：小王的练习\t '), ' \n自定义场景：小王的练习\t ');
  assert.equal(i18n.displayName('自定义场景：小王的练习'), '自定义场景：小王的练习');
  assert.equal(i18n.displayName('训练'), 'Training');
  for (const value of [null, undefined, 0, false, {}, ['设置']]) assert.equal(i18n.t(value), value);
});

test('numeric placeholders can reorder and substitution contents are never replacement syntax', () => {
  const {i18n} = runtime({saved: 'en'});
  const value = '$& $1 $$ $` $\' {1}';
  assert.equal(i18n.format('已选{0}，共{1}项', [value, '设置']), `设置 items; selected ${value}`);
  assert.equal(i18n.format('{0}|{0}|{2}', ['$&', 'unused']), '$&|$&|{2}');
  assert.equal(i18n.format('设置', []), 'Settings');
});

test('AST templates use cooked text, evaluate nested expressions once, and work without the runtime', () => {
  const parsed = parse('`外层\\n${next()}结束`', {ecmaVersion: 'latest'});
  assert.equal(templateKey(parsed.body[0].expression), '外层\n{0}结束');
  const environment = runtime({saved: 'en'});
  const collected = [];
  const source = 'let outer=0,inner=0;const next=()=>++inner;globalThis.result=`外层${(()=>{outer++;return `内层${next()}`})()}结束`;globalThis.counts=[outer,inner];';
  const transformed = localizeJavaScript(source, {filename: 'nested.js', collect: item => collected.push(item)});
  vm.runInContext(transformed, environment.context);
  assert.equal(environment.context.result, 'outer inner 1 end');
  assert.deepEqual(clone(environment.context.counts), [1, 1]);
  assert.deepEqual(collected.map(item => [item.key, item.filename, item.kind]), [
    ['外层{0}结束', 'nested.js', 'template'], ['内层{0}', 'nested.js', 'template'],
  ]);
  const fallback = vm.createContext({});
  vm.runInContext(transformed, fallback);
  assert.equal(fallback.result, '外层内层1结束');
  assert.deepEqual(clone(fallback.counts), [1, 1]);
});

test('translated expressions remain separate from adjacent minified JavaScript keywords', async () => {
  // Quotes and backticks provide a token boundary in the retained minified code.
  // Replacing them with a bare identifier can turn return"..." into an entirely
  // different identifier, which Vue can catch without a browser pageerror.
  const source = 'function label(){return"设置"}function template(value){return`内层${value}`}function fail(){throw"设置"}function* sequence(){yield"设置"}async function later(){return await"设置"}let caught;try{fail()}catch(error){caught=error}let selected=false;switch(label()){case"设置":selected=true;break}globalThis.result={label:label(),template:template("$&"),caught,type:typeof"设置",voidValue:void"设置",yielded:sequence().next().value,selected};globalThis.later=later;';
  for (const [language, label, template] of [['en', 'Settings', 'inner $&'], ['zh-CN', '设置', '内层$&']]) {
    const environment = runtime({saved: language});
    execute(source, environment);
    const result = environment.context.result;
    assert.deepEqual(clone(result), {label, template, caught: label, type: 'string', yielded: label, selected: true});
    assert.equal(result.voidValue, undefined);
    assert.equal(await environment.context.later(), label);
  }
});

test('actual SettingsView sync-label computation returns translated labels instead of a glued identifier', () => {
  const callback = nodeSource(originals['B9C9f4Y8.js'], node => {
    if (node.type !== 'ArrowFunctionExpression' || node.body.type !== 'BlockStatement') return false;
    const statement = node.body.body[0];
    return statement?.type === 'SwitchStatement' && statement.cases.some(branch => branch.test?.value === 'synced') && statement.cases.some(branch => branch.test?.value === 'syncing') && statement.cases.some(branch => branch.test?.value === 'error');
  }, 'SettingsView sync-label computed callback');
  const labels = {'已同步到账号': 'Synced to Account', '正在同步': 'Syncing', '暂未同步到账号': 'Not Yet Synced', '登录后随账号同步': 'Sync after Sign-In'};
  const environment = runtime({saved: 'en', english: {...catalog, ...labels}});
  execute(`globalThis.syncLabel=(${callback});`, environment, 'B9C9f4Y8.js');
  for (const [status, source] of [['synced', '已同步到账号'], ['syncing', '正在同步'], ['error', '暂未同步到账号'], ['guest', '登录后随账号同步']]) {
    environment.context.B = {status: {value: status}};
    assert.equal(environment.context.syncLabel(), labels[source], status);
  }
  environment.context.B = null;
  assert.equal(environment.context.syncLabel(), labels['登录后随账号同步']);
});

test('AST localization preserves data keys, regex behavior, shader code, protocol tokens, comments, and IDs', () => {
  const shader = 'uniform float gameTime;\nvarying vec2 vUv;\n// 设置：这是渲染器内部注释，不能作为界面文字翻译。\nvoid main(){gl_FragColor=vec4(vUv,gameTime,1.0);}';
  const comment = '// 设置 comment is not presentation data';
  const source = `${comment}\nconst 标识=7;const data={"设置":"训练",id:"scene-007",shareCode:"ABC123",weapon:"vandal"};const pattern=/设置/g;const constructor=new RegExp("设置","g");const shader=${JSON.stringify(shader)};const token="TUIChat.设置";const bracket="[设置]";globalThis.observed={key:Object.keys(data)[0],value:data.设置,id:data.id,shareCode:data.shareCode,weapon:data.weapon,identifier:标识,literalMatches:pattern.test("设"+"置"),constructorMatches:constructor.test("设"+"置"),shader,token,bracket};`;
  const environment = runtime({saved: 'en', english: {...catalog, 'scene-007': 'WRONG ID', 'ABC123': 'WRONG CODE', vandal: 'WRONG WEAPON', 'TUIChat.设置': 'WRONG TOKEN', '[设置]': 'WRONG TOKEN', [shader]: 'WRONG SHADER'}});
  const transformed = localizeJavaScript(source);
  vm.runInContext(transformed, environment.context);
  assert.deepEqual(clone(environment.context.observed), {key: '设置', value: 'Training', id: 'scene-007', shareCode: 'ABC123', weapon: 'vandal', identifier: 7, literalMatches: true, constructorMatches: true, shader, token: 'TUIChat.设置', bracket: '[设置]'});
  assert(transformed.includes(comment), 'comments must remain intact');
});

test('canvas literals translate while dynamic user names stay raw even when they match a catalog key', () => {
  const environment = runtime({saved: 'en'});
  const calls = [];
  environment.context.canvas = {fillText(...args) { calls.push(args); }, strokeText(...args) { calls.push(args); }};
  environment.context.dynamicText = '设置';
  execute('canvas.fillText(globalThis.dynamicText,10,20);canvas.strokeText("设置",30,40);canvas.fillText("用户场景",50,60);', environment);
  assert.deepEqual(calls, [['设置', 10, 20], ['Settings', 30, 40], ['用户场景', 50, 60]]);
  assert.equal(environment.context.dynamicText, '设置');
});

test('actual Vue display helper preserves arbitrary nicknames that match an English catalog entry', () => {
  const declaration = nodeSource(compatible['index.C6F_bJRd.js'], node => node.type === 'VariableDeclarator' && node.id?.name === 'ao', 'Vue display-string helper');
  const environment = runtime({saved: 'en'});
  environment.context.Wr = value => typeof value === 'string';
  execute(`const ${declaration};globalThis.displayText=ao;`, environment, 'index.C6F_bJRd.js');
  assert.equal(environment.i18n.t('设置'), 'Settings', 'the fixture must contain a colliding catalog entry');
  assert.equal(environment.context.displayText('设置'), '设置');
  assert.equal(environment.context.displayText('零'), '零');
  assert.equal(environment.context.displayText('用户的小球练习'), '用户的小球练习');
  assert.equal(environment.context.displayText(null), '');
});

test('locale-specific date, time, and number calls switch only literal Chinese locale arguments', () => {
  const source = 'globalThis.rawLocale="zh-CN";receiver.toLocaleString("zh-CN",{maximumFractionDigits:1});receiver["toLocaleDateString"]("zh-cn",{month:"short"});receiver.toLocaleTimeString("zh-CN",{hour:"2-digit"});receiver.toLocaleString("fr-FR");receiver.toLocaleString(globalThis.rawLocale);';
  for (const language of ['en', 'zh-CN']) {
    const environment = runtime({saved: language});
    const calls = [];
    environment.context.receiver = Object.fromEntries(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].map(method => [method, (...args) => calls.push([method, ...args])]));
    execute(source, environment);
    const locales = language === 'en' ? ['en-US', 'en-US', 'en-US'] : ['zh-CN', 'zh-cn', 'zh-CN'];
    assert.deepEqual(clone(calls), [
      ['toLocaleString', locales[0], {maximumFractionDigits: 1}],
      ['toLocaleDateString', locales[1], {month: 'short'}],
      ['toLocaleTimeString', locales[2], {hour: '2-digit'}],
      ['toLocaleString', 'fr-FR'], ['toLocaleString', 'zh-CN'],
    ]);
    assert.equal(environment.context.rawLocale, 'zh-CN');
  }
});

test('scene text is scoped to exact bundled document names without changing custom names or stored documents', () => {
  const doc = {meta: {id: 'bundled-doc', name: '简单 · 训练'}, actors: [{id: 'actor-007', name: '零'}], authorNickname: '设置', originalJSON: '{"name":"训练","id":"零"}'};
  const before = JSON.stringify(doc);
  const {i18n} = runtime({saved: 'en'});
  assert.equal(i18n.sceneText(doc, doc.meta.name), 'Easy · Training');
  assert.equal(i18n.sceneText(doc, doc.actors[0].name), 'Cypher');
  assert.equal(i18n.sceneText('bundled-doc', ' \n训练\t '), ' \nTraining\t ');
  assert.equal(i18n.sceneText(doc, doc.authorNickname), '设置', 'a dictionary match is insufficient without an original bundled-name match');
  assert.equal(i18n.sceneText('custom-doc', '简单 · 训练'), '简单 · 训练');
  assert.equal(i18n.sceneText({meta: {id: 'custom-doc'}}, '零'), '零');
  assert.equal(i18n.sceneText({meta: {id: 'bundled-doc', name: '设置'}}, '设置'), '设置', 'renamed bundled content remains user text');
  assert.equal(i18n.sceneText(undefined, '训练'), '训练');
  for (const value of [null, undefined, 0, false, {}]) assert.equal(i18n.sceneText(doc, value), value);
  assert.equal(JSON.stringify(doc), before);
  const chinese = runtime().i18n;
  assert.equal(chinese.sceneText(doc, '零'), '零');
  assert.equal(chinese.sceneText(doc, doc.meta.name), doc.meta.name);
});

test('minimap callouts are translated per map in presentation clones without changing geometry or original data', () => {
  const data = {id: 'map-data-007', width: 1024, height: 512, bounds: {minX: -12, maxX: 92}, callouts: [
    {name: 'B区高台', x: 81, y: 52, z: 3, authorNickname: '设置', labelId: 'callout-007'},
    {name: '用户标记', x: 17, y: 23, z: 0},
  ]};
  Object.freeze(data.bounds);
  data.callouts.forEach(Object.freeze);
  Object.freeze(data.callouts);
  Object.freeze(data);
  const before = JSON.stringify(data);
  const {i18n} = runtime({saved: 'en', english: {...catalog, 'B区高台': 'Wrong Global Callout'}});
  for (const [mapId, expected] of [['bonsai', 'B Rafters'], ['plummet', 'B Tower'], ['infinity', 'B Nest']]) {
    const presentation = i18n.minimapData(data, mapId);
    assert.notEqual(presentation, data);
    assert.notEqual(presentation.callouts, data.callouts);
    assert.notEqual(presentation.callouts[0], data.callouts[0]);
    assert.equal(presentation.callouts[0].name, expected);
    assert.deepEqual(clone(presentation), {...clone(data), callouts: [{...clone(data.callouts[0]), name: expected}, clone(data.callouts[1])]});
    assert.equal(presentation.bounds, data.bounds);
    assert.equal(JSON.stringify(data), before);
  }
  assert.equal(i18n.minimapData(data, 'unknown-map'), data);
  assert.equal(i18n.minimapData(null, 'bonsai'), null);
  assert.equal(runtime().i18n.minimapData(data, 'bonsai'), data);
});

test('actual Moment presentation localizes bundled actor names and titles while preserving raw outcomes and documents', () => {
  const source = compatible['CymPR-fm.js'];
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const names = ['J2', 'rM', 'lM', 'cM', 'iM', 'sM', 'uM', 'dM', 'aM', 'Pc', 'oM', 'eM', 'Jb', 'Yb', 'qb', 'Ku', 'nM', 'gt', 'Lc', 'Ci', 'Zb', 'Cc', 'Qb', 'Li'];
  const declarations = names.map(name => {
    const node = walk(ast, item => ['FunctionDeclaration', 'VariableDeclarator'].includes(item.type) && item.id?.name === name);
    assert(node, `Moment helper ${name} must exist`);
    const code = source.slice(node.start, node.end);
    return node.type === 'VariableDeclarator' ? `const ${code};` : code;
  }).join('\n');
  const english = {...catalog, '被 {0} 击倒': 'Eliminated by {0}', '{0} · 还剩 {1} 个没倒': '{0} · {1} Still Alive', '你被 {0} 击倒': 'You Were Eliminated by {0}', '{0} 秒': '{0} s'};
  const environment = runtime({saved: 'en', english});
  // Imported gameplay constants/model metadata are irrelevant to name scoping.
  environment.context.Zo = 100;
  environment.context.tl = {};
  execute(`${declarations}\nglobalThis.presentMoment=J2;`, environment, 'CymPR-fm.js');
  const scene = {meta: {id: 'bundled-doc', name: '简单 · 训练'}, actors: [{id: 'actor-007', name: '零'}]};
  const outcome = {endReason: 'died', targetsKilled: 1, targetsTotal: 2, healthLeft: 0, threat: true, kills: [
    {id: 'actor-007', name: '零', at: 0.7, headshot: true},
    {id: 'user-actor', name: '设置', at: 1.1, headshot: false},
  ], killedBy: {id: 'killer-007', name: '训练'}};
  const settlement = {rating: {passed: false, seconds: 3, escaped: 0, stars: 0}, record: {attempts: 1, best: null}, previous: null, newBest: false};
  const before = JSON.stringify({scene, outcome, settlement});
  const options = {sceneId: scene.meta.id, name: scene.meta.name, scene, outcome, settlement, shots: 3};
  const presentation = environment.context.presentMoment(options);
  assert.equal(presentation.title, 'Easy · Training');
  assert.equal(presentation.feed[0].name, 'Cypher');
  assert.equal(presentation.feed[1].name, '设置', 'unregistered user names must stay raw despite matching a translation key');
  assert.equal(presentation.feed[2].text, 'You Were Eliminated by Training');
  assert.equal(presentation.verdict.detail, 'Eliminated by Training · 1 Still Alive');
  assert.equal(presentation.highlight.sub, 'Eliminated by Training · 1 Still Alive');
  for (const sceneId of [undefined, 'custom-doc']) {
    const custom = environment.context.presentMoment({...options, sceneId});
    assert.equal(custom.title, scene.meta.name);
    assert.equal(custom.feed[0].name, '零');
    assert.equal(custom.feed[2].text, 'You Were Eliminated by 训练');
    assert.equal(custom.verdict.detail, 'Eliminated by 训练 · 1 Still Alive');
  }
  assert.equal(environment.context.presentMoment({...options, name: '设置'}).title, '设置');
  assert.equal(JSON.stringify({scene, outcome, settlement}), before);
  assert.equal(options.scene, scene);
  assert.equal(options.outcome, outcome);
});

test('only known bundled API endpoints translate presentation metadata while scene identity and documents remain exact', () => {
  const {i18n} = runtime({saved: 'en'});
  const document = '{"meta":{"id":"设置","name":"训练"},"rules":{"目标":"中文不变"},"actors":[]}';
  const scene = {id: '设置', name: '简单 · 训练', description: '训练说明', hash: '设置', contentHash: '训练', shareCode: 'ABC123', authorNickname: '设置', doc: document, json: document, rules: {id: '设置', title: '训练'}};
  const identityKeys = ['id', 'hash', 'contentHash', 'shareCode', 'authorNickname'];
  const originalIdentity = Object.fromEntries(identityKeys.map(key => [key, scene[key]]));
  const originalRules = scene.rules;
  const unknown = {...scene, id: 'custom', name: '用户的小球练习', description: '自定义说明'};
  const root = {code: 0, data: [scene, unknown]};
  const originalDocument = scene.doc;
  assert.equal(i18n.translateData(root, '/api/v1/public/val/aimlab/workshop?map=ascent'), root);
  assert.equal(scene.name, 'Easy · Training');
  assert.equal(scene.description, 'Training instructions');
  assert.equal(scene.doc, originalDocument);
  assert.equal(scene.json, document);
  for (const key of identityKeys) assert.equal(scene[key], originalIdentity[key], key);
  assert.equal(scene.rules, originalRules);
  assert.deepEqual(scene.rules, {id: '设置', title: '训练'});
  assert.equal(unknown.name, '用户的小球练习');
  assert.equal(unknown.description, '自定义说明');
  const detail = {data: {...scene, name: '困难 — 训练', description: '训练说明'}};
  i18n.translateData(detail, '/prod-api/api/v1/public/val/aimlab/scenes/ABC123?preview=1');
  assert.equal(detail.data.name, 'Hard — Training');
  for (const path of ['/api/v1/public/val/aimlab/history', '/api/v1/val/aimlab/scenes/mine', '/api/v1/public/val/aimlab/workshop/publish', '/api/v1/public/val/aimlab/scenes/ABC123/doc', '/unrelated']) {
    const data = {data: {...scene, name: '简单 · 训练', description: '训练说明'}};
    const before = clone(data);
    assert.equal(i18n.translateData(data, path), data);
    assert.deepEqual(data, before, path);
  }
  const chinese = runtime().i18n;
  const unchanged = {data: {name: '简单 · 训练', description: '训练说明'}};
  assert.deepEqual(chinese.translateData(unchanged, '/api/v1/public/val/aimlab/workshop'), {data: {name: '简单 · 训练', description: '训练说明'}});
});

test('native selector shows both language names and changes preference through the shared language action', async () => {
  const environment = runtime({saved: 'en'});
  const host = element('div');
  environment.i18n.mountLanguageSelector(host);
  const [label] = host.children;
  const [caption, select] = label.children;
  assert.equal(caption.textContent, 'Interface Language');
  assert.equal(select.attributes['aria-label'], 'Interface Language');
  assert.equal(select.value, 'en');
  assert.deepEqual(select.children.map(option => [option.value, option.textContent, option.attributes['data-native-language']]), [
    ['zh-CN', '简体中文', 'zh-CN'], ['en', 'English', 'en'],
  ]);
  select.value = 'zh-CN';
  await select.events.change();
  assert.equal(environment.values.get(languageKey), 'zh-CN');
  assert.equal(environment.replacements.length, 1);
});

test('language changes await a pending draft hook before persisting or reloading', async () => {
  const environment = runtime({saved: 'zh-CN'});
  const gate = deferred();
  let calls = 0;
  environment.context.__aimBeforeLanguageChange = () => { calls++; return gate.promise; };
  const originalHref = environment.location.href;
  const change = environment.i18n.setLanguage('en');
  assert.equal(calls, 1);
  await Promise.resolve();
  assert.equal(environment.values.get(languageKey), 'zh-CN');
  assert.equal(environment.location.href, originalHref);
  assert.equal(environment.replacements.length, 0);
  gate.resolve();
  await change;
  assert.equal(environment.values.get(languageKey), 'en');
  assert.equal(environment.replacements.length, 1);
  assert.equal(runtime({storage: environment.values, href: environment.location.href}).i18n.language, 'en');
});

test('language selector stays disabled while draft saving is pending and re-enables on completion', async () => {
  const environment = runtime({saved: 'en'});
  const gate = deferred();
  environment.context.__aimBeforeLanguageChange = () => gate.promise;
  const host = element('div');
  environment.i18n.mountLanguageSelector(host);
  const select = host.children[0].children[1];
  select.value = 'zh-CN';
  const change = select.events.change();
  assert.equal(select.disabled, true);
  assert.equal(environment.values.get(languageKey), 'en');
  assert.equal(environment.replacements.length, 0);
  gate.resolve();
  await change;
  assert.equal(select.disabled, false);
  assert.equal(select.value, 'zh-CN');
  assert.equal(environment.values.get(languageKey), 'zh-CN');
  assert.equal(environment.alerts.length, 0);
});

test('rejected draft hook retains language, storage, and location, and resets the selector with an alert', async () => {
  const environment = runtime({saved: 'en'});
  const failure = new Error('Draft verification failed');
  environment.context.__aimBeforeLanguageChange = async () => { throw failure; };
  const originalHref = environment.location.href;
  await assert.rejects(environment.i18n.setLanguage('zh-CN'), error => error === failure);
  assert.equal(environment.i18n.language, 'en');
  assert.equal(environment.values.get(languageKey), 'en');
  assert.equal(environment.location.href, originalHref);
  assert.equal(environment.replacements.length, 0);
  const host = element('div');
  environment.i18n.mountLanguageSelector(host);
  const select = host.children[0].children[1];
  select.value = 'zh-CN';
  const change = select.events.change();
  assert.equal(select.disabled, true);
  await change;
  assert.equal(select.value, 'en');
  assert.equal(select.disabled, false);
  assert.equal(environment.i18n.language, 'en');
  assert.equal(environment.values.get(languageKey), 'en');
  assert.equal(environment.location.href, originalHref);
  assert.equal(environment.replacements.length, 0);
  assert.deepEqual(environment.alerts, [catalog['切换语言前无法保存当前场景，请先导出场景后重试。']]);
});

let cachedEditorHookSource;
function editorHookSource() {
  if (cachedEditorHookSource) return cachedEditorHookSource;
  const source = compatible['ClAFWwpi.js'];
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const declaration = walk(ast, node => node.type === 'VariableDeclarator' && node.id?.name === '__aimFlushBeforeLanguage');
  const assignment = walk(ast, node => node.type === 'AssignmentExpression' && node.left?.property?.name === '__aimBeforeLanguageChange' && node.right?.name === '__aimFlushBeforeLanguage');
  const unmount = walk(ast, node => node.type === 'CallExpression' && node.callee?.name === 'Un' && walk(node.arguments[0], child => child.type === 'MemberExpression' && child.property?.name === '__aimBeforeLanguageChange'));
  assert(declaration && assignment && unmount, 'editor must install its draft flush and identity-safe unmount hook');
  const slice = node => source.slice(node.start, node.end);
  return cachedEditorHookSource = `const ${slice(declaration)};${slice(assignment)};${slice(unmount)};`;
}

function editorEnvironment(environment, {loadMismatch = false, metadataGate} = {}) {
  const calls = [];
  const doc = {meta: {id: 'scene-007', name: '用户场景'}, environment: {}, rules: {}, actors: [], spawners: []};
  let saved, cleanup;
  const metadataStarted = deferred();
  Object.assign(environment.context, {
    o: {doc, markClean() { calls.push('clean'); }},
    ca: async () => { calls.push('nextTick'); doc.meta.description = '最后输入的说明'; },
    ro: 42, uo: 43,
    window: {clearTimeout(id) { calls.push(`clear:${id}`); }, removeEventListener() {}},
    Yt: () => { calls.push('validate'); return null; },
    G: {
      async save(value) { calls.push('save'); saved = clone(value); },
      async load() { calls.push('load'); return loadMismatch ? {...saved, corrupted: true} : clone(saved); },
    },
    bi: async () => { calls.push('metadata'); metadataStarted.resolve(); await metadataGate?.promise; },
    Un(callback) { cleanup = callback; },
    Oi() {}, wo() {}, ho() {}, zs() {}, Qn() {}, ce: {exit() {}},
  });
  environment.document.activeElement = {blur() { calls.push('blur'); }};
  environment.document.removeEventListener = () => {};
  execute(editorHookSource(), environment, 'ClAFWwpi.js');
  return {calls, doc, get saved() { return saved; }, metadataStarted, cleanup: () => cleanup()};
}

test('actual editor hook saves the committed JSON, verifies it, awaits scene metadata, and cleans up safely', async () => {
  const environment = runtime({saved: 'zh-CN'});
  const gate = deferred();
  const editor = editorEnvironment(environment, {metadataGate: gate});
  const change = environment.i18n.setLanguage('en');
  await editor.metadataStarted.promise;
  assert.deepEqual(editor.calls, ['blur', 'nextTick', 'clear:42', 'validate', 'save', 'load', 'clean', 'metadata']);
  assert.equal(JSON.stringify(editor.saved), JSON.stringify(editor.doc));
  assert.equal(editor.saved.meta.description, '最后输入的说明', 'the last input must commit before the save snapshot');
  assert.equal(environment.values.get(languageKey), 'zh-CN');
  assert.equal(environment.replacements.length, 0);
  gate.resolve();
  await change;
  assert.equal(environment.values.get(languageKey), 'en');
  assert.equal(environment.replacements.length, 1);
  editor.cleanup();
  assert.equal(Object.hasOwn(environment.context, '__aimBeforeLanguageChange'), false);
  const newerHook = async () => {};
  environment.context.__aimBeforeLanguageChange = newerHook;
  editor.cleanup();
  assert.equal(environment.context.__aimBeforeLanguageChange, newerHook, 'a stale unmount must not remove another editor hook');
});

test('actual editor hook blocks language switching when the loaded draft does not match the saved JSON', async () => {
  const environment = runtime({saved: 'zh-CN'});
  const originalHref = environment.location.href;
  const editor = editorEnvironment(environment, {loadMismatch: true});
  await assert.rejects(environment.i18n.setLanguage('en'), /Draft was not saved/);
  assert.deepEqual(editor.calls, ['blur', 'nextTick', 'clear:42', 'validate', 'save', 'load']);
  assert.equal(environment.i18n.language, 'zh-CN');
  assert.equal(environment.values.get(languageKey), 'zh-CN');
  assert.equal(environment.location.href, originalHref);
  assert.equal(environment.replacements.length, 0);
  editor.cleanup();
});

test('actual retained source separates Cypher labels from the numeric zero used for group counts', () => {
  const property = (node, key) => node.properties?.find(item => (item.key?.name ?? item.key?.value) === key)?.value;
  const selector = nodeSource(compatible['BW23heFo.js'], node => node.type === 'ObjectExpression' && property(node, 'value')?.value === 'cypher', 'Cypher selector');
  const model = nodeSource(compatible['tmIeW3Ig.js'], node => node.type === 'Property' && (node.key.name ?? node.key.value) === 'cypher' && property(node.value, 'en')?.value === 'Cypher', 'Cypher model metadata');
  const numerals = nodeSource(read('../site/js/CplsneeA.js'), node => node.type === 'ArrayExpression' && node.elements[0]?.value === '零' && node.elements[1]?.value === '一', 'group-count numerals');
  for (const [language, expectedAgent, expectedZero] of [['en', 'Cypher', '0'], ['zh-CN', '零', '零']]) {
    const environment = runtime({saved: language});
    execute(`globalThis.selector=(${selector});`, environment, 'BW23heFo.js');
    execute(`globalThis.models=({${model}});`, environment, 'tmIeW3Ig.js');
    execute(`globalThis.numerals=(${numerals});`, environment, 'CplsneeA.js');
    assert.equal(environment.context.selector.value, 'cypher');
    assert.equal(environment.context.selector.label, expectedAgent);
    assert.equal(environment.context.models.cypher.name, expectedAgent);
    assert.equal(environment.context.models.cypher.en, 'Cypher');
    assert.equal(environment.context.numerals[0], expectedZero);
    assert.equal(environment.i18n.t('零'), expectedAgent, 'agent translation must remain the global default');
  }
  assert.equal(originals['BW23heFo.js'].includes('{value:"cypher",label:"零"}'), true, 'compatibility patch must not mutate original input');
});

test('actual calendar weekday objects use English weekday labels instead of scalar numeral translations', () => {
  const source = originals['index.C6F_bJRd.js'];
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const property = (node, key) => node.properties?.find(item => (item.key?.name ?? item.key?.value) === key)?.value;
  const weeks = walk(ast, node => node.type === 'ObjectExpression' && property(node, 'sun')?.value === '日' && property(node, 'mon')?.value === '一');
  const days = walk(ast, node => node.type === 'ObjectExpression' && property(node, 'w0')?.value === '日' && property(node, 'w1')?.value === '一');
  assert(weeks && days, 'retained UI must expose its short weekday maps');
  const executable = `globalThis.weeks=(${source.slice(weeks.start, weeks.end)});globalThis.days=(${source.slice(days.start, days.end)});`;
  for (const language of ['en', 'zh-CN']) {
    const environment = runtime({saved: language});
    execute(executable, environment, 'index.C6F_bJRd.js');
    const expected = language === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['日', '一', '二', '三', '四', '五', '六'];
    assert.deepEqual(clone(environment.context.weeks), Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((key, index) => [key, expected[index]])));
    assert.deepEqual(clone(environment.context.days), Object.fromEntries(expected.map((value, index) => [`w${index}`, value])));
  }
});

test('actual difficulty parser keeps numeric levels after metadata translation and compact counts are language aware', () => {
  const source = compatible['DuBWfmzx.js'];
  const table = nodeSource(source, node => node.type === 'VariableDeclarator' && node.id?.name === 'bt', 'difficulty level table');
  const parser = nodeSource(source, node => node.type === 'FunctionDeclaration' && node.id?.name === 'Nt', 'difficulty parser');
  const formatter = nodeSource(source, node => node.type === 'FunctionDeclaration' && node.id?.name === 'vt', 'compact play count formatter');
  const executable = `const ${table};${parser};${formatter};globalThis.parseDifficulty=Nt;globalThis.playCount=vt;`;
  const english = runtime({saved: 'en'});
  execute(executable, english);
  for (const [title, label, level] of [['简单 · Range', 'Easy', 1], ['普通 — Range', 'Normal', 2], ['中等 - Range', 'Medium', 2], ['困难 Range', 'Hard', 3], ['Easy · Range', 'Easy', 1], ['Normal — Range', 'Normal', 2], ['Medium Range', 'Medium', 2], ['Hard - Range', 'Hard', 3]]) {
    assert.deepEqual(clone(english.context.parseDifficulty(title)), {title: 'Range', difficulty: {label, level}}, title);
  }
  assert.deepEqual(clone(english.context.parseDifficulty('A user title without a difficulty')), {title: 'A user title without a difficulty', difficulty: null});
  assert.equal(english.context.playCount(15000), '15K');
  assert.equal(english.context.playCount(1500000), '1.5M');
  const chinese = runtime();
  execute(executable, chinese);
  assert.deepEqual(clone(chinese.context.parseDifficulty('简单 · Range')), {title: 'Range', difficulty: {label: '简单', level: 1}});
  assert.equal(chinese.context.playCount(15000), '1.5万');
});
