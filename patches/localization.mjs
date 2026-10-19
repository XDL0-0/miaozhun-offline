import {parse} from '../scripts/vendor/acorn.cjs';

const hasChinese = text => text === 'K/O' || /\p{Script=Han}|[，。！？；：（）「」『』、【】]/u.test(text);
// These strings are executable shader/CSS source, chat protocol tokens or
// translation lookup keys. Chinese comments/identities inside them are not UI.
export function isPresentationString(value) {
  if (/^(?:TUIChat|TUIConversation|message\.(?:tip|custom)|time)\./.test(value) || value === 'AIDesk.提交评价') return false;
  if (/^\[[\p{Script=Han}]+\]$/u.test(value)) return false;
  if (value.length > 100 && /(?:^\s*vec[234]\b|\b(?:uniform|varying)\s|gl_FragColor|\b(?:vec[234]|mat[234])\s*\(|vec3 lmIrrV|body\s*\{)/.test(value)) return false;
  return true;
}
export function templateKey(node) {
  return node.quasis.map((part, index) => part.value.cooked + (index < node.expressions.length ? `{${index}}` : '')).join('');
}

// Parse retained client code rather than replacing text inside comments, regular
// expressions, identifiers or protocol keys. Translate before modules initialize;
// the game never needs a DOM observer to localize its HUD.
export function localizeJavaScript(source, {filename = 'client.js', collect} = {}) {
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true});
  const translator = '__aimOfflineLocale';
  let translated = false;
  function transform(node, parent, property) {
    if (!node || typeof node !== 'object') return '';
    if (property === 'arguments' && parent?.type === 'NewExpression' && parent.callee.name === 'RegExp') return source.slice(node.start, node.end);
    if (node.type === 'Literal' && ['zh-CN', 'zh-cn'].includes(node.value) && parent?.type === 'CallExpression' && parent.arguments[0] === node && ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].includes(parent.callee.property?.name ?? parent.callee.property?.value)) {
      translated = true;
      return `(${translator}.language==="en"?"en-US":${source.slice(node.start, node.end)})`;
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && hasChinese(node.value)) {
      // Non-computed keys are part of the data contract, not display labels.
      if (property === 'key' && !parent.computed || property === 'property' && parent.type === 'MemberExpression' && !parent.computed) return source.slice(node.start, node.end);
      if (!isPresentationString(node.value)) return source.slice(node.start, node.end);
      collect?.({key: node.value, filename, kind: 'literal'});
      translated = true;
      const numerals = {'零': '0', '一': '1', '两': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9'};
      const weekdays = {'日': 'Sun', '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat'};
      const propertyName = parent?.key?.name ?? parent?.key?.value;
      const contextual = filename === 'CplsneeA.js' ? numerals[node.value] : filename === 'index.C6F_bJRd.js' && /^(?:sun|mon|tue|wed|thu|fri|sat|w[0-6])$/.test(propertyName) ? weekdays[node.value] : undefined;
      if (contextual !== undefined) return `(${translator}.language==="en"?${JSON.stringify(contextual)}:${source.slice(node.start, node.end)})`;
      return `(${translator}.t(${source.slice(node.start, node.end)}))`;
    }
    if (node.type === 'TemplateLiteral' && hasChinese(templateKey(node)) && parent?.type !== 'TaggedTemplateExpression') {
      const key = templateKey(node);
      if (!isPresentationString(key)) return source.slice(node.start, node.end);
      collect?.({key, filename, kind: 'template'});
      translated = true;
      return `(${translator}.format(${JSON.stringify(key)},[${node.expressions.map(expression => transform(expression, node, 'expressions')).join(',')}]))`;
    }
    const children = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) children.push({node: child, property: key});
      } else if (value?.type) children.push({node: value, property: key});
    }
    children.sort((a, b) => a.node.start - b.node.start || b.node.end - a.node.end);
    let output = '', position = node.start;
    for (const child of children) {
      if (child.node.start < position) continue;
      output += source.slice(position, child.node.start) + transform(child.node, node, child.property);
      position = child.node.end;
    }
    return output + source.slice(position, node.end);
  }
  const output = transform(ast, null, '');
  // Asset verification also imports the client codec in Node, without a UI.
  // Its original messages remain usable there and in isolated behavior tests.
  return translated ? `const ${translator}=globalThis.__aimI18n??{t:value=>value,format:(template,values)=>template.replace(/\\{(\\d+)\\}/g,(match,index)=>index<values.length?String(values[index]):match)};\n${output}` : output;
}

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Localization anchor mismatch: ${label}`);
  return source.replace(before, after);
}

export function applyLocaleCompatibility(sources) {
  const output = {...sources};
  let shared = output['DuBWfmzx.js'];
  shared = replaceOnce(shared, "bt={'简单':0x1,'普通':0x2,'中等':0x2,'困难':0x3}",
    "bt={'简单':0x1,'普通':0x2,'中等':0x2,'困难':0x3,'Easy':1,'Normal':2,'Medium':2,'Hard':3}", 'difficulty levels');
  shared = replaceOnce(shared, '/^(简单|普通|中等|困难)(?:', '/^(简单|普通|中等|困难|Easy|Normal|Medium|Hard)(?:', 'difficulty parser');
  shared = replaceOnce(shared, "const f=e[0x1];return{'title':e[0x2],'difficulty':{'label':f,'level':bt[f]}}",
    "const f=e[0x1];return{'title':e[0x2],'difficulty':{'label':globalThis.__aimI18n.t(f),'level':bt[f]}}", 'difficulty label');
  shared = replaceOnce(shared, "function vt(d){return d<0x2710?", "function vt(d){if(globalThis.__aimI18n.language==='en')return new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(d);return d<0x2710?", 'compact play count');
  output['DuBWfmzx.js'] = shared;
  output['B9C9f4Y8.js'] = output['B9C9f4Y8.js'].replaceAll('/^今天 /', '/^(?:今天|Today) /').replaceAll('/核显/', '/核显|integrated/i');
  output['DCKWp-_u.js'] = output['DCKWp-_u.js'].replaceAll('/设置$/', '/(?:设置| Settings)$/')
    .replaceAll('/资产加载失败：(\\S+) → HTTP (\\d{3})/', '/(?:资产加载失败：|Asset loading failed: )(\\S+) → HTTP (\\d{3})/');
  output['DtLCYWdy.js'] = output['DtLCYWdy.js'].replaceAll('/^未命名场景\\s*\\d*$/', '/^(?:未命名场景|Untitled Scene)\\s*\\d*$/i');
  output['index.C6F_bJRd.js'] = replaceOnce(output['index.C6F_bJRd.js'],
    'mn.interceptors.response.use(e=>{const{responseType:t}=e.config;',
    'mn.interceptors.response.use(e=>{e.data=globalThis.__aimI18n.translateData(e.data,e.config.url);const{responseType:t}=e.config;', 'bundled API metadata');
  // The same Chinese character is both a numeral and Cypher's localized name.
  // Agent identity comes from its stable ID/English metadata, never a global
  // replacement of the numeral used by the community group counter.
  output['BW23heFo.js'] = replaceOnce(output['BW23heFo.js'], '{value:"cypher",label:"零"}',
    '{value:"cypher",label:globalThis.__aimI18n?.language==="en"?"Cypher":"零"}', 'Cypher agent selector');
  output['tmIeW3Ig.js'] = replaceOnce(output['tmIeW3Ig.js'], 'cypher:{name:"零",en:"Cypher"',
    'cypher:{name:globalThis.__aimI18n?.language==="en"?"Cypher":"零",en:"Cypher"', 'Cypher model label');
  const dateChildren = '[t("b",null,r(l.value.month),1),i[0]||(i[0]=t("i",null,"月",-1)),t("b",null,r(l.value.day),1),i[1]||(i[1]=t("i",null,"日",-1))]';
  output['B9C9f4Y8.js'] = replaceOnce(output['B9C9f4Y8.js'], dateChildren,
    `globalThis.__aimI18n.language==="en"?[t("b",null,["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][l.value.month-1]+" "+l.value.day,1)]:${dateChildren}`, 'changelog date');
  let editor = output['ClAFWwpi.js'];
  const beforeAutosave = 'qe(()=>o.doc,()=>{window.clearTimeout(ro),ro=window.setTimeout(()=>{hi()},pM)},{deep:!0});';
  const flush = 'const __aimFlushBeforeLanguage=async()=>{document.activeElement?.blur();await ca();window.clearTimeout(ro);const invalid=Yt(o.doc);if(invalid!==null)throw new Error(invalid);const snapshot=JSON.stringify(o.doc);await G.save(o.doc);const saved=await G.load();if(JSON.stringify(saved)!==snapshot)throw new Error("Draft was not saved");o.markClean();await bi()};globalThis.__aimBeforeLanguageChange=__aimFlushBeforeLanguage;';
  editor = replaceOnce(editor, beforeAutosave, flush + beforeAutosave, 'save draft before language switch');
  editor = replaceOnce(editor, 'Un(()=>{window.removeEventListener("keydown",Oi)',
    'Un(()=>{if(globalThis.__aimBeforeLanguageChange===__aimFlushBeforeLanguage)delete globalThis.__aimBeforeLanguageChange;window.removeEventListener("keydown",Oi)', 'remove editor language hook');
  output['ClAFWwpi.js'] = editor;
  return applySceneDisplayCompatibility(output);
}

function applySceneDisplayCompatibility(sources) {
  const output = {...sources};
  const text = 'globalThis.__aimI18n.sceneText';
  let editor = output['ClAFWwpi.js'];
  for (const [before, after, label] of [
    ['function W(L){const Z=[L.label],K=', `function W(L){const Z=[${text}(t.doc,L.label)],K=`, 'hierarchy tooltip'],
    ['a("span",ty,$(ie.label),1)', `a("span",ty,$(${text}(C(t).doc,ie.label)),1)`, 'hierarchy name'],
    ['templateId:g.templateId,name:k?.name||g.templateId,color:', `templateId:g.templateId,name:${text}(o.doc,k?.name||g.templateId),color:`, 'dispatcher display name'],
    ['$(x.name),9,P1)', `$(${text}(C(t).doc,x.name)),9,P1)`, 'property actor picker'],
    ['$(x.name??x.id),1)', `$(${text}(C(t).doc,x.name??x.id)),1)`, 'spawner selection list'],
    ['$(_.takeover.name)', `$(${text}(C(s).doc,_.takeover.name))`, 'behavior dispatcher label'],
    ['const k=b.value.map(P=>P.name??P.id)', `const k=b.value.map(P=>${text}(s.doc,P.name??P.id))`, 'behavior warning names'],
    ['a("b",null,$(Ke.value.name),1)', `a("b",null,$(${text}(C(o).doc,Ke.value.name)),1)`, 'selection chip'],
    ['a("b",null,$(_s.value),1)', `a("b",null,$(${text}(C(o).doc,_s.value)),1)`, 'scene menu title'],
    ['a("small",null,"场景库 · "+$(Bt.value.length)+" 份",1)', 'a("small",null,`场景库 · ${Bt.value.length} 份`,1)', 'scene library count'],
    ['"scene-name":Pn.value?.doc.meta.name??""', `"scene-name":${text}(Pn.value?.doc,Pn.value?.doc.meta.name??"")`, 'import map choice title'],
    ['title:C(o).doc.meta.name,desc:', `title:${text}(C(o).doc,C(o).doc.meta.name),desc:`, 'editor pause title'],
    ['a("h2",sM,$(C(o).doc.meta.name)+', `a("h2",sM,$(${text}(C(o).doc,C(o).doc.meta.name))+`, 'playtest report title'],
    ['dv({name:o.doc.meta.name,settlement:', `dv({sceneId:o.doc.meta.id,name:${text}(o.doc,o.doc.meta.name),settlement:`, 'editor result metadata'],
  ]) editor = replaceOnce(editor, before, after, label);
  if (editor.split('$(d.value.name)').length !== 3) throw new Error('Localization anchor mismatch: behavior template headers');
  editor = editor.replaceAll('$(d.value.name)', `$(${text}(C(s).doc,d.value.name))`);
  if (editor.split('subtitle:`${z?.name??"敌人模板"} 的路线').length !== 3) throw new Error('Localization anchor mismatch: waypoint subtitles');
  editor = editor.replaceAll('subtitle:`${z?.name??"敌人模板"} 的路线', `subtitle:\`\$\{${text}(s.doc,z?.name??"敌人模板")} 的路线`);
  editor = replaceOnce(editor, '`${b.template.name||b.template.id} 的摆射点`', `\`\$\{${text}(s.doc,b.template.name||b.template.id)} 的摆射点\``, 'strafe point subtitle');
  editor = replaceOnce(editor, 'subtitle:`调度器「${b?b.node.name||b.node.id:""}」', `subtitle:\`调度器「\$\{${text}(s.doc,b?b.node.name||b.node.id:"")}」`, 'dispatcher subtitle');
  const optionsStart = editor.indexOf('D=T(()=>{const J=f.value;if(!J)return[];const g=new Set(J.routes.map');
  const optionsEnd = editor.indexOf('function B(J)', optionsStart);
  if (optionsStart < 0 || optionsEnd < optionsStart) throw new Error('Localization anchor mismatch: dispatcher options');
  const options = editor.slice(optionsStart, optionsEnd);
  editor = editor.slice(0, optionsStart) + options.replaceAll('_.template.name', `${text}(o.doc,_.template.name)`).replaceAll('i.name||i.id', `${text}(o.doc,i.name||i.id)`) + editor.slice(optionsEnd);
  output['ClAFWwpi.js'] = editor;
  output['DqtmD7Xr.js'] = replaceOnce(output['DqtmD7Xr.js'], 'title:(e.scene.meta?.name??"").trim()||', `title:${text}(e.scene,(e.scene.meta?.name??"").trim())||`, 'replay title');
  let training = output['DVK7uRSu.js'];
  training = replaceOnce(training, "return{'name':cB,'source':", `return{'sceneId':cA['meta']['id'],'name':${text}(cA,cB),'source':`, 'scene presentation brief');
  training = replaceOnce(training, "bB({'name':cP['value'],'settlement':", "bB({'sceneId':cD['value']?.['sceneId'],'name':cP['value'],'settlement':", 'result scene identity');
  output['DVK7uRSu.js'] = training;
  let hud = output['CymPR-fm.js'];
  for (const [before, after, label] of [
    ['function rM(e,t){', 'function rM(e,t,__sceneId){', 'verdict scene context'],
    ['function lM(e,t){', 'function lM(e,t,__sceneId){', 'highlight scene context'],
    ['function cM(e,t,n){', 'function cM(e,t,n,__sceneId){', 'kill feed scene context'],
    ['const u=l.name||"bot";', `const u=${text}(__sceneId,l.name||"bot");`, 'kill feed name'],
    ['const l=t.killedBy?.name||"";', `const l=${text}(__sceneId,t.killedBy?.name||"");`, 'kill feed killer'],
    ['s=cM(t,n,e.compact?eM:Jb)', 's=cM(t,n,e.compact?eM:Jb,e.sceneId)', 'result feed context'],
    ['highlight:lM(t,n),title:e.name,verdict:rM(t,n)', `highlight:lM(t,n,e.sceneId),title:${text}(e.sceneId,e.name),verdict:rM(t,n,e.sceneId)`, 'result display context'],
  ]) hud = replaceOnce(hud, before, after, label);
  if (hud.split('t.killedBy?.name||"bot"').length !== 3) throw new Error('Localization anchor mismatch: verdict killers');
  hud = hud.replaceAll('t.killedBy?.name||"bot"', `${text}(__sceneId,t.killedBy?.name||"bot")`);
  output['CymPR-fm.js'] = hud;
  output['aQOfOAp-.js'] = replaceOnce(output['aQOfOAp-.js'], '.then(i=>(To.set(n,i),i))',
    '.then(i=>{i=globalThis.__aimI18n.minimapData(i,n);return To.set(n,i),i})', 'canonical minimap labels');
  return output;
}
