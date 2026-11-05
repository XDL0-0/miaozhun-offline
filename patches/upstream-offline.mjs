// Offline adaptations of the pinned public client. Reject changed builds.
function once(source,before,after,label){
  if(source.split(before).length!==2)throw Error('Upstream offline anchor: '+label);
  return source.replace(before,after);
}
export function applyUpstreamOfflinePatch(modules){
  const out={...modules};
  const patch=(file,before,after,label)=>out[file]=once(out[file],before,after,label);
  patch('ATp_kJvD.js',"const v=()=>typeof window<'u'?window[ak(0x16e)][ak(0x306)]:''","const v=()=>'aimpro.world'",'public asset package origin');
  patch('index.FoQE3geO.js','function r1(){if(Hm)return Hm;','function r1(){if(globalThis.__aimI18n)return globalThis.__aimI18n.language;if(Hm)return Hm;','shared locale');
  patch('index.FoQE3geO.js','function Z8e(e){if(e!==r1()){try{localStorage.setItem(DP,e)}catch{return}location.reload()}}','function Z8e(e){return globalThis.__aimI18n.setLanguage(e).catch(()=>alert(globalThis.__aimI18n.t("切换语言前无法保存当前场景，请先导出场景后重试。")))}','safe locale switch');
  patch('BUMqqtoc.js','const S=nh()?.query??{},z=','const S={},z=','local studio mode');
  patch('BUMqqtoc.js','L=wP(),b=qe.filter','L=!1,b=qe.filter','local studio collaboration');
  patch('CKtkyKeR.js','S=C(nv(Ht()?.version)&&!Cy()&&!dn(g.query[$n]))','S=C(!1)','desktop update prompt');
  patch('CKtkyKeR.js','R=C(bs&&!S.value&&!oG()&&!dn(g.query[$n]))','R=C(!1)','community welcome');
  patch('CKtkyKeR.js','D=C(A.value&&!dn(g.query[$n]))','D=C(!1)','remote changelog prompt');
  patch('CKtkyKeR.js','onClick:H[7]||(H[7]=N=>i("action",{kind:"checkup"}))','"data-action":"checkup",onClick:H[7]||(H[7]=N=>i("action",{kind:"checkup"}))','stable offline checkup selector');
  patch('CKtkyKeR.js','onClick:d[0]||(d[0]=c=>s("update:view","workshop"))','"data-action":"tab-workshop",onClick:d[0]||(d[0]=c=>s("update:view","workshop"))','stable workshop navigation selector');
  patch('CKtkyKeR.js','function qa(T){if((T.type??_n.value.find(wn=>wn.code===T.shareCode)?.type??null)!=="ball")return null;','function qa(T){','local map replay availability');
  patch('CKtkyKeR.js','ie!=="records"&&Le.replays.refreshReplayListings()}),Ce($l,','ie!=="records"&&Le.replays.refreshReplayListings()},{immediate:!0}),Ce($l,','initial local replay listings');
  patch('CKtkyKeR.js','t("b",null,"还没登录："),x("这些记录只存在这台设备上，清浏览器数据就没了。登录后会同步到云端，换台设备也能看，成绩还能上排行榜。")','t("b",null,"本机记录："),x("这些记录保存在当前浏览器。清除浏览器数据会删除记录，请通过完整备份迁移。")','local history notice');
  patch('CU9F0OR3.js',"dZ=s(()=>dS!==null&&d5['value']['frameMode']==='unlimited')","dZ=s(()=>dS===null||d5['value']['frameMode']==='unlimited')",'browser FPS controls');
  patch('CHhqVNl3.js',"'parent':'frameMode','parentNote':'帧率模式选「不限帧」时才有这一项','desktopOnly':!0x0","'parentNote':'跟随刷新率时也可以设置上限'",'browser FPS search');
  out['CHhqVNl3.js']=out['CHhqVNl3.js'].replaceAll('帧率上限（桌面端）','帧率上限（本机）');
  out['CU9F0OR3.js']=out['CU9F0OR3.js'].replaceAll('帧率上限（桌面端）','帧率上限（本机）')
    .replaceAll('最高与显示器刷新率相同，调低可以省电、减少发热','跟随浏览器刷新，调低可以省电、减少发热。当前实测值会随负载变化')
    .replaceAll('与网页版一样，帧率等于显示器刷新率，最省电','跟随浏览器刷新，实际帧率取决于负载')
    .replaceAll('能画多快画多快。设一个上限可以让帧数更稳、显卡和风扇更轻松，建议不低于显示器的刷新率','不额外限制帧率，仍遵循上面的刷新率设置。')
    .replaceAll('帧，帧数更稳、显卡和风扇更轻松。建议不低于显示器的刷新率','帧；与上面的刷新率设置共同生效。请选择能稳定维持的上限。');
  patch('WaGOTZ1D.js',"bN('\\x20这局成绩\\x20',-0x1),bM('b',null,'只存在这台设备',-0x1),bN('\\x20上\\x20·\\x20登录后自动同步，换设备也看得到\\x20',-0x1)","bN('这局成绩保存在本机，可通过“完整备份”迁移到其他设备。',-0x1)",'local result notice');
  // Replays use the native scene/skill renderer but still omit the map mount.
  // Viewports acquire a resource lease in the performance patch when mounted.
  patch('0zdT-Ype.js','let P=null,U=!1,he=!1,ae=[];','let P=null,U=!1,he=!1,ae=[];let __aimReplayDisposed=false;','replay lifecycle');
  patch('0zdT-Ype.js','c=ks(t.scene,{aspectRatio:R}),c.camera.fov=xs(O,R),c.camera.updateProjectionMatrix(),b=Hn(t.scene),c.mount(b);','c=ks(t.scene,{aspectRatio:R}),c.bindRenderer(k),c.camera.fov=xs(O,R),c.camera.updateProjectionMatrix(),b=Hn(t.scene),c.mount(b);const map=t.scene.environment.map;if(map)Promise.all([__aimMaps.loadMapVisual(map),__aimMaps.loadMapLighting(map),__aimMaps.loadMapPvs(map)]).then(([visual])=>{if(__aimReplayDisposed||!c||!k)return;c.applyEnvironment(t.scene.environment);c.setMapVisual(visual);ye()}).catch(error=>console.error("Replay map failed",error));','replay map loading');
  patch('0zdT-Ype.js','function ye(){if(!k||!c)return;','function ye(){if(!k||!c)return;c.updateLocalLights(c.camera.position);c.updateMapVisibility(c.camera,!1);','replay map lighting/visibility');
  patch('0zdT-Ype.js','lt(()=>{u?.disconnect(),u=null,','lt(()=>{__aimReplayDisposed=true;c?.setMapVisual(null);u?.disconnect(),u=null,','replay teardown');
  out['0zdT-Ype.js']='import{gc as __aimMaps}from"./CqM6URxy.js";\n'+out['0zdT-Ype.js'];
  for(const name of Object.keys(out))out[name]=out[name].replaceAll('https://static.ishoutu.cn','');
  return out;
}
