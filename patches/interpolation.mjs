function replaceExact(source, before, after, label) {
  if (source.split(before).length - 1 !== 1) {
    throw new Error(`插值补丁版本不匹配：${label}`);
  }
  return source.replace(before, after);
}

// Capture the simulation's adjacent snapshots, rather than the snapshots from
// adjacent rendered frames. At 128 Hz, one rendered frame may span several ticks.
// The optional capture API leaves callers such as the existing replay viewport
// on the original apply-only behavior.
export function applyInterpolationPatch(sources) {
  const output = {...sources};
  let renderer = output['tmIeW3Ig.js'];
  let training = output['CymPR-fm.js'];
  if (typeof renderer !== 'string' || typeof training !== 'string') {
    throw new Error('插值补丁缺少渲染或训练模块');
  }

  renderer = replaceExact(renderer,
    'function ks(A,g,D,w){const B=new Map;let C=-1,Q=null,I=null,E=0,o=null;',
    `function ks(A,g,D,w){const B=new Map;let C=-1,Q=null,I=null,E=0,o=null;
let __aimOfflineCurrent=null,__aimOfflinePrevious=null,__aimOfflineActorSource=null;
const __aimOfflinePreviousActors=new Map;
function __aimOfflineCapture(snapshot){
  if(__aimOfflineCurrent!==null&&snapshot.tick===__aimOfflineCurrent.tick){
    __aimOfflineCurrent=snapshot;
    return;
  }
  __aimOfflinePrevious=__aimOfflineCurrent!==null&&snapshot.tick===__aimOfflineCurrent.tick+1?__aimOfflineCurrent:null;
  __aimOfflineCurrent=snapshot;
}
`, '相邻模拟快照缓冲');

  renderer = replaceExact(renderer,
    '};return{apply(n,G,h,U){e.length=0;const H=n.tick!==C;C=n.tick;const Y=new Set;',
    `};return{capture:__aimOfflineCapture,apply(n,G,h,U){e.length=0;
const __aimOfflineCaptured=__aimOfflineCurrent===n;
const __aimOfflinePaired=__aimOfflineCaptured&&__aimOfflinePrevious!==null&&__aimOfflinePrevious.tick+1===n.tick;
if(__aimOfflinePaired&&__aimOfflineActorSource!==__aimOfflinePrevious){
  __aimOfflinePreviousActors.clear();
  for(const actor of __aimOfflinePrevious.actors)__aimOfflinePreviousActors.set(actor.id,actor);
  __aimOfflineActorSource=__aimOfflinePrevious;
}
const H=n.tick!==C;C=n.tick;const Y=new Set;`, '捕获接口与渲染快照配对');

  renderer = replaceExact(renderer,
    'B.set(v.id,c)}(v.bornTick!==c.bornTick||!c.wasAlive&&v.alive)',
    `B.set(v.id,c)}
if(__aimOfflineCaptured){
  const previousActor=__aimOfflinePaired?__aimOfflinePreviousActors.get(v.id):null;
  c.current=a;
  if(previousActor&&previousActor.templateId===v.templateId&&previousActor.bornTick===v.bornTick&&(!k||previousActor.visible&&previousActor.alive)){
    if(c.__aimOfflinePreviousActor!==previousActor){c.__aimOfflinePreviousActor=previousActor;c.__aimOfflinePreviousPose=uI(previousActor);}
    c.previous=c.__aimOfflinePreviousPose;
  }else{c.previous=a;}
  if(Math.hypot(c.current.x-c.previous.x,c.current.y-c.previous.y,c.current.z-c.previous.z)>In)c.previous=c.current;
}
(v.bornTick!==c.bornTick||!c.wasAlive&&v.alive)`, '角色相邻位置与出生瞬移处理');

  renderer = replaceExact(renderer,
    'I===null?(Q=O,I=O):(H&&(Q=I),I=O);',
    `if(__aimOfflineCaptured){
  if(__aimOfflinePaired){
  const previousPlayer=__aimOfflinePrevious.player,previousEye=yA(previousPlayer,D);
  Q={x:previousEye.x,y:previousEye.y-E,z:previousEye.z};I=O;
  if(Math.hypot(n.player.position.x-previousPlayer.position.x,n.player.position.y-previousPlayer.position.y,n.player.position.z-previousPlayer.position.z)>In)Q=I;
  }else{Q=O;I=O;}
}else{I===null?(Q=O,I=O):(H&&(Q=I),I=O);}`, '相邻相机位置与原回放路径');

  renderer = replaceExact(renderer,
    'B.clear(),C=-1,Q=null,E=0,o=null,I=null',
    'B.clear(),C=-1,Q=null,E=0,o=null,I=null,__aimOfflineCurrent=null,__aimOfflinePrevious=null,__aimOfflineActorSource=null,__aimOfflinePreviousActors.clear()',
    '清理快照与角色引用');

  // Do not call It here: preparation advances the simulation once without
  // invalidating that snapshot cache. Capture tick 0 directly, before preview.
  training = replaceExact(training,
    '$t=null,Zu(E),ke&&Rt.length>0',
    '$t=null,cn.capture(ke.snapshot()),Zu(E),ke&&Rt.length>0',
    '准备阶段初始快照');
  training = replaceExact(training,
    'const Ae=It(ke);if(N?.observe',
    'const Ae=It(ke);cn.capture(Ae);if(N?.observe',
    '每个模拟 tick 捕获');

  output['tmIeW3Ig.js'] = renderer;
  output['CymPR-fm.js'] = training;
  return output;
}
