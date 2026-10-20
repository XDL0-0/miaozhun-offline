// Keep projected bot-order labels on the world renderer's camera frame. The
// channel belongs to the stable view container, so publishing before mount or
// replacing view.current cannot leave a listener attached to an old snapshot.
export function publishBotOrder(view){
  const listeners=view?.[Symbol.for('aim-offline.bot-order-paint.v1')];
  if(listeners)for(const paint of listeners)paint(view.current);
}

export function subscribeBotOrder(view,paint){
  const key=Symbol.for('aim-offline.bot-order-paint.v1');
  let listeners=view[key];
  if(!listeners){listeners=new Set();Object.defineProperty(view,key,{value:listeners,configurable:true});}
  listeners.add(paint);paint(view.current);
  let active=true;
  return ()=>{
    if(!active)return;active=false;listeners.delete(paint);
    if(!listeners.size)delete view[key];
  };
}

// es() already includes actor.position + actor.offset. Replace that translation
// with the existing rendered root's translation; keep its head/animation offset.
// This changes only the temporary point sent to the screen projection.
export function offsetBotOrderHead(head,actor,rendered){
  if(!rendered)return head;
  const position=actor.position,offset=actor.offset;
  head.x+=rendered.x-(position.x+(offset?.x??0));
  head.y+=rendered.y-(position.y+(offset?.y??0));
  head.z+=rendered.z-(position.z+(offset?.z??0));
  return head;
}

function once(source,before,after,label){
  const count=source.split(before).length-1;
  if(count!==1)throw Error(`Bot-order patch ${label}: expected 1 anchor, found ${count}`);
  return source.replace(before,after);
}

export function applyBotOrderPatch(sources){
  let training=sources['CymPR-fm.js'],overlay=sources['DVK7uRSu.js'],renderer=sources['tmIeW3Ig.js'];
  if(typeof training!=='string'||typeof overlay!=='string'||typeof renderer!=='string')throw Error('Bot-order patch: missing training/overlay/renderer module');
  if(training.includes('__aimPublishBotOrder')||overlay.includes('__aimSubscribeBotOrder'))throw Error('Bot-order patch already applied');
  // Pin the ordering as well as the individual edits: a lookup is safe only
  // after cn.apply has positioned the actors for this exact render callback.
  const renderStart=training.indexOf('function yd(E){'),actorApply=training.indexOf('cn.apply(oe,Ht,le,vd(oe)),Ht=[];',renderStart),orderWrite=training.indexOf('In.write(t.botOrder.current,{camera:i.camera,snapshot:oe,seconds:Te})',renderStart),present=training.indexOf('i.render(),p.render(i.renderer),i.present()',renderStart);
  if(renderStart<0||actorApply<renderStart||orderWrite<actorApply||present<orderWrite)throw Error('Bot-order patch: same-frame actor projection ordering changed');
  // The interpolation patch adds capture before apply; insert at apply itself
  // so the method is compatible with both native and already-patched renders.
  renderer=once(renderer,'apply(n,G,h,U){e.length=0;',
    'actorPosition(id){return B.get(id)?.mesh.root.position??null},apply(n,G,h,U){e.length=0;',
    'rendered actor position lookup');
  training=once(training,'In.write(t.botOrder.current,{camera:i.camera,snapshot:oe,seconds:Te})',
    'In.write(t.botOrder.current,{camera:i.camera,snapshot:oe,seconds:Te,actorPosition:cn.actorPosition})',
    'same-frame actor position input');
  training=once(training,'const B=es(G,I,qt(_.seconds,G.id));B.y+=Yy;',
    'const B=__aimOffsetBotOrderHead(es(G,I,qt(_.seconds,G.id)),G,_.actorPosition?.(G.id));B.y+=Yy;',
    'label render position');
  training=once(training,'const L=es(k,C,qt(_.seconds,k.id)),R=jo(_.camera,L);',
    'const L=__aimOffsetBotOrderHead(es(k,C,qt(_.seconds,k.id)),k,_.actorPosition?.(k.id)),R=jo(_.camera,L);',
    'aim-line render position');
  // This point follows the same-frame camera update and In.write projection,
  // including its disabled/result clearing path. Keep route planning intact.
  training=once(training,
    'Ho.aimLine||(t.botOrder.current.aim.shown=!1)):sc(t.botOrder.current));const lo=',
    'Ho.aimLine||(t.botOrder.current.aim.shown=!1)):sc(t.botOrder.current),__aimPublishBotOrder(t.botOrder));const lo=',
    'publish projected labels');

  const start=overlay.indexOf("const It=0xc,Bl=0x4,Nl=c({'__name':'BotOrderOverlay'"),end=overlay.indexOf(",Pl=w(Nl,",start);
  if(start<0||end<0)throw Error('Bot-order patch component: missing pinned native overlay');
  let component=overlay.slice(start,end);
  component=once(component,
    "if(!cY){cG[cW]!==''&&(cX['classList']['remove']('is-shown'),cG[cW]='');continue;}",
    "if(!cY){if(cG[cW]!==''){cX['style']['visibility']='hidden';cX['style']['transform']='';cX['classList']['remove']('is-shown','is-next');cG[cW]='';cH[cW]=!1;}continue;}",
    'hide invalid labels immediately');
  component=once(component,
    "const d1=String(cY['order']);",
    "cX['style']['visibility']='visible';const d1=String(cY['order']);",
    'reveal valid labels');
  component=once(component,'let cK=0x0,cL=0x0,cM=0x0,cN=null;',
    'let cK=null,cL=0x0,cM=0x0,cN=null;','subscription lifetime');
  component=once(component,"function cT(){cS(cC['view']['current']),cK=requestAnimationFrame(cT);}",
    'function cT(cU){cS(cU);}','same-frame paint callback');
  component=once(component,'cK=requestAnimationFrame(cT);',
    "cK=__aimSubscribeBotOrder(cC['view'],cT);",'subscribe on mount');
  component=once(component,'cK&&cancelAnimationFrame(cK),cK=0x0,',
    'cK?.(),cK=null,','unsubscribe on unmount');
  overlay=overlay.slice(0,start)+component+overlay.slice(end);
  return {...sources,
    'CymPR-fm.js':`const __aimPublishBotOrder=(${publishBotOrder.toString()});const __aimOffsetBotOrderHead=(${offsetBotOrderHead.toString()});\n`+training,
    'DVK7uRSu.js':`const __aimSubscribeBotOrder=(${subscribeBotOrder.toString()});\n`+overlay,
    'tmIeW3Ig.js':renderer};
}

export function applyBotOrderCss(css){
  if(css.includes('--aim-offline-bot-order-synchronous'))throw Error('Bot-order CSS already applied');
  const selector='.al-bot-order-badge[data-v-10bab01d]{',start=css.indexOf(selector),end=css.indexOf('}',start);
  if(start<0||end<0||css.split(selector).length!==2)throw Error('Bot-order CSS: missing pinned badge rule');
  const rule=once(css.slice(start,end),'opacity:0;transition:opacity .15s ease;',
    'opacity:0;visibility:hidden;transition:none;--aim-offline-bot-order-synchronous:1;','remove old-position fade');
  css=css.slice(0,start)+rule+css.slice(end);
  return once(css,'.al-bot-order-badge.is-shown[data-v-10bab01d]{opacity:.55}',
    '.al-bot-order-badge.is-shown[data-v-10bab01d]{opacity:.55;visibility:visible}','visible label rule');
}
