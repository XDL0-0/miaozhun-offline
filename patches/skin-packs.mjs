// Pin every bridge to the retained public client. Never mutate site/ or inputs.
function replaceOne(text, before, after, label) {
  if (text.split(before).length !== 2) throw new Error('Skin patch version mismatch: ' + label);
  return text.replace(before, after);
}

export function applySkinPacksPatch(modules) {
  const result = {...modules};
  for (const name of ['CymPR-fm.js', 'DCKWp-_u.js', 'DVK7uRSu.js']) {
    if (typeof result[name] !== 'string') throw new Error('Skin patch missing module: ' + name);
    if (result[name].includes('__aimSkins')) throw new Error('Skin patch already applied: ' + name);
  }
  let game = result['CymPR-fm.js'];
  game = replaceOne(game,
    'playFire(t=null){const n=this.ensure();n&&this.fire(n.context,n.master,t,n.context.currentTime)}',
    'playFire(t=null,weapon=t){__aimSkins.setActiveWeapon(weapon);const n=this.ensure();n&&!__aimSkins.playFire(n.context,n.master,weapon,n.context.currentTime)&&this.fire(n.context,n.master,t,n.context.currentTime)}',
    'cached player fireKit bridge');
  game = replaceOne(game,
    'playKill(t){const n=this.settings.current??on,o=n.killKit;if(this.weaponSounds===null||n.killSound===!1||!Na(o))return!1;const a=this.ensure();if(!a)return!1;const s=a.context.currentTime,i=Bf(a.context,a.master,o,t,s);return i?(this.killVoice&&Vf(this.killVoice,s),this.killVoice=i,i.source.onended=()=>{i.gain.disconnect(),this.killVoice===i&&(this.killVoice=null)},!0):!1}',
    'playKill(t,weapon=null){const n=this.settings.current??on,o=n.killKit;if(n.killSound===!1)return!1;const a=this.ensure();if(!a)return!1;const s=a.context.currentTime,i=__aimSkins.playKill(a.context,a.master,weapon,t,s)??(this.weaponSounds!==null&&Na(o)?Bf(a.context,a.master,o,t,s):null);if(!i)return!1;this.killVoice&&Vf(this.killVoice,s);this.killVoice=i;const ended=i.source.onended;i.source.onended=()=>{ended?.();i.gain.disconnect();this.killVoice===i&&(this.killVoice=null)};return!0}',
    'cached killKit bridge and voice ownership');
  game = replaceOne(game, 'ie.playFire(Jn?Ae.player.weapon??qe():null),lo>0',
    'ie.playFire(Jn?Ae.player.weapon??qe():null,Ae.player.weapon??qe()),lo>0', 'actual player weapon on fire');
  game = replaceOne(game, 'ie.playKill?.(io)||ie.playHit(!0)',
    'ie.playKill?.(io,Ae.player.weapon??qe())||ie.playHit(!0)', 'actual player weapon on kill');
  game = replaceOne(game, 'Ht=[],Dt=!1,Fo=0,io=0,ds=q1(E)',
    'Ht=[],Dt=!1,Fo=0,io=0,ds=(__aimSkins.reset(),q1(E))', 'reset at native round rebuild');
  game = replaceOne(game, 'dispose(){this.killVoice=null,this.flash.clear(),this.context?.close()',
    'dispose(){this.killVoice&&Vf(this.killVoice,this.context?.currentTime??0);__aimSkins.reset();this.killVoice=null,this.flash.clear(),this.context?.close()', 'audio session disposal');
  game = replaceOne(game, 'ctx.phase("正在准备本场景技能与枪械…");await d.ready(i.renderer,i.camera,ctx.check);ctx.check();',
    'ctx.phase("正在异步预载皮肤音效与击杀横幅…");await __aimSkins.prepare();ctx.check();__aimSkins.setActiveWeapon(qe());ctx.phase("正在准备本场景技能与枪械…");await d.ready(i.renderer,i.camera,ctx.check);ctx.check();', 'skin preload and initial weapon in scene readiness gate');
  result['CymPR-fm.js'] = 'import{skinPacks as __aimSkins}from"./aim-skin-packs.mjs";\n' + game;

  let settings = result['DCKWp-_u.js'];
  settings = replaceOne(settings, 'const zd=J({__name:"AudioPanel",setup(e){const t=ke(De),n=O(()=>t.audio.audioSettings.value);',
    'const zd=J({__name:"AudioPanel",setup(e){const t=ke(De),n=O(()=>t.audio.audioSettings.value);let __aimSkinHost=null,__aimSkinDispose=null;function __aimMountSkinHost(host){if(host===__aimSkinHost)return;__aimSkinDispose?.();__aimSkinHost=host;__aimSkinDispose=host?__aimMountSkins(host,()=>n.value):null;}', 'settings mount');
  settings = replaceOne(settings, 'return Me(()=>{y?.close(),y=null,p=null,r&&(r.audition.value=null)}),(m,g)=>(h(),b(K,null,[g[4]||',
    'return Me(()=>{__aimSkinDispose?.();__aimSkinDispose=null;__aimSkinHost=null;y?.close(),y=null,p=null,r&&(r.audition.value=null)}),(m,g)=>(h(),b(K,null,[u("div",{ref:__aimMountSkinHost,"data-role":"skin-settings-host"}),g[4]||', 'settings render and cleanup');
  result['DCKWp-_u.js'] = 'import{skinPacks as __aimSkins,mountSkinSettings as __aimMountSkins}from"./aim-skin-packs.mjs";\n' + settings;

  let banner = result['DVK7uRSu.js'];
  banner = replaceOne(banner, "cG=cC['view']['current']['seq'],cH=!0x1",
    "cG=cC['view']['current']['seq']-(cC['kit']?.startsWith('skin:')&&cC['view']['current']['seq']>0?1:0),cH=!0x1", 'consume a fresh first kill when the skin HUD mounts');
  banner = replaceOne(banner, "function Dt(cA,cB=ll,cC=il){const cD=nl[cA],cE={};",
    "function Dt(cA,cB=ll,cC=il){const skin=__aimSkins.bannerDefinition(cA);if(skin)return skin;const cD=nl[cA],cE={};if(!cD)return null;", 'composite banner definition');
  banner = replaceOne(banner, "for(const cV of Pt)cF[cV]=cN(cE['layers'][cV]);",
    "if(cE['composite'])cF['composite']=__aimSkins.getImage(cE['composite']);else for(const cV of Pt)cF[cV]=cN(cE['layers'][cV]);", 'reuse asynchronously decoded banner image');
  banner = replaceOne(banner, "if(!cV||!cW||!cE)return;const {frame:cX,ring:cY,emblem:cZ,pip:d0,headshot:d1}=cF;",
    "if(!cV||!cW||!cE)return;if(cE['composite']){__aimDrawSkinBanner(cV,cW,cF['composite'],cU,cI,cJ);return;}const {frame:cX,ring:cY,emblem:cZ,pip:d0,headshot:d1}=cF;", 'composite draw in existing timed HUD');
  banner = replaceOne(banner, "'setup'(cA,{emit:cB}){const cC=d(Se);bP();function cD(dQ)",
    "'setup'(cA,{emit:cB}){const cC=d(Se);const __aimSkinRevision=x(0);E(__aimSkins.subscribe(()=>{__aimSkinRevision.value+=1}));bP();function cD(dQ)", 'reactive selection and async load subscription');
  banner = replaceOne(banner, "cG=e(()=>{const dQ=cC['audioSettings']['value']['killKit'];return cC['sceneSource']['value']==='custom'&&av(dQ)&&Dt(dQ)?dQ:null;})",
    "cG=e(()=>{__aimSkinRevision.value;const skin=__aimSkins.bannerKit();if(skin)return skin;const dQ=cC['audioSettings']['value']['killKit'];return cC['sceneSource']['value']==='custom'&&av(dQ)&&Dt(dQ)?dQ:null;})", 'selected weapon banner with native fallback');
  result['DVK7uRSu.js'] = 'import{skinPacks as __aimSkins,drawCompositeBanner as __aimDrawSkinBanner}from"./aim-skin-packs.mjs";\n' + banner;
  return result;
}
