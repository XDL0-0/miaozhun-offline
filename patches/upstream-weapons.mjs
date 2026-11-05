import {skinMaskShader} from './weapon-effect-shaders.mjs';

// Portable runtimes deliberately import no Three package. The view bridge below
// supplies the exact constructors used by the new client's renderer.
export const UPSTREAM_WEAPON_RUNTIME_FILES = Object.freeze({
  'aim-skin-packs.mjs': 'skin-packs-runtime.mjs',
  'aim-weapon-models.mjs': 'weapon-models-runtime.mjs',
  'aim-weapon-motion.mjs': 'weapon-motion-runtime.mjs',
  'aim-weapon-body-materials.mjs': 'weapon-body-materials-runtime.mjs',
  'aim-weapon-textures.mjs': 'weapon-textures-runtime.mjs',
});
export function upstreamWeaponRuntimeSource(name, source) {
  if (!Object.hasOwn(UPSTREAM_WEAPON_RUNTIME_FILES, name)) throw Error('Unknown weapon runtime: ' + name);
  for (const [target, origin] of Object.entries(UPSTREAM_WEAPON_RUNTIME_FILES)) source = source.replaceAll(`'./${origin}'`, `'./${target}'`);
  return source;
}
function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw Error(`Upstream weapons ${label}: expected 1 anchor, found ${count}`);
  return source.replace(before, after);
}

