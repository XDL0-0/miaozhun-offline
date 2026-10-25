(function (global) {
  'use strict';
  const english = /*__AIM_ENGLISH_CATALOG__*/{};
  const bundledSceneNames = /*__AIM_SCENE_NAMES__*/{};
  const minimapCallouts = /*__AIM_MINIMAP_CALLOUTS__*/{};
  const sceneNames = new Map(Object.entries(bundledSceneNames).map(([id, names]) => [id, new Set(names)]));
  const key = 'al-offline-language';
  const supported = new Set(['zh-CN', 'en']);
  let language = 'zh-CN';
  let requested = null, saved = null;
  try { requested = new URL(global.location.href).searchParams.get('ui-language'); } catch {}
  try { saved = global.localStorage.getItem(key); } catch {}
  if (supported.has(requested)) language = requested;
  else if (supported.has(saved)) language = saved;
  function t(value) {
    if (language !== 'en' || typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!Object.hasOwn(english, trimmed)) return value;
    const start = value.indexOf(trimmed);
    return value.slice(0, start) + english[trimmed] + value.slice(start + trimmed.length);
  }
  function format(template, values) {
    return t(template).replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match);
  }
  async function setLanguage(next) {
    if (!supported.has(next) || next === language) return;
    // The editor installs a verified draft flush while it is mounted.
    // Wait before reloading so an immediate switch cannot outrun autosave.
    await global.__aimBeforeLanguageChange?.();
    const url = new URL(global.location.href);
    try {
      global.localStorage.setItem(key, next);
      url.searchParams.delete('ui-language');
    } catch {
      // Keep switching usable in private/limited-storage browser sessions.
      url.searchParams.set('ui-language', next);
    }
    global.location.replace(url.href);
  }
  function mountLanguageSelector(host) {
    const label = global.document.createElement('label');
    label.className = 'offline-language';
    const caption = global.document.createElement('span');
    caption.textContent = t('界面语言');
    const select = global.document.createElement('select');
    select.id = 'offline-language-select';
    select.setAttribute('aria-label', t('界面语言'));
    for (const [value, text] of [['zh-CN', '简体中文'], ['en', 'English']]) {
      const option = global.document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.setAttribute('data-native-language', value);
      select.append(option);
    }
    select.value = language;
    select.addEventListener('change', async () => {
      select.disabled = true;
      try { await setLanguage(select.value); }
      catch { global.alert(t('切换语言前无法保存当前场景，请先导出场景后重试。')); select.value = language; }
      finally { select.disabled = false; }
    });
    label.append(caption, select);
    host.prepend(label);
  }
  // Translate only bundled presentation metadata. Identity, rules, author names
  // and serialized scene/replay documents remain byte-for-byte unchanged.
  function translateData(data, pathname) {
    if (language !== 'en' || !data || typeof data !== 'object') return data;
    if (/^(?:\/prod-api)?\/api\/v1\//.test(pathname) && typeof data.msg === 'string') data.msg = t(data.msg);
    if (/^(?:\/prod-api)?\/api\/v1\/public\/val\/aimlab\/(workshop|scenes\/[^/?]+)(?:\?|$)/.test(pathname)) {
      for (const scene of Array.isArray(data.data) ? data.data : [data.data]) {
        if (!scene || typeof scene !== 'object') continue;
        if (typeof scene.name === 'string') scene.name = t(scene.name);
        if (typeof scene.description === 'string') scene.description = t(scene.description);
      }
    }
    return data;
  }
  // Saved/custom scene content is user data. Only the known bundled labels are
  // localized at the display boundary; callers keep their original documents.
  function displayName(value) { return t(value); }
  function sceneText(scene, value) {
    const id = typeof scene === 'string' ? scene : scene?.meta?.id;
    return language === 'en' && typeof value === 'string' && sceneNames.get(id)?.has(value.trim()) ? t(value) : value;
  }
  function minimapData(data, mapId) {
    if (language !== 'en' || !data || !minimapCallouts[mapId]) return data;
    return {...data, callouts: (data.callouts || []).map(callout => ({...callout, name: minimapCallouts[mapId][callout.name] ?? callout.name}))};
  }
  global.__aimI18n = Object.freeze({language, t, format, setLanguage, mountLanguageSelector, translateData, displayName, sceneText, minimapData});
  global.document.documentElement.lang = language;
  global.document.title = t('瞄准专家 · 离线版');
})(globalThis);
