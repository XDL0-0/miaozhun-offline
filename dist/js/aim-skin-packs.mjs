const __aimOfflineLocale=globalThis.__aimI18n??{t:value=>value,format:(template,values)=>template.replace(/\{(\d+)\}/g,(match,index)=>index<values.length?String(values[index]):match)};
// Shared by the settings panel and the game. Playback only reads decoded caches.
export const SKIN_WEAPONS = ['vandal', 'phantom', 'sheriff', 'operator'];
const STORAGE_KEY = 'aim-offline.skin-packs.v2';
const original = () => ({collection: 'default', theme: 'default', banner: 'default', fireEnabled: true, killEnabled: true, bannerEnabled: true});
export const killIndex = kills => (Math.max(1, Math.floor(Number(kills) || 1)) - 1) % 5 + 1;
const safePath = value => typeof value === 'string' && /^\/skin-packs\/[a-z0-9/-]+\.(ogg|png)$/.test(value) ? value : null;

export function createSkinPackRuntime(options = {}) {
  const fetcher = options.fetcher ?? (globalThis.fetch && globalThis.fetch.bind(globalThis));
  const makeDecoder = options.makeDecoder ?? (() => typeof OfflineAudioContext === 'function' ? new OfflineAudioContext(2, 1, 48000) : null);
  const makeImage = options.makeImage ?? (() => new Image());
  const makeAudio = options.makeAudio ?? (() => new AudioContext());
  const timeoutMs = options.timeoutMs ?? 8000;
  const withDeadline = async work => {
    const controller = new AbortController();
    let timer;
    // Bound optional skin work so an unavailable file cannot hold the scene gate.
    try {
      return await Promise.race([work(controller.signal), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error((__aimOfflineLocale.t('素材请求超时')))); }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  let storage;
  try { storage = options.storage ?? globalThis.localStorage; } catch {}
  let manifest = null, initializing = null, manifestError = '', decoder = null, activeWeapon = null;
  let previewContext = null, previewSerial = 0;
  const listeners = new Set(), buffers = new Map(), audioTasks = new Map(), images = new Map(), imageTasks = new Map(), failures = new Map();
  const previewVoices = new Set(), selections = Object.fromEntries(SKIN_WEAPONS.map(weapon => [weapon, original()]));
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}'); } catch {}
  const emit = () => { for (const listener of listeners) { try { listener(); } catch (error) { globalThis.console?.error(error); } } };
  const collectionFor = id => manifest?.collections.find(item => item.id === id);
  function details(weapon) {
    const selection = selections[weapon], collection = selection && collectionFor(selection.collection);
    const theme = collection?.weapons.includes(weapon) && collection.themes.find(item => item.id === selection.theme);
    return {selection, collection, theme};
  }
  function normalized(weapon, candidate) {
    if (!SKIN_WEAPONS.includes(weapon)) throw new Error('Unsupported skin weapon: ' + weapon);
    if (!candidate || candidate.collection === 'default') return original();
    const collection = collectionFor(candidate.collection);
    if (!collection?.weapons.includes(weapon)) throw new Error('Skin does not support ' + weapon);
    const theme = collection.themes.find(item => item.id === candidate.theme) ?? collection.themes[0];
    if (!theme) throw new Error('Skin has no themes');
    const banner = theme.banners.find(item => item.id === candidate.banner) ?? theme.banners[0];
    return {collection: collection.id, theme: theme.id, banner: banner?.id ?? 'default',
      fireEnabled: candidate.fireEnabled !== false, killEnabled: candidate.killEnabled !== false, bannerEnabled: candidate.bannerEnabled !== false};
  }
  function stopVoice(voice, at) {
    if (!voice) return;
    try {
      voice.gain.gain.cancelScheduledValues?.(at);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, at);
      voice.gain.gain.linearRampToValueAtTime(0, at + .03);
      voice.source.stop(at + .03);
    } catch {}
  }
  function stopAudition() {
    previewSerial++;
    for (const voice of previewVoices) { try { voice.source.stop(); } catch {} }
    previewVoices.clear();
  }
  async function loadAudio(url, context) {
    url = safePath(url);
    if (!url) return null;
    if (buffers.has(url)) return buffers.get(url);
    if (audioTasks.has(url)) return audioTasks.get(url);
    const job = (async () => {
      try {
        decoder ??= context ?? makeDecoder();
        if (!decoder) throw new Error((__aimOfflineLocale.t('音频解码器尚未就绪')));
        const buffer = await withDeadline(async signal => {
          const response = await fetcher(url, {signal});
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return await decoder.decodeAudioData(await response.arrayBuffer());
        });
        if (!buffer) throw new Error((__aimOfflineLocale.t('音频解码失败')));
        buffers.set(url, buffer); failures.delete(url);
        return buffer;
      } catch (error) { failures.set(url, String(error.message ?? error)); return null; }
    })();
    audioTasks.set(url, job);
    try { return await job; } finally { if (audioTasks.get(url) === job) audioTasks.delete(url); }
  }
  function loadImage(url) {
    url = safePath(url);
    if (!url) return Promise.resolve(null);
    if (images.has(url)) return Promise.resolve(images.get(url));
    if (imageTasks.has(url)) return imageTasks.get(url);
    const job = new Promise(resolve => {
      let picture, settled = false;
      const done = value => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (picture) picture.onload = picture.onerror = null;
        if (value) { images.set(url, value); failures.delete(url); }
        resolve(value);
      };
      const timer = setTimeout(() => { failures.set(url, (__aimOfflineLocale.t('横幅图像加载超时'))); done(null); }, timeoutMs);
      try {
        picture = makeImage(); picture.decoding = 'async';
        picture.onload = async () => {
          try {
            if (picture.decode) await picture.decode();
            if (!(picture.naturalWidth > 0)) throw new Error((__aimOfflineLocale.t('横幅图像为空')));
            done(picture);
          } catch (error) { if (!settled) failures.set(url, String(error.message ?? error)); done(null); }
        };
        picture.onerror = () => { failures.set(url, (__aimOfflineLocale.t('横幅图像加载失败'))); done(null); };
        picture.src = url;
      } catch (error) { failures.set(url, String(error.message ?? error)); done(null); }
    });
    imageTasks.set(url, job);
    return job.finally(() => { if (imageTasks.get(url) === job) imageTasks.delete(url); });
  }
  async function preload(weapon, context) {
    const weapons = weapon ? [weapon] : SKIN_WEAPONS;
    const tasks = [];
    for (const current of weapons) {
      const {selection, theme} = details(current);
      if (!theme) continue;
      if (selection.fireEnabled) tasks.push(loadAudio(theme.fire[current], context));
      if (selection.killEnabled) for (const url of Object.values(theme.kills)) tasks.push(loadAudio(url, context));
      if (selection.bannerEnabled) tasks.push(loadImage(theme.banners.find(item => item.id === selection.banner)?.url));
    }
    await Promise.all(tasks);
    emit();
  }
  async function initialize() {
    if (manifest) return manifest;
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        const value = await withDeadline(async signal => {
          const response = await fetcher('/skin-packs/index.json', {signal});
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return await response.json();
        });
        if (value.schemaVersion !== 2 || !Array.isArray(value.collections)) throw new Error((__aimOfflineLocale.t('皮肤目录版本不匹配')));
        for (const collection of value.collections) {
          if (!Array.isArray(collection.weapons) || !Array.isArray(collection.themes)) throw new Error((__aimOfflineLocale.t('皮肤目录格式错误')));
          for (const theme of collection.themes) if (!theme.fire || !theme.kills || !Array.isArray(theme.banners)) throw new Error((__aimOfflineLocale.t('主题目录格式错误')));
        }
        manifest = value; manifestError = '';
        for (const weapon of SKIN_WEAPONS) { try { selections[weapon] = normalized(weapon, saved[weapon]); } catch { selections[weapon] = original(); } }
        emit();
        return manifest;
      } catch (error) { manifestError = (__aimOfflineLocale.t('皮肤目录加载失败，使用原版效果：')) + String(error.message ?? error); emit(); return null; }
      finally { initializing = null; }
    })();
    return initializing;
  }
  function select(weapon, change) {
    const previous = selections[weapon] ?? original();
    let candidate = {...previous, ...change};
    if (change.collection && change.collection !== previous.collection) candidate = {...original(), ...change};
    selections[weapon] = normalized(weapon, candidate);
    stopAudition();
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(selections)); } catch {}
    emit();
    return preload(weapon);
  }
  function playBuffer(context, master, url, when, gain = .5) {
    const buffer = buffers.get(safePath(url));
    if (!buffer || !context || !master || context.state === 'closed') return null;
    let source, output;
    try {
      source = context.createBufferSource(); output = context.createGain();
      source.buffer = buffer; output.gain.value = gain;
      source.connect(output); output.connect(master);
      const voice = {source, gain: output};
      source.onended = () => { source.disconnect(); output.disconnect(); previewVoices.delete(voice); };
      source.start(when);
      return voice;
    } catch { try { source?.disconnect(); output?.disconnect(); } catch {} return null; }
  }
  function playFire(context, master, weapon, when = context.currentTime) {
    const {selection, theme} = details(weapon);
    return selection?.fireEnabled && theme ? !!playBuffer(context, master, theme.fire[weapon], when) : false;
  }
  function playKill(context, master, weapon, kills, when = context.currentTime) {
    const {selection, theme} = details(weapon);
    return selection?.killEnabled && theme ? playBuffer(context, master, theme.kills[killIndex(kills)], when) : null;
  }
  function bannerKit() {
    const {selection, theme} = details(activeWeapon);
    const banner = theme?.banners.find(item => item.id === selection.banner);
    return selection?.bannerEnabled && banner && images.has(banner.url) ? 'skin:' + banner.url : null;
  }
  function bannerDefinition(kit) {
    const url = kit?.startsWith('skin:') ? safePath(kit.slice(5)) : null;
    return url && images.has(url) ? {composite: url, pipRadius: 100, headshotOffset: [0, -90]} : null;
  }
  function setActiveWeapon(weapon) {
    const next = SKIN_WEAPONS.includes(weapon) ? weapon : null;
    if (activeWeapon !== next) { activeWeapon = next; emit(); }
  }
  async function prepare(context) { await initialize(); if (manifest) await preload(null, context); }
  function availability(weapon) {
    const {selection, theme} = details(weapon);
    const banner = theme?.banners.find(item => item.id === selection.banner);
    const status = url => !safePath(url) ? 'missing' : failures.has(url) ? 'failed' : buffers.has(url) || images.has(url) ? 'ready' : 'loading';
    return {fire: status(theme?.fire[weapon]), kills: Array.from({length: 5}, (_, i) => status(theme?.kills[i + 1])), banner: status(banner?.url)};
  }
  async function audition(weapon, kind, kills = 1, audioSettings = {}) {
    stopAudition();
    if (audioSettings.enabled === false || audioSettings.volume === 0) throw new Error((__aimOfflineLocale.t('请先开启总音效并提高音量')));
    previewContext ??= makeAudio();
    const context = previewContext, serial = previewSerial;
    await context.resume?.();
    await initialize();
    const {theme} = details(weapon);
    const sequence = kind === 'sequence' ? [1, 2, 3, 4, 5] : [kills];
    const urls = sequence.map(count => kind === 'fire' ? theme?.fire[weapon] : kind === 'successive' ? theme?.successive : theme?.kills[count]);
    if (urls.some(url => !safePath(url))) throw new Error((__aimOfflineLocale.t('该素材缺失，游戏中使用原版效果')));
    await Promise.all(urls.map(url => loadAudio(url, context)));
    if (serial !== previewSerial) return false;
    if (urls.some(url => !buffers.has(url))) throw new Error((__aimOfflineLocale.t('试听加载失败，游戏中使用原版效果')));
    const master = context.createGain(); master.gain.value = Math.max(0, Math.min(1, audioSettings.volume ?? .5)); master.connect(context.destination);
    let previous;
    const start = context.currentTime + .02;
    for (const [i, url] of urls.entries()) {
      const at = start + i * .9, voice = playBuffer(context, master, url, at);
      if (previous) stopVoice(previous, at);
      if (voice) { previewVoices.add(voice); previous = voice; }
    }
    // The master belongs to this audition, including any scheduled later voices.
    const last = previous;
    if (last) { const ended = last.source.onended; last.source.onended = () => { ended(); master.disconnect(); }; }
    else master.disconnect();
    emit(); return true;
  }
  return {
    initialize, prepare, preload, select, playFire, playKill, bannerKit, bannerDefinition, setActiveWeapon,
    audition, stopAudition, stopVoice, availability,
    reset() { setActiveWeapon(null); stopAudition(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get manifest() { return manifest; }, get manifestError() { return manifestError; },
    selection: weapon => ({...(selections[weapon] ?? original())}),
    details, getImage: url => images.get(url) ?? null,
  };
}

// Composite PNGs are complete banners. Keep them intact and add the HUD's count
// and headshot state; do not claim that a flat wiki image contains separate layers.
export function drawCompositeBanner(canvas, context, image, animation, kills, headshot, pixelRatio = globalThis.devicePixelRatio || 1) {
  if (!image?.complete || !(image.naturalWidth > 0)) return false;
  const size = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
  if (canvas.width !== size || canvas.height !== size) canvas.width = canvas.height = size;
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, size, size);
  context.save();
  const scale = size / 300 * animation.scale;
  context.setTransform(scale, 0, 0, scale, size / 2, size / 2);
  context.globalAlpha = animation.alpha;
  context.drawImage(image, -136, -146, 272, 272);
  const count = killIndex(kills);
  context.fillStyle = '#fff';
  for (let i = 0; i < count; i++) {
    context.beginPath(); context.arc((i - (count - 1) / 2) * 17, 135, i === count - 1 ? 4 * animation.newPipScale : 4, 0, Math.PI * 2); context.fill();
  }
  if (headshot) { context.font = 'bold 13px sans-serif'; context.textAlign = 'center'; context.fillText('HEADSHOT', 0, 120); }
  context.restore(); return true;
}

