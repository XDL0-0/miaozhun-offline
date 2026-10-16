function replaceExact(source, before, after, count, label) {
  if (source.split(before).length - 1 !== count) throw new Error(`帧率补丁版本不匹配：${label}`);
  return source.replaceAll(before, after);
}

export function applyFrameratePatch(sources) {
  const output = {...sources};
  let training = output['CymPR-fm.js'];
  let settings = output['DCKWp-_u.js'];
  if (typeof training !== 'string' || typeof settings !== 'string') throw new Error('帧率补丁缺少训练或设置模块');
  // Keep the browser's RAF scheduler and fractional refresh setting. Only the
  // numeric cap was incorrectly restricted to the original desktop shell.
  training = replaceExact(training, 'maxFps:me?t.maxFps?.current??0:0', 'maxFps:t.maxFps?.current??0', 2, '本机数值限帧');
  // RAF timestamps have small rounding/jitter around a frame deadline. Missing
  // a deadline by a fraction of a millisecond must not cost an entire refresh.
  // Keep the desktop MessageChannel/deferred scheduler's exact deadline path.
  training = replaceExact(training, 'if(O>=m)return!0;const k=',
    'if(O>=m||!n.deferFrame&&m-O<.25)return!0;const k=', 1, 'RAF 截止时间容差');
  // Ye also controls the fractional-refresh selector. Expand only the cap
  // controls, rather than changing that shared desktop-unlimited predicate.
  settings = replaceExact(settings,
    'Ye.value?(h(),Z(re,{key:6,class:"hall-max-fps-choice"',
    '(Ye.value||Ee===null)?(h(),Z(re,{key:6,class:"hall-max-fps-choice"', 1, '本机限帧控件');
  settings = replaceExact(settings,
    'Ye.value&&Ze.value===et?', '(Ye.value||Ee===null)&&Ze.value===et?', 1, '本机自定义限帧');
  settings = replaceExact(settings, '帧率上限（桌面端）', '帧率上限（本机）', 2, '控件与搜索标签');
  settings = replaceExact(settings,
    'parent:"frameMode",parentNote:"帧率模式选「不限帧」时才有这一项",desktopOnly:!0',
    'parentNote:"跟随刷新率时也可以设置上限"', 1, '设置搜索可见性');
  settings = replaceExact(settings,
    'const D=O(()=>t.value.maxFps===0?"能画多快画多快。设一个上限可以让帧数更稳、显卡和风扇更轻松，建议不低于显示器的刷新率":`每秒最多画 ${t.value.maxFps} 帧，帧数更稳、显卡和风扇更轻松。建议不低于显示器的刷新率`)',
    'const D=O(()=>t.value.maxFps===0?"不额外限制帧率，仍遵循上面的刷新率设置。":`每秒最多绘制 ${t.value.maxFps} 帧；与上面的刷新率设置共同生效。请选择能稳定维持的上限。`)',
    1, '限帧提示');
  output['CymPR-fm.js'] = training;
  output['DCKWp-_u.js'] = settings;
  return output;
}
