const __aimOfflineLocale=globalThis.__aimI18n??{t:value=>value,format:(template,values)=>template.replace(/\{(\d+)\}/g,(match,index)=>index<values.length?String(values[index]):match)};
(()=>{
 'use strict';
 const localFetch=window.fetch.bind(window);
 const offlineUrl=input=>{const raw=input instanceof Request?input.url:String(input);const u=new URL(raw,location.href);if(['ishoutu.cn','static.ishoutu.cn'].includes(u.hostname))return location.origin+u.pathname+u.search;if(u.origin===location.origin||u.protocol==='blob:'||u.protocol==='data:')return raw;throw new Error((__aimOfflineLocale.t('离线版已阻止外网请求')));};
 window.fetch=(input,init)=>{try{const url=offlineUrl(input);return localFetch(input instanceof Request&&url===input.url?input:url,init)}catch(e){return Promise.reject(e)}};
 const originalOpen=XMLHttpRequest.prototype.open;
 XMLHttpRequest.prototype.open=function(method,url,...rest){return originalOpen.call(this,method,offlineUrl(url),...rest)};
 if(navigator.sendBeacon)navigator.sendBeacon=()=>false;
 const favoriteKey='al-offline-favorites',codePattern=/^[a-zA-Z0-9_-]{1,128}$/;
 const readFavorites=()=>{try{const data=JSON.parse(localStorage.getItem(favoriteKey)||'[]');return new Set(Array.isArray(data)?data.filter(v=>typeof v==='string'&&codePattern.test(v)):[])}catch{return new Set()}};
 let favorites=readFavorites(),favoritesOnly=false,favoriteButton,statusLabel;
 const hidden=new Set([(__aimOfflineLocale.t('下载桌面版')),(__aimOfflineLocale.t('下载新版桌面版')),(__aimOfflineLocale.t('访客登录或注册')),(__aimOfflineLocale.t('登录/注册')),(__aimOfflineLocale.t('登录')),(__aimOfflineLocale.t('免费体检')),(__aimOfflineLocale.t('玩家创意工坊')),(__aimOfflineLocale.t('有延迟问题？点击检测')),(__aimOfflineLocale.t('排行榜')),(__aimOfflineLocale.t('上榜局')),(__aimOfflineLocale.t('申请一局上榜')),(__aimOfflineLocale.t('重试提交')),(__aimOfflineLocale.t('分享')),(__aimOfflineLocale.t('上传分享')),(__aimOfflineLocale.t('试皮肤'))]);
 const unavailableSelector='.hall-rail-quick,.al-cloud-replay-share,.al-cloud-replay-unshare,[data-action="arm-ranked"],[data-action="open-board"],[data-action="pw-login"],[data-action="pw-board-login"],.hall-community,.hall-other-groups,.hall-qq-groups,[data-action="copy-kook"],[data-action="copy-qq-group"],[data-action="copy-other-qq-group"],[data-action="join-kook"],[data-action="join-qq-group"],[data-action="join-other-qq-group"],[data-action="toggle-other-qq-groups"],[data-action="toggle-full-qq-groups"],[data-action="open-review"],[data-test="door-replay"]';
 const isFavoriteFilter=el=>el.matches('button[data-toggle="fav"],button[data-offline-favorite-filter]')||(el.matches('.al-wk-toggles .al-wk-toggle')&&el.textContent.trim()===(__aimOfflineLocale.t('收藏')));
 const cardSelector='article.al-wk-card[data-share-code]',structureSelector=cardSelector+',.al-wk-sec';
 const noteSelector='.st-sync[data-role="sync-state"],.al-run-guest[data-role="guest-sync-hint"]';
 const lightSelector='button,a,'+unavailableSelector+','+noteSelector;
 function setAttr(el,name,value){if(el.getAttribute(name)!==value)el.setAttribute(name,value);}
 function setFlag(el,name,value){if(el.hasAttribute(name)!==value)el.toggleAttribute(name,value);}
 function setClass(el,name,value){if(el.classList.contains(name)!==value)el.classList.toggle(name,value);}
 function hide(el){if(el.style.display!=='none')el.style.display='none';}
 function within(root,selector){const nodes=[...root.querySelectorAll(selector)];if(root instanceof Element&&root.matches(selector))nodes.unshift(root);return nodes;}
 function syncFavoriteFilter(el){
  setAttr(el,'data-offline-favorite-filter','');
  setAttr(el,'aria-pressed',String(favoritesOnly));
  setClass(el,'is-on',favoritesOnly);setAttr(el,'title',(__aimOfflineLocale.t('只看本机收藏')));
 }
 function setText(el,text){if(el&&el.textContent!==text)el.textContent=text;}
 function announce(message){setText(statusLabel,message);}
 function showFavorites(value){
  if(value){const tab=[...document.querySelectorAll('.hall-tab')].find(el=>el.textContent.trim()===(__aimOfflineLocale.t('瓦工坊')));if(tab&&!tab.classList.contains('is-active'))tab.click();}
  favoritesOnly=value;setFlag(document.body,'data-offline-favorites-only',value);tidy();
 }
 function toggleFavorite(code){
  const next=new Set(favorites);next.has(code)?next.delete(code):next.add(code);
  try{localStorage.setItem(favoriteKey,JSON.stringify([...next]));favorites=next;announce(next.has(code)?(__aimOfflineLocale.t('已收藏到本机')):(__aimOfflineLocale.t('已取消本机收藏')));tidy()}
  catch{announce((__aimOfflineLocale.t('收藏未保存：本地存储不可用或已满')));}
 }
 function tidy(){
  tidySubtree(document);updateFavorites();
 }
 // Training HUD text updates never need a whole-page or workshop scan.
 function tidySubtree(root){
  if(document.title!==(__aimOfflineLocale.t('瞄准专家 · 离线版')))document.title=(__aimOfflineLocale.t('瞄准专家 · 离线版'));
  for(const el of within(root,'button,a')){
   const label=el.getAttribute('aria-label')?.trim()||el.getAttribute('title')?.trim()||el.textContent.trim();
   const url=el.tagName==='A'&&el.getAttribute('href')?new URL(el.href,location.href):null;
   if(hidden.has(label)||label.startsWith((__aimOfflineLocale.t('看排行榜：')))||label.startsWith((__aimOfflineLocale.t('分享这一局')))||label.startsWith((__aimOfflineLocale.t('复制这一局的分享链接')))||(url&&url.origin===location.origin&&(url.pathname==='/buyer-home'||url.pathname.startsWith('/buyer-home/')))||(url&&url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)))hide(el);
   if(isFavoriteFilter(el))syncFavoriteFilter(el);
  }
  for(const el of within(root,unavailableSelector))hide(el);
  for(const note of within(root,'.st-sync[data-role="sync-state"]')){
   setText(note.querySelector(':scope > span > b'),(__aimOfflineLocale.t('设置保存在本机')));
   setText(note.querySelector(':scope > span > span'),(__aimOfflineLocale.t('，立即生效；可通过完整备份迁移')));
   setAttr(note,'data-state','offline');if(note.hasAttribute('title'))note.removeAttribute('title');
  }
  for(const note of within(root,'.al-run-guest[data-role="guest-sync-hint"]'))setText(note,(__aimOfflineLocale.t('这局成绩保存在本机，可通过“完整备份”迁移到其他设备。')));
 }
 function updateFavorites(){
  for(const el of document.querySelectorAll('button[data-toggle="fav"],button[data-offline-favorite-filter],.al-wk-toggles .al-wk-toggle'))if(isFavoriteFilter(el))syncFavoriteFilter(el);
  const seen=new Set();let visible=0;
  for(const card of document.querySelectorAll(cardSelector)){
   const code=card.dataset.shareCode;if(!codePattern.test(code))continue;
   let button=card.querySelector('.al-wk-fav');
   if(!button){button=document.createElement('button');button.className='al-wk-fav';button.type='button';button.dataset.offlineFavorite='';button.textContent='♥';(card.querySelector('.al-wk-art')||card).append(button);}
   setAttr(button,'data-offline-code',code);
   const on=favorites.has(code);setClass(button,'is-on',on);setAttr(button,'aria-pressed',String(on));
   const title=card.querySelector('.al-wk-name,.al-wk-card-title,h3,h2')?.textContent.trim()||card.querySelector((__aimOfflineLocale.t('[aria-label^="开始游玩："]')))?.getAttribute('aria-label').slice(globalThis.__aimI18n.t((__aimOfflineLocale.t('开始游玩：'))).length)||code;
   setAttr(button,'aria-label',(on?(__aimOfflineLocale.t('取消本机收藏：')):(__aimOfflineLocale.t('收藏到本机：')))+title);setAttr(button,'title',on?(__aimOfflineLocale.t('取消本机收藏')):(__aimOfflineLocale.t('收藏到本机')));
   const excluded=favoritesOnly&&(!on||seen.has(code));setFlag(card,'data-offline-excluded',excluded);
   if(!excluded){visible++;seen.add(code);}
  }
  for(const section of document.querySelectorAll('.al-wk-sec'))setFlag(section,'data-offline-empty',favoritesOnly&&![...section.querySelectorAll(cardSelector)].some(card=>!card.hasAttribute('data-offline-excluded')));
  let empty=document.getElementById('offline-favorites-empty');
  const workshop=document.querySelector('article.al-wk-card[data-share-code]')?.closest('.al-wk')||document.querySelector('.al-wk-sec')?.parentElement;
  if(!empty&&workshop){empty=document.createElement('p');empty.id='offline-favorites-empty';empty.textContent=(__aimOfflineLocale.t('当前筛选下没有本机收藏。可切换地图或搜索条件，或返回全部项目。'));workshop.append(empty);}
  if(empty)setFlag(empty,'hidden',!favoritesOnly||visible>0);
  if(favoriteButton){setText(favoriteButton,favoritesOnly?(__aimOfflineLocale.t('显示全部项目')):(__aimOfflineLocale.t('本机收藏（'))+favorites.size+(__aimOfflineLocale.t('）')));setAttr(favoriteButton,'aria-pressed',String(favoritesOnly));}
 }
 // Capture explicit workshop favorites only; account state remains untouched.
 document.addEventListener('click',event=>{
  const target=event.target instanceof Element?event.target.closest('button,a'):null;if(!target)return;
  if(isFavoriteFilter(target)){event.preventDefault();event.stopImmediatePropagation();showFavorites(!favoritesOnly);return;}
  const favorite=target.matches('.al-wk-fav,[data-offline-favorite]')&&target.closest('article.al-wk-card[data-share-code]');
  if(favorite){const code=favorite.dataset.shareCode;if(codePattern.test(code)){event.preventDefault();event.stopImmediatePropagation();toggleFavorite(code)}return;}
  if(target.classList.contains('hall-rail-item')&&target.textContent.trim()===(__aimOfflineLocale.t('收藏项目'))){event.preventDefault();event.stopImmediatePropagation();showFavorites(true);return;}
  if(target.classList.contains('hall-tab')&&target.textContent.trim()===(__aimOfflineLocale.t('瓦工坊'))&&favoritesOnly)showFavorites(false);
 },true);
 window.addEventListener('storage',event=>{if(event.key===favoriteKey){favorites=readFavorites();tidy()}});
 function readStorage(){const storage={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('al-'))storage[key]=localStorage.getItem(key)}return storage;}
 const replaySchema={index:'id',blob:'id'},studioSchema={draft:null,scenes:'id'};
 function openLocalDatabase(name,schema,create=false){return new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(new Error((__aimOfflineLocale.t('浏览器不支持本地数据库'))));return;}
  const request=indexedDB.open(name);let blocked=false,absent=false;
  request.onupgradeneeded=event=>{
   if(!create){absent=true;request.transaction.abort();return;}
   if(event.oldVersion!==0){request.transaction.abort();return;}
   for(const[store,keyPath]of Object.entries(schema))request.result.createObjectStore(store,keyPath===null?undefined:{keyPath});
  };
  request.onerror=()=>absent?resolve(null):reject(request.error||new Error((__aimOfflineLocale.t('无法读取本地数据库 '))+name));
  request.onblocked=()=>{blocked=true;reject(new Error((__aimOfflineLocale.t('本地数据库正被其他窗口占用，请关闭其他训练窗口后重试'))));};
  request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}
   try{const names=Object.keys(schema);if(!names.every(store=>db.objectStoreNames.contains(store)))throw new Error((__aimOfflineLocale.t('缺少数据表')));
    const tx=db.transaction(names,'readonly');for(const[store,keyPath]of Object.entries(schema)){const actual=tx.objectStore(store);if(actual.keyPath!==keyPath||actual.autoIncrement)throw new Error((__aimOfflineLocale.t('数据表键结构不同')));}
   }catch(error){db.close();reject(new Error(name+(__aimOfflineLocale.t(' 本地数据结构不兼容：'))+error.message));return;}
   db.onversionchange=()=>db.close();resolve(db);
  };
 });}
 const openReplayDatabase=create=>openLocalDatabase('aimlab-replay',replaySchema,create);
 function replaySnapshot(db){return new Promise((resolve,reject)=>{
  const transaction=db.transaction(['index','blob'],'readonly'),index=transaction.objectStore('index').getAll(),blob=transaction.objectStore('blob').getAll();
  transaction.oncomplete=()=>resolve({index:index.result,blob:blob.result});transaction.onerror=transaction.onabort=()=>reject(transaction.error||new Error((__aimOfflineLocale.t('读取录像失败'))));
 });}
 function toBase64(bytes){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error((__aimOfflineLocale.t('录像编码失败'))));reader.readAsDataURL(new Blob([bytes]));});}
 async function exportReplays(){const db=await openReplayDatabase(false);if(!db)return{schema:1,index:[],blob:[]};let snapshot;try{snapshot=await replaySnapshot(db)}finally{db.close()}
  const blobs=[];for(const entry of snapshot.blob){if(typeof entry.id!=='string'||!ArrayBuffer.isView(entry.bytes))throw new Error((__aimOfflineLocale.t('录像库包含未知格式，未导出')));blobs.push({id:entry.id,base64:await toBase64(entry.bytes)});}return{schema:1,index:snapshot.index,blob:blobs};
 }
 function decodeReplays(data){
  if(!data||data.schema!==1||!Array.isArray(data.index)||!Array.isArray(data.blob))throw new Error((__aimOfflineLocale.t('录像备份格式不正确')));
  const indexes=data.index;if(indexes.length>500||data.blob.length>500)throw new Error((__aimOfflineLocale.t('录像条目过多')));
  const ids=new Set();for(const entry of indexes){if(!entry||typeof entry.id!=='string'||!entry.id||!entry.meta||entry.meta.id!==entry.id||!Number.isFinite(entry.meta.recordedAt)||!Number.isFinite(entry.meta.duration))throw new Error((__aimOfflineLocale.t('录像索引损坏')));if(ids.has(entry.id))throw new Error((__aimOfflineLocale.t('录像索引重复')));ids.add(entry.id);}
  const seen=new Set(),blobs=data.blob.map(entry=>{if(!entry||typeof entry.id!=='string'||!ids.has(entry.id)||seen.has(entry.id)||typeof entry.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.base64))throw new Error((__aimOfflineLocale.t('录像内容损坏')));seen.add(entry.id);const binary=atob(entry.base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return{id:entry.id,bytes};});
  if(seen.size!==ids.size)throw new Error((__aimOfflineLocale.t('录像内容不完整')));return{index:indexes,blob:blobs};
 }
 async function importReplays(data,existing){const db=existing||await openReplayDatabase(true);try{await new Promise((resolve,reject)=>{
  const tx=db.transaction(['index','blob'],'readwrite');for(const entry of data.index)tx.objectStore('index').put(entry);for(const entry of data.blob)tx.objectStore('blob').put(entry);
  tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error((__aimOfflineLocale.t('录像恢复失败，可能是空间不足'))));
 })}finally{if(!existing)db.close()}}
 function studioSnapshot(db){return new Promise((resolve,reject)=>{
  const tx=db.transaction(['draft','scenes'],'readonly'),draft=tx.objectStore('draft'),keys=draft.getAllKeys(),values=draft.getAll(),scenes=tx.objectStore('scenes').getAll();
  tx.oncomplete=()=>resolve({schema:1,draft:keys.result.map((key,index)=>({key,value:values.result[index]})),scenes:scenes.result});
  tx.onerror=tx.onabort=()=>reject(tx.error||new Error((__aimOfflineLocale.t('读取场景库失败'))));
 });}
 function checkSceneJSON(value){
  if(typeof value!=='string')throw new Error((__aimOfflineLocale.t('场景正文必须为 JSON 文本')));
  let doc;try{doc=JSON.parse(value)}catch{throw new Error((__aimOfflineLocale.t('场景 JSON 损坏')));}
  if(!doc||typeof doc!=='object'||!doc.meta||!doc.environment||!doc.rules||!Array.isArray(doc.actors)||!Array.isArray(doc.spawners))throw new Error((__aimOfflineLocale.t('场景正文结构不完整')));
 }
 function decodeStudio(data){
  if(!data||data.schema!==1||!Array.isArray(data.draft)||!Array.isArray(data.scenes))throw new Error((__aimOfflineLocale.t('场景备份格式不正确')));
  const keys=new Set(),ids=new Set();
  for(const entry of data.draft){if(!entry||typeof entry.key!=='string'||keys.has(entry.key)||entry.value===undefined)throw new Error((__aimOfflineLocale.t('草稿索引损坏')));keys.add(entry.key);
   if(entry.key==='current')checkSceneJSON(entry.value);if(entry.key==='current-owner'&&typeof entry.value!=='string')throw new Error((__aimOfflineLocale.t('草稿归属格式不正确')));
  }
  for(const scene of data.scenes){if(!scene||typeof scene.id!=='string'||!scene.id||ids.has(scene.id)||typeof scene.name!=='string'||!Number.isFinite(scene.updatedAt))throw new Error((__aimOfflineLocale.t('已保存场景索引损坏')));ids.add(scene.id);checkSceneJSON(scene.doc);}
  return data;
 }
 async function exportStudio(){const db=await openLocalDatabase('aimlab-studio',studioSchema,false);if(!db)return{schema:1,draft:[],scenes:[]};try{const data=await studioSnapshot(db);return decodeStudio(data)}finally{db.close()}}
 async function importStudio(data,db){await new Promise((resolve,reject)=>{
  const tx=db.transaction(['draft','scenes'],'readwrite');for(const entry of data.draft)tx.objectStore('draft').put(entry.value,entry.key);for(const scene of data.scenes)tx.objectStore('scenes').put(scene);
  tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error((__aimOfflineLocale.t('场景恢复失败，可能是空间不足'))));
 });}
 async function restoreDatabases(replays,studio){let replayDB,studioDB;try{
  // Validate both local database schemas before the first merge write.
  if(replays)replayDB=await openReplayDatabase(true);if(studio)studioDB=await openLocalDatabase('aimlab-studio',studioSchema,true);
  if(replays)await importReplays(replays,replayDB);if(studio)await importStudio(studio,studioDB);
 }finally{replayDB?.close();studioDB?.close()}}
 function downloadBackup(data){const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=data.studio?(__aimOfflineLocale.t('瞄准专家-成绩设置录像场景完整备份.json')):data.replays?(__aimOfflineLocale.t('瞄准专家-成绩设置和录像备份.json')):(__aimOfflineLocale.t('瞄准专家-成绩设置备份.json'));a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 let scheduled=false,favoritesPending=false;
 const pendingRoots=new Set();
 function queueSubtree(root){pendingRoots.add(root);}
 function observeChanges(records){
  for(const record of records){
   const target=record.target instanceof Element?record.target:record.target.parentElement;
   if(!target)continue;
   if(record.type==='attributes'){
    if(target.matches('.al-wk-toggle'))queueSubtree(target);
    if(record.attributeName==='data-share-code'&&target.matches(cardSelector))favoritesPending=true;
    continue;
   }
   if(record.type!=='childList')continue;
   const added=[...record.addedNodes].filter(node=>node instanceof Element),removed=[...record.removedNodes].filter(node=>node instanceof Element);
   // Vue's HUD textContent writes replace text nodes; leave those on the game path.
   // Labels in an existing button or offline notice still need local adaptation.
   const control=target.closest('button,a,'+noteSelector);
   if(control)queueSubtree(control);
   const name=target.closest('.al-wk-name,.al-wk-card-title,h3,h2');
   if(name?.closest(cardSelector))favoritesPending=true;
   for(const node of added)if(node.matches(lightSelector)||node.querySelector(lightSelector))queueSubtree(node);
   for(const node of [...added,...removed])if(node.matches(structureSelector)||node.querySelector(structureSelector))favoritesPending=true;
  }
  if(scheduled||!favoritesPending&&!pendingRoots.size)return;
  scheduled=true;requestAnimationFrame(()=>{
   scheduled=false;
   const roots=[...pendingRoots];pendingRoots.clear();const refreshFavorites=favoritesPending;favoritesPending=false;
   // A newly mounted parent already includes its queued descendants.
   for(const root of roots)if(root.isConnected&&!roots.some(other=>other!==root&&other.contains(root)))tidySubtree(root);
   if(refreshFavorites)updateFavorites();
  });
 }
 document.addEventListener('DOMContentLoaded',()=>{
  const style=document.createElement('style');style.textContent=`#offline-tools{position:fixed;left:8px;bottom:10px;z-index:1000;display:flex;align-items:center;gap:8px;padding:5px 8px;background:#172324e8;color:#a4e9c8;border:1px solid #356452;border-radius:5px;font:11px system-ui;max-width:calc(100vw - 16px);flex-wrap:wrap}#offline-tools button,#offline-tools a{color:inherit;background:none;border:0;cursor:pointer;font:inherit}#offline-tools button:disabled{opacity:.5;cursor:wait}#offline-tools button[aria-pressed=true]{text-decoration:underline}.al-wk-fav.is-on{color:#ff7596!important}.al-wk-card[data-offline-excluded],.al-wk-sec[data-offline-empty]{display:none!important}body[data-offline-favorites-only] .al-wk-shelf{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;overflow:visible!important}body[data-offline-favorites-only] .al-wk-grid{display:contents!important}body[data-offline-favorites-only] .al-wk-sec-more,body[data-offline-favorites-only] .al-wk-pageno{display:none!important}#offline-favorites-empty{padding:20px;color:#b4c2bd}body:has(.al-train-layer,.hall-train-layer) #offline-tools{display:none}`;document.head.append(style);
  const tools=document.createElement('div');tools.id='offline-tools';const label=document.createElement('span');label.textContent=(__aimOfflineLocale.t('本机离线版'));tools.append(label);
  const editor=document.createElement('a');editor.href='/aim/studio';editor.target='_blank';editor.rel='noopener noreferrer';editor.dataset.action='offline-open-studio';editor.textContent=(__aimOfflineLocale.t('场景编辑器'));tools.append(editor);
  favoriteButton=document.createElement('button');favoriteButton.type='button';favoriteButton.onclick=()=>showFavorites(!favoritesOnly);tools.append(favoriteButton);
  function backupButton(text,complete){const button=document.createElement('button');button.type='button';button.textContent=text;button.title=complete?(__aimOfflineLocale.t('备份成绩、设置、收藏、录像和编辑器草稿及场景')):(__aimOfflineLocale.t('仅备份成绩、设置和收藏，不包含录像或编辑器场景'));button.onclick=async()=>{button.disabled=true;try{announce(complete?(__aimOfflineLocale.t('正在完整备份录像和场景，请稍候…')):(__aimOfflineLocale.t('正在备份…')));const data={format:'aim-offline-backup-v2',created:new Date().toISOString(),storage:readStorage()};if(complete){data.replays=await exportReplays();data.studio=await exportStudio();}downloadBackup(data);announce(complete?(__aimOfflineLocale.t('已完整导出成绩、设置、录像与场景')):(__aimOfflineLocale.t('已导出成绩与设置（不含录像和场景）')))}catch(error){announce((__aimOfflineLocale.t('备份失败：'))+error.message)}finally{button.disabled=false}};tools.append(button);}
  backupButton((__aimOfflineLocale.t('备份成绩与设置')),false);backupButton((__aimOfflineLocale.t('完整备份')),true);
  const importButton=document.createElement('button');importButton.type='button';importButton.textContent=(__aimOfflineLocale.t('恢复备份'));const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;importButton.onclick=()=>input.click();input.onchange=async()=>{
   const file=input.files[0];input.value='';if(!file)return;importButton.disabled=true;
   try{const data=JSON.parse(await file.text());if(!['aim-offline-backup-v1','aim-offline-backup-v2'].includes(data.format)||!data.storage||typeof data.storage!=='object'||Array.isArray(data.storage))throw new Error((__aimOfflineLocale.t('备份格式不正确')));
    const storage=Object.entries(data.storage).filter(([key,value])=>key.startsWith('al-')&&typeof value==='string'),replays=data.replays?decodeReplays(data.replays):null,studio=data.studio?decodeStudio(data.studio):null;
    const contents=[(__aimOfflineLocale.t('成绩与设置'))];if(replays)contents.push(replays.index.length+(__aimOfflineLocale.t(' 局录像')));if(studio)contents.push(studio.scenes.length+(__aimOfflineLocale.t(' 个已保存场景和 '))+studio.draft.length+(__aimOfflineLocale.t(' 条草稿数据')));
    if(!confirm((__aimOfflineLocale.t('将备份中的'))+contents.join((__aimOfflineLocale.t('、')))+(__aimOfflineLocale.t('合并到本机。同名项目会被覆盖，其余数据保留。继续恢复？'))))return;
    await restoreDatabases(replays,studio);
    const previous=storage.map(([key])=>[key,localStorage.getItem(key)]);
    try{for(const[key,value]of storage)localStorage.setItem(key,value)}catch(error){for(const[key,value]of previous){try{value===null?localStorage.removeItem(key):localStorage.setItem(key,value)}catch{}}throw error;}
    location.reload();
   }catch(error){alert((__aimOfflineLocale.t('恢复失败：'))+error.message)}finally{importButton.disabled=false}
  };tools.append(importButton,input);
  statusLabel=document.createElement('span');statusLabel.setAttribute('role','status');statusLabel.setAttribute('aria-live','polite');tools.append(statusLabel);globalThis.__aimI18n.mountLanguageSelector(tools);document.body.append(tools);
  const app=document.getElementById('app'),observer=new MutationObserver(observeChanges),observeOptions={childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed','class','data-toggle','data-share-code']};
  if(app)observer.observe(app,observeOptions);
  // The retained trainer mounts its UI beside #app. Give that portal the same
  // targeted offline controls/notices; HUD text still skips adaptation scans.
  function watchPortal(root){if(root instanceof Element&&root.matches('.aimlab-page')&&!app?.contains(root)){observer.observe(root,observeOptions);tidySubtree(root);}}
  document.querySelectorAll('.aimlab-page').forEach(watchPortal);
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)watchPortal(node)}).observe(document.body,{childList:true});
  tidy();
 });
})();