export function applyUpstreamWeaponsPatch(modules) {
  const output = {...modules};
  const names = ['BZPA0sSg.js', 'CBthEhpW.js', 'CU9F0OR3.js', 'WaGOTZ1D.js', 'CHhqVNl3.js', 'NWEv-78s.js'];
  for (const name of names) {
    if (typeof output[name] !== 'string') throw Error('Upstream weapons missing module: ' + name);
    if (output[name].includes('__aimUpstreamWeapons')) throw Error('Upstream weapons already applied: ' + name);
  }
  const patch = (name, before, after, label) => output[name] = once(output[name], before, after, label);
  const view = (before, after, label) => patch('BZPA0sSg.js', before, after, label);
  view("return{'manifest':a1,'blob':a2,'gunTexture':a3", "return{'stem':Y,'appearance':await __aimLoadWeaponModel(Y),'manifest':a1,'blob':a2,'gunTexture':a3", 'model preload');
  view('function ba(Y){const {manifest:Z,blob:a1}=Y,', 'function ba(Y){let __aimAppearance=null;const {manifest:Z,blob:a1}=Y,', 'appearance ownership');
  view("'setGun'(cc){if(!aL)return;const cd=cc==='ak47';aL['visible']=cd,am['visible']=!cd,ay&&(ay['mesh']['visible']=!cd);}", "'setGun'(cc){if(aL){const cd=cc==='ak47';aL['visible']=cd,am['visible']=!cd,ay&&(ay['mesh']['visible']=!cd);}__aimAppearance?.setGun(cc);}", 'native and skin selection');
  // Apply after the native graph, before the native skeleton upload. Ability
  // visibility stays authoritative, including detained hands and sniper scope.
  view("const cz=bf(cc,cd?.['detained']===!0x0);", "__aimAppearance?.update(cc,cc.hidden===true||(Y.stem!=='knife'&&ck!==null)||cf>0||cd?.detained===true);const cz=bf(cc,cd?.['detained']===!0x0);", 'native clock and ability interruption');
  view("bi=cf,ah['root']['updateMatrixWorld']", "__aimAppearance?.setVisible(aq['visible']),bi=cf,ah['root']['updateMatrixWorld']", 'skin hand visibility');
  view("'measureMuzzle'(cc='vandal'){a3['updateMatrixWorld']", "'measureMuzzle'(cc='vandal'){const skin=__aimAppearance?.measureMuzzle(a4);if(skin)return skin;a3['updateMatrixWorld']", 'skin muzzle');
  view("'fxLayer'(){return{'scene':a3,'camera':a4,'muzzle':av,", "async 'ready'(){return await __aimAppearance?.ready()??0;},'visualRevision'(){return __aimAppearance?.revision??0;},'skinEffectsKey'(){return __aimAppearance?.key??null;},'fxLayer'(){return{'scene':a3,'camera':a4,'muzzle':__aimAppearance?.muzzle??av,'skinBone':name=>__aimAppearance?.effectBone(name),", 'skin effects and readiness');
  view("'dispose'(){if(aj['geometry']['dispose']()", "'dispose'(){__aimAppearance?.dispose();__aimAppearance=null;if(aj['geometry']['dispose']()", 'appearance disposal');
  view("return c3;}export{_a as F", "__aimAppearance=__aimCreateWeaponAppearance({types:{Group:E,Geometry:b,Attribute:c,Bone:B,Skeleton:C,SkinnedMesh:A,Mesh:d,Material:u,Physical:__aimPhysical,Texture:F,DataTexture:g,half:__aimHalf,rgba:h,equirect:P,linear:i,linearSrgb:'srgb-linear',Vector3:f,Quaternion:n,srgb:H,repeat:G},parent:aq,baseRig:al,baseRest:Z.gun.skeleton,armsRig:ah,originals:[am,aL,aC,aD,aE,aI,aJ,ay?.mesh,...aG],stem:Y.stem,initial:Y.appearance,environment:ak,deferWorldUpdate:true});Y={...Y,appearance:null};return c3;}export{_a as F", 'same-engine construction');
  output['BZPA0sSg.js'] = 'import{fB as __aimPhysical,di as __aimHalf}from"./CqM6URxy.js";import{loadWeaponModel as __aimLoadWeaponModel,createWeaponAppearance as __aimCreateWeaponAppearance}from"./aim-weapon-models.mjs";\n' + output['BZPA0sSg.js'];
  patch('NWEv-78s.js', "'dispose'(){q['dispose'](),m['dispose']()", "'dispose'(){o['dispose']();q['dispose'](),m['dispose']()", 'settings preview releases its viewmodel and subscription');

  const game = (before, after, label) => patch('CBthEhpW.js', before, after, label);
  game('So=()=>tn?.limitedAmmo===!0||t.reloadAnyAmmo?.current===!0', 'So=()=>Tl(De()).canFire', 'native manual reload gate');
  game('const Un=ke.takeInspectPresses()>0;', 'const Un=ke.takeInspectPresses()>0;if(Un&&!Et&&Tl(De()).canFire&&t.phase.current==="running"&&!N(Me.tick+1)&&!ae(Me.tick+1))ma({at:(Me.tick+1)*we,inspect:true,weapon:De()});', 'gun inspect edge');
  game('reloadSince:Q.reloadSince,equipAt:', 'reloadSince:Q.reloadSince,reloadDuration:ka(De()).reloadSeconds,equipAt:', 'native reload duration');
  game('playFire(t=null){const n=this.ensure();n&&this.fire(n.context,n.master,t,n.context.currentTime)}', 'playFire(t=null){__aimSkins.setActiveWeapon(t);const n=this.ensure();n&&!__aimSkins.playFire(n.context,n.master,t,n.context.currentTime)&&this.fire(n.context,n.master,t,n.context.currentTime)}', 'skin player fire audio');
  game('playKill(t){const n=this.settings.current??fs,s=n.killKit;if(this.weaponSounds===null||n.killSound===!1||!vr(s))return!1;const o=this.ensure();if(!o)return!1;const a=o.context.currentTime,l=K1(o.context,o.master,s,t,a);return l?(this.killVoice&&$1(this.killVoice,a),this.killVoice=l,l.source.onended=()=>{l.gain.disconnect(),this.killVoice===l&&(this.killVoice=null)},!0):!1}', 'playKill(t,weapon=null){const n=this.settings.current??fs,s=n.killKit;if(n.killSound===!1)return!1;const o=this.ensure();if(!o)return!1;const a=o.context.currentTime,l=__aimSkins.playKill(o.context,o.master,weapon,t,a)??(this.weaponSounds!==null&&vr(s)?K1(o.context,o.master,s,t,a):null);if(!l)return!1;this.killVoice&&$1(this.killVoice,a);this.killVoice=l;const ended=l.source.onended;l.source.onended=()=>{ended?.();l.gain.disconnect();this.killVoice===l&&(this.killVoice=null)};return!0}', 'kill voice ownership');
  game('if(ue.kind==="meleeHit"){if(En>0){if(Le.playKill?.(qt)', 'if(ue.kind==="meleeHit"){if(En>0){if(Le.playKill?.(qt,"melee")', 'melee kill audio');
  game('if(Le.playFire(ze.player.weapon??De()),En>0){if(Le.playKill?.(qt)', 'if(Le.playFire(ze.player.weapon??De()),En>0){if(Le.playKill?.(qt,ze.player.weapon??De())', 'gun kill audio');
  game('ht=!1,pn=0,On=!1,qt=0,Xa=vx(M)', 'ht=!1,pn=0,On=!1,qt=0,Xa=(__aimSkins.reset(),vx(M))', 'round media reset');
  game('dispose(){this.killVoice=null,this.flash.clear(),this.context?.close()', 'dispose(){this.killVoice&&$1(this.killVoice,this.context?.currentTime??0);__aimSkins.reset();this.killVoice=null,this.flash.clear(),this.context?.close()', 'audio disposal');
  game('function as(){if(!t.viewModel.current)', 'function as(){__aimSkins.setActiveWeapon(De());void __aimSkins.prepare();if(!t.viewModel.current)', 'media preparation and active weapon');
  game('function cA(){return Xi(iA,"viewmodel").catch(e=>null)}', 'async function cA(){const base=await Xi(iA,"viewmodel").catch(e=>null);if(!base)return null;try{const response=await fetch("/skin-packs/models/fire-effects.json");if(response.ok){const skins=await response.json();for(const key of["guns","systems","materials","textures","meshes"])Object.assign(base[key],skins[key]);}}catch(error){console.warn("Skin effects unavailable",error);}return base;}', 'skin particle catalogue');
  game('frame($){if(!o){if(!H&&$.enabled&&$.viewModel&&q()', 'frame($){$={...$,weapon:$.viewModel?.skinEffectsKey?.()??$.weapon};if(!o){if(!H&&$.enabled&&$.viewModel&&q()', 'loaded skin effects key');
  game('function C($){return O=>{const K=$.muzzle;', 'function C($){return O=>{const skin=$.skinBone?.(O);if(skin)return{matrix:()=>skin.matrixWorld.elements};const K=$.muzzle;', 'source skin effect bones');
  game('ji(tc+v.file,"viewmodel").then(p=>{const w=new Ol(p);return w.userData.assetBitmap=p,w})', '(v.file.startsWith("/skin-packs/models/")?Promise.resolve(__aimFxImage(v.file)).then(p=>p?new Ol(p):new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(new Ol(image));image.onerror=reject;image.src=v.file;})):ji(tc+v.file,"viewmodel").then(p=>{const w=new Ol(p);return w.userData.assetBitmap=p,w}))', 'reuse skin effect images without closing shared bitmaps');
  game('function K0(e){switch(e.kind){', 'function K0(e){switch(e.kind){case"skinmask":return[e.tex,e.texO,e.lut].filter(Boolean);', 'skin material dependencies');
  const mask = 'case"skinmask":{const uv=p=>Zt(...p.scale,...p.offset),motion=p=>Zt(p.rot,p.rate,...p.scroll),p=h('+JSON.stringify(skinMaskShader)+',{map:{value:v(d.tex)},opacityMap:{value:v(d.texO??d.tex)},lut:{value:v(d.lut??d.tex)},eUV:{value:uv(d.e)},oUV:{value:uv(d.o)},eMotion:{value:motion(d.e)},oMotion:{value:motion(d.o)},tint:{value:new He(...d.tint)},alphaChannel:{value:d.useAlpha?1:0},opacityChannel:{value:d.opacityAlpha?1:0},alphaMult:{value:d.alphaMult},emissiveMult:{value:d.emissiveMult},useOpacity:{value:d.texO?1:0},useLut:{value:d.lut?1:0},texColor:{value:d.texColor?1:0},lutMin:{value:d.lutMin},lutMax:{value:d.lutMax},lutVariant:{value:d.lutVariant},nLuts:{value:d.nLuts},gameTime:e.gameTime,polarE:{value:d.polarE?1:0},polarO:{value:d.polarO?1:0},dissolveChannel:{value:d.dissolve},dissolveSoft:{value:d.dissolveSoft}});p.userData.dyn=true;return p;}';
  game('switch(d.kind){case"mf":', 'switch(d.kind){'+mask+'case"mf":', 'skin mask shader');
  game('lutRow:{value:.125},strength:{value:1}', 'lutRow:{value:d.lutRow??.125},strength:{value:1}', 'source gun light LUT row');
  game('case"meshrot":ln(u.d,n,Ne,o),', 'case"movie":l.movieFps=At(u.fps,n,o);l.sub=u.start||0;break;case"orbit":{const rotation=ln(u.rotation,n,[0,0,0],o),offset=ln(u.offset,n,[0,0,0],o),rate=ln(u.rate,n,[0,0,0],o),last=__aimOrbitPoint(offset,rotation);l.orbit={offset,rotation,rate,last};for(let k=0;k<3;k++)l.loc[k]+=last[k];break;}case"meshrot":ln(u.d,n,Ne,o),', 'source flipbook and orbit spawn');
  game('case"drag":{const m=At(r.d,i.rt,o),', 'case"movie":i.sub=((r.start||0)+Math.floor(i.rt/Math.max(i.inv,1e-9)*(i.movieFps||30)))%(a.sub[0]*a.sub[1]);break;case"orbit":{const p=i.orbit;if(p){for(let k=0;k<3;k++)p.rotation[k]+=p.rate[k]*n;const next=__aimOrbitPoint(p.offset,p.rotation);for(let k=0;k<3;k++)i.loc[k]+=next[k]-p.last[k];p.last=next;}break;}case"drag":{const m=At(r.d,i.rt,o),', 'source flipbook and orbit update');
  output['CBthEhpW.js'] = 'import{skinPacks as __aimSkins}from"./aim-skin-packs.mjs";import{weaponEffectImage as __aimFxImage}from"./aim-weapon-models.mjs";function __aimOrbitPoint(v,a){let[x,y,z]=v;for(let k=0;k<3;k++){const c=Math.cos(a[k]*Math.PI*2),s=Math.sin(a[k]*Math.PI*2);if(k===0)[y,z]=[y*c-z*s,y*s+z*c];else if(k===1)[x,z]=[x*c+z*s,-x*s+z*c];else[x,y]=[x*c-y*s,x*s+y*c];}return[x,y,z];}\n' + output['CBthEhpW.js'];

  const settings = (before, after, label) => patch('CU9F0OR3.js', before, after, label);
  settings("const oh=M({'__name':'AudioPanel','setup'(d4){const d5=H(Ue),d6=s(()=>d5['audio']['audioSettings']['value']);", "const oh=M({'__name':'AudioPanel','setup'(d4){const d5=H(Ue),d6=s(()=>d5['audio']['audioSettings']['value']);let __aimSkinHost=null,__aimSkinDispose=null;function __aimMountSkinHost(host){if(host===__aimSkinHost)return;__aimSkinDispose?.();__aimSkinHost=host;__aimSkinDispose=host?__aimMountSkins(host,()=>d6.value):null;}", 'skin settings mount');
  settings("return G(()=>{dw?.['close'](),dw=null,dx=null,dg&&(dg['audition']['value']=null);}),(dH,dI)=>(Y(),O(V,null,[dI[0x4]||", "return G(()=>{__aimSkinDispose?.();__aimSkinDispose=null;__aimSkinHost=null;dw?.['close'](),dw=null,dx=null,dg&&(dg['audition']['value']=null);}),(dH,dI)=>(Y(),O(V,null,[U('div',{ref:__aimMountSkinHost,'data-role':'skin-settings-host'}),dI[0x4]||", 'skin settings render and cleanup');
  output['CU9F0OR3.js'] = 'import{mountSkinSettings as __aimMountSkins}from"./aim-skin-packs.mjs";\n'+output['CU9F0OR3.js'];

  const banner = (before, after, label) => patch('WaGOTZ1D.js', before, after, label);
  banner("function la(cC,cD=rl,cE=dl){const cF=ul[cC],cG={};", "function la(cC,cD=rl,cE=dl){const skin=__aimSkins.bannerDefinition(cC);if(skin)return skin;const cF=ul[cC],cG={};if(!cF)return null;", 'skin banner definitions');
  banner("cI=cE['view']['current']['seq'],cJ=!0x1", "cI=cE['view']['current']['seq']-(cE['kit']?.startsWith('skin:')&&cE['view']['current']['seq']>0?1:0),cJ=!0x1", 'first kill after HUD mount');
  banner("for(const cX of na)cH[cX]=cP(cG['layers'][cX]);", "if(cG.composite)cH.composite=cG.frames?cG.frames.map(url=>__aimSkins.getImage(url)):__aimSkins.getImage(cG.composite);else for(const cX of na)cH[cX]=cW?.startsWith('skin:')?__aimSkins.getImage(cG['layers'][cX]):cP(cG['layers'][cX]);", 'decoded banner reuse');
  banner("cG['headshot']&&(cH['headshot']=cP(cG['headshot']));", "cG['headshot']&&(cH['headshot']=cW?.startsWith('skin:')?__aimSkins.getImage(cG['headshot']):cP(cG['headshot']));", 'decoded headshot reuse');
  banner("cW&&cX&&cX['clearRect'](0x0,0x0,cW['width'],cW['height']);", "cW&&cX&&(cX.setTransform(1,0,0,1,0,0),cX['clearRect'](0x0,0x0,cW['width'],cW['height']));", 'full canvas clear');
  banner("if(!cX||!cY||!cG)return;const {frame:cZ,ring:d0,emblem:d1,pip:d2,headshot:d3}=cH;", "if(!cX||!cY||!cG)return;if(cG.composite){__aimDrawSkinBanner(cX,cY,cH.composite,cW,cK,cL);return;}const {frame:cZ,ring:d0,emblem:d1,pip:d2,headshot:d3}=cH;", 'native timing composite banner');
  banner("cR(cY,d2,d7['x'],d7['y'],d7['rotation'],d9?cW['newPipScale']:0x1),", "(cG.pipSprite?__aimDrawSkinSprite(cY,d2,cG.pipSprite,d7.x,d7.y,d7.rotation,d9?cW.newPipScale:1):cG.pipFallback==='generic-chevron'?__aimDrawSkinPip(cY,d7.x,d7.y,d7.rotation,d9?cW.newPipScale:1):cR(cY,d2,d7['x'],d7['y'],d7['rotation'],d9?cW['newPipScale']:0x1)),", 'source sprite and fallback pip');
  banner("pl(cW['now']-cM)", "pl(Math.max(0,cW['now']-cM))", 'kills before clock update');
  banner("'setup'(cC){const cD=bJ(Ee);c7();function cE(eb)", "'setup'(cC){const cD=bJ(Ee);const __aimSkinRevision=by(0);bF(__aimSkins.subscribe(()=>{__aimSkinRevision.value+=1}));c7();function cE(eb)", 'reactive banner selection');
  banner("const cT=bz(()=>{const eb=cD['audioSettings']['value']['killKit'];return cD['displaySettings']['value']['killBanners']&&M(eb)&&la(eb)?eb:null;})", "const cT=bz(()=>{__aimSkinRevision.value;if(!cD['displaySettings']['value']['killBanners'])return null;const skin=__aimSkins.bannerKit();if(skin)return skin;const eb=cD['audioSettings']['value']['killKit'];return M(eb)&&la(eb)?eb:null;})", 'native banner setting and fallback');
  output['WaGOTZ1D.js'] = 'import{skinPacks as __aimSkins,drawCompositeBanner as __aimDrawSkinBanner,drawFallbackPip as __aimDrawSkinPip,drawSpritePip as __aimDrawSkinSprite}from"./aim-skin-packs.mjs";\n'+output['WaGOTZ1D.js'];
  patch('CHhqVNl3.js', '只在限制弹药的场景里有用；小球项目子弹无限，按了没有反应', '手动换弹；无限子弹时也可使用。换弹期间无法开火', 'reload help');
  patch('CHhqVNl3.js', '拿刀时按一下，看看手里的刀；挥刀会打断检视', '拿刀或皮肤枪械时按一下进行检视；开火、换弹或切枪会打断检视', 'inspect help');
  for (const name of names) output[name] = '/* __aimUpstreamWeapons: 2026-11-05 */\n'+output[name];
  return output;
}