export const skinPacks = createSkinPackRuntime();
if (typeof window !== 'undefined') void skinPacks.prepare();

export function mountSkinSettings(host, getAudioSettings = () => ({})) {
  const doc = host.ownerDocument;
  let weapon = 'vandal', disposed = false, notice = '';
  const previewFailures = new Set();
  const make = (tag, text, className) => { const node = doc.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  const section = make('section', '', 'aim-skin-settings');
  section.setAttribute('data-role', 'skin-settings');
  const heading = make('h3', (__aimOfflineLocale.t('枪械皮肤与击杀反馈'))), intro = make('p', (__aimOfflineLocale.t('各枪械独立保存音效与击杀横幅。缺失或未加载成功的素材使用当前原版效果。')));
  const controls = make('div', '', 'aim-skin-controls'), content = make('div'), status = make('p', '', 'aim-skin-notice');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  section.append(heading, intro, controls, content, status); host.replaceChildren(section);
  function dropdown(label, items, value, change, disabled = false) {
    const wrapper = make('label', label), select = make('select');
    select.setAttribute('aria-label', label); select.disabled = disabled;
    for (const item of items) { const option = make('option', item.label); option.value = item.id; select.append(option); }
    select.value = value; select.addEventListener('change', () => change(select.value)); wrapper.append(select); return wrapper;
  }
  function update(change) { notice = ''; void skinPacks.select(weapon, change).catch(error => { notice = error.message; render(); }); }
  function button(label, kind, count, enabled) {
    const node = make('button', label); node.type = 'button'; node.disabled = !enabled;
    node.addEventListener('click', () => {
      notice = (__aimOfflineLocale.t('正在准备试听…')); renderStatus();
      void skinPacks.audition(weapon, kind, count, getAudioSettings()).then(played => { if (!disposed && played) { notice = (__aimOfflineLocale.t('正在试听：')) + label; renderStatus(); } }).catch(error => { if (!disposed) { notice = error.message; renderStatus(); } });
    }); return node;
  }
  function renderStatus() { status.textContent = notice || skinPacks.manifestError; }
  function render() {
    if (disposed) return;
    const focused = section.contains(doc.activeElement) ? doc.activeElement?.getAttribute('aria-label') : null;
    const manifest = skinPacks.manifest, selection = skinPacks.selection(weapon), {collection, theme} = skinPacks.details(weapon);
    controls.replaceChildren(dropdown((__aimOfflineLocale.t('枪械')), [{id: 'vandal', label: (__aimOfflineLocale.t('Vandal · 狂徒'))}, {id: 'phantom', label: (__aimOfflineLocale.t('Phantom · 幻影'))}, {id: 'sheriff', label: (__aimOfflineLocale.t('Sheriff · 正义'))}, {id: 'operator', label: (__aimOfflineLocale.t('Operator · 冥驹'))}], weapon, value => { weapon = value; notice = ''; skinPacks.stopAudition(); render(); }), dropdown((__aimOfflineLocale.t('皮肤')), [{id: 'default', label: (__aimOfflineLocale.t('原版默认'))}, ...(manifest?.collections.filter(item => item.weapons.includes(weapon)).map(item => ({id: item.id, label: item.name})) ?? [])], selection.collection, value => update({collection: value}), !manifest));
    content.replaceChildren();
    if (theme) {
      controls.append(dropdown((__aimOfflineLocale.t('主题')), collection.themes.map(item => ({id: item.id, label: item.label})), selection.theme, value => update({theme: value}), collection.themes.length === 1));
      controls.append(dropdown((__aimOfflineLocale.t('横幅样式')), theme.banners, selection.banner, value => update({banner: value}), theme.banners.length < 2));
      const modes = make('div', '', 'aim-skin-modes');
      for (const [key, label] of [['fireEnabled', (__aimOfflineLocale.t('皮肤开火音效'))], ['killEnabled', (__aimOfflineLocale.t('皮肤击杀音效'))], ['bannerEnabled', (__aimOfflineLocale.t('皮肤击杀横幅'))]]) {
        const wrapper = make('label'), input = make('input'); input.type = 'checkbox'; input.setAttribute('aria-label', label); input.checked = selection[key]; input.addEventListener('change', () => update({[key]: input.checked})); wrapper.append(input, doc.createTextNode(label)); modes.append(wrapper);
      }
      content.append(modes);
      const available = skinPacks.availability(weapon), word = state => ({missing: (__aimOfflineLocale.t('缺失 → 原版')), failed: (__aimOfflineLocale.t('加载失败 → 原版')), loading: (__aimOfflineLocale.t('异步加载中 → 暂用原版')), ready: (__aimOfflineLocale.t('已就绪'))})[state];
      const killReport = available.kills.every(state => state === 'ready') ? (__aimOfflineLocale.t('5/5 已就绪')) : available.kills.map((state, index) => (__aimOfflineLocale.format("{0} 杀 {1}",[index + 1,word(state)]))).join((__aimOfflineLocale.t('；')));
      const report = make('p', (__aimOfflineLocale.format("开火：{0}；击杀 1–5：{1}；横幅：{2}。",[word(available.fire),killReport,word(available.banner)])));
      report.setAttribute('data-role', 'skin-availability'); content.append(report);
      const auditions = make('div', '', 'aim-skin-auditions');
      auditions.append(button((__aimOfflineLocale.t('开火试听')), 'fire', 1, !!theme.fire[weapon]));
      for (let i = 1; i <= 5; i++) auditions.append(button((__aimOfflineLocale.format("第 {0} 杀",[i])), 'kill', i, !!theme.kills[i]));
      auditions.append(button((__aimOfflineLocale.t('连续 1–5 杀')), 'sequence', 1, [1, 2, 3, 4, 5].every(count => theme.kills[count])));
      if (theme.kills[6]) auditions.append(button((__aimOfflineLocale.t('第 6 杀（附加）')), 'kill', 6, true));
      if (theme.successive) auditions.append(button((__aimOfflineLocale.t('Successive 原始连杀片段')), 'successive', 1, true));
      const stop = make('button', (__aimOfflineLocale.t('停止试听'))); stop.type = 'button'; stop.addEventListener('click', () => { skinPacks.stopAudition(); notice = ''; renderStatus(); }); auditions.append(stop);
      content.append(auditions);
      const banner = theme.banners.find(item => item.id === selection.banner), preview = make('figure', '', 'aim-skin-banner-preview');
      if (banner && !previewFailures.has(banner.url)) {
        const picture = make('img'); picture.src = banner.url; picture.alt = (__aimOfflineLocale.format("{0} · {1} · {2} 击杀横幅",[collection.name,theme.label,banner.label])); picture.width = picture.height = 150;
        picture.addEventListener('error', () => { previewFailures.add(banner.url); preview.replaceChildren(make('figcaption', (__aimOfflineLocale.t('横幅加载失败，游戏中使用原版效果')))); });
        preview.append(picture, make('figcaption', (__aimOfflineLocale.t('击杀横幅预览 · 游戏中显示连杀计数与爆头反馈'))));
      } else preview.append(make('figcaption', (__aimOfflineLocale.t('横幅缺失或加载失败，游戏中使用原版效果'))));
      content.append(preview);
      const retry = make('button', (__aimOfflineLocale.t('重新加载皮肤素材'))); retry.type = 'button'; retry.addEventListener('click', () => { previewFailures.clear(); void skinPacks.prepare().then(render); }); content.append(retry);
    } else content.append(make('p', manifest ? (__aimOfflineLocale.t('使用原版开火、击杀音效和击杀横幅。原版音效可在原版音效区试听。')) : (__aimOfflineLocale.t('正在异步读取皮肤目录…'))));
    if (skinPacks.manifestError) { const retry = make('button', (__aimOfflineLocale.t('重试读取皮肤目录'))); retry.type = 'button'; retry.addEventListener('click', () => void skinPacks.prepare()); content.append(retry); }
    renderStatus();
    if (focused) Array.from(section.querySelectorAll('[aria-label]')).find(node => node.getAttribute('aria-label') === focused)?.focus({preventScroll: true});
  }
  const unsubscribe = skinPacks.subscribe(render);
  render(); void skinPacks.prepare();
  return () => { disposed = true; unsubscribe(); skinPacks.stopAudition(); host.replaceChildren(); };
}
