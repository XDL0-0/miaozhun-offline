# 瞄准专家本机离线版

Windows / Linux 本机离线训练包。Windows 可双击 `瞄准专家-离线版.exe`；Linux 可用系统 Node.js 启动。服务仅监听 `127.0.0.1:18746`，训练界面为 [http://127.0.0.1:18746/aim](http://127.0.0.1:18746/aim)。

默认构建已迁移到 **2026-11-05 AimPro 完整新引擎**，包括 680 个原始 JavaScript 模块、9 张地图、100 个原始目录场景和 577 个加密资源。新客户端原件保存在 `upstream/aimpro-2026-11-05/client/`，`dist/` 是可运行的离线版本；`site/` 保留旧客户端基线。`prepare-offline.mjs` 默认使用新版构建器及版本固定的离线、性能、皮肤和存储补丁，`--legacy` 可重建旧版。Windows 自带 Node 运行时位于 `runtime/`。

成绩、设置、收藏、录像与编辑器草稿保存在使用此应用的浏览器本机存储中，不包含在仓库内；可在界面中点击“完整备份”单独导出。继续使用同一浏览器配置及 `127.0.0.1:18746` 地址，可访问原有本机数据。

## 新引擎、地图与机器人

已将 [AimPro](https://aimpro.world/aim) 的本次公开客户端快照接入离线运行版，原生加载链路覆盖地图、机器人、技能、场景编辑和回放。公开目录包含 **96 个瓦工坊场景和 4 个小球训练场景**；相对旧本地基线新增 38 个、修改 1 个，原有 61 个场景文档不变。100 个场景保留原始文档和稳定 ID，未把机器人生成定义改写成固定点位。

| 新地图 | 内部 ID | 场景数 | 人形机器人生成器 |
| --- | --- | ---: | ---: |
| 盐海矿镇 | rook | 8 | 162 |
| 源工重镇 | duality | 8 | 144 |
| 日落之城 | juliett | 6 | 106 |

本次上游九图（包括原有六张）的模型载荷均为 `VMP1/privateMap`，虽然公开 URL 仍带 `.glb`。新版使用匹配的资源编解码器、Meshopt、材质、纹理数组及地图加载器，不将该容器交给旧 GLTFLoader。112 个地图资源与 45 条外部素材引用已完成采集和结构核对。

机器人导出包含 1,542 个人形生成器、4 个球类生成器、100 个玩家出生点、127 个路线点和 12 个编排器，保留朝向、随机范围、生成规则及完整模板。生成器数量包括固定点和随机区域，不等于每局实际机器人数量。另将 4 个场景中的 10 条录制轨迹解码为 14,636 帧、128 Hz 的局部坐标；还原行为仍需结合场景放置点、朝向、裁剪、速度和延迟。新版场景链路保留这些 `take` 和编排器定义。

- [客户端采集清单](upstream/aimpro-2026-11-05/client-downloads.json)、[采集索引](upstream/aimpro-2026-11-05/snapshot-index.json)：原件、版本地址、哈希及逐地图统计。采集索引保留采集阶段的状态说明；当前运行集成以构建清单和下述验证为准。
- [机器人点位与生成定义](upstream/aimpro-2026-11-05/robot-positions.json)、[逐帧动作轨迹](upstream/aimpro-2026-11-05/robot-motion-frames.json)、[场景差异](upstream/aimpro-2026-11-05/scene-diff.json)。原始响应位于同目录 `scenes/`。
- [地图资源清单](upstream/aimpro-2026-11-05/map-downloads.json)、[采集阶段地图校验](upstream/aimpro-2026-11-05/map-validation.json)：原件位于 `assets/aim-maps/`，解码元数据和容器位于 `decoded/aim-maps/`。
- [新引擎九图浏览器验证](docs/upstream-engine-map-smoke-2026-11-05.json)：九图均通过原生 VMP1/Meshopt/图片解码、碰撞/光照/PVS 加载、着色器编译、WebGL 绘制，以及活动视口保护和卸载后的地图资源释放检查。

浏览器验证在后台以 640×360 固定相机运行，并强制显示全部批次以覆盖着色器编译；它不是实战 FPS 对比，也未穷举 100 个场景与全部皮肤组合。离线校验还会检查全部 577 个加密资源、原始场景、新模块依赖及本地皮肤素材；非字面量动态导入单独列出，不能把静态校验解释为全部交互路径均已实测。

在仓库根目录离线重验地图与机器人快照：

```bash
node scripts/sync-upstream-maps.mjs --offline
node scripts/validate-upstream-maps.mjs
node scripts/sync-upstream-scenes.mjs --offline
node scripts/export-upstream-takes.mjs
```

地图采集器默认保留已验证的快照；只有显式传入 `--refresh-minimaps` 才重新获取无版本号的小地图文件。首次缺文件时会从清单中的公开地址下载；场景采集器不带 `--offline` 时按已有 `workshop.json` 重新获取场景。更新到未来版本前须重新获取对应目录和资源版本表，不能将本次固定清单当作实时全站目录。

优化后验收：467 项测试全部通过，无跳过；正式 `dist/` 的 9 张地图、100 个场景和 577 个加密资源校验无失败。后台回放与备份记录见 [验收报告](docs/upstream-engine-acceptance-2026-11-05.json)。此次替换前的旧运行目录保存在 `backups/dist-before-aimpro-2026-11-05/`，浏览器数据不在该目录中。

## 本机数据与旧录像

升级沿用原有 localStorage 键以及 `aimlab-studio`、`aimlab-replay` IndexedDB 数据库，不在启动时重写、迁移或清空用户记录。兼容测试使用旧客户端的实际编码器生成录像，再通过新版数据库适配器和完整原生解码器读取，并核对原始字节、元数据、场景、关键帧和结果；旧编辑器草稿、场景及完整备份格式也保留。

旧录像仍由原生回放逻辑处理：引擎版本不符或检测到内核/关键帧漂移时使用关键帧插值。两版的引擎标签都为 `p7`，因此旧录像不一定立即进入插值模式，也不承诺跨规则版本的确定性重演。包内保留 45 个历史内核及原始 manifest 身份；其中 26 项源端 `fingerprint` 与文件 SHA-256 不同，但打包字节全部按采集 SHA-256 核对，未通过改名或改写身份掩盖差异。

新版界面已撤下旧练习记录、快速开始和测试历史对应的三个键：`al-drill-runs-v1`、`al-hall-quick-start-v1`、`al-test-history-v3`。这些数据继续保留并进入“完整备份”，但不会在新界面中展示。存储边界和回放限制见 [兼容补丁](patches/upstream-storage.mjs) 与 [兼容测试](tests/upstream-storage.test.mjs)。

地图训练的本机回放入口已启用，并补上回放视口的地图、光照和可见性加载。后台验证完成一次隔离的一秒回合、成绩记录、完整备份与日落之城录像播放；该短回合没有射击和关键帧漂移样本，不构成确定性重演或战斗精度验收。

## 界面语言

左下角“界面语言 / Language”可切换简体中文和 English，默认中文，选择保存在本机。切换时重新载入界面；编辑器会先提交当前输入、保存并回读核对草稿，保存失败时保留当前页面。

新版使用原生 DOM 翻译机制，并补充 `patches/locales/` 中已有的离线工具、皮肤及设置词条；语言选择同步到新版原生语言键。原始场景文档、自定义名称和录像内容不改写。新版 `localization-report.json` 记录翻译机制和补充词条数量。旧版的完整 AST 词条检查和六图 142 个地点标签审核属于旧构建的验收范围，不能据此宣称新版所有界面和九图地点名称已经逐项验收；历史术语来源见 [英文界面审核说明](docs/english-ui.md)。

## 构建与启动

Linux 需要 Node.js，皮肤素材构建还需要 `ffmpeg` 位于 `PATH`。在仓库目录运行：

```bash
node prepare-offline.mjs
node verify-offline.mjs
node server.mjs
```

默认构建由 `scripts/build-upstream-offline.mjs` 生成新版 `dist/`。校验器根据 `offline-manifest.json` 选择相应版本，结果写入根目录 `verification.json`。构建直接使用仓库内已审查的原始资源和媒体，无需重新下载，也不依赖 `skin-packs/local/wiki-downloads/`。Windows 重建时同样需要 `ffmpeg`，并可将以上 `node` 替换为 `.\runtime\node.exe`。已有离线包可直接启动服务。

后台验证使用独立目录和端口，`--qa` 会禁用真实全屏与指针锁定，并模拟游戏内部的锁定状态以便后台完成回合：

```bash
node prepare-offline.mjs --qa --output=local-data/new-engine
node verify-offline.mjs --root=local-data/new-engine --report=local-data/verification-upstream-staging.json
node scripts/write-upstream-browser-check.mjs --root=local-data/new-engine
node server.mjs --root=local-data/new-engine --port=18747
```

测试页面为 [九图后台检查](http://127.0.0.1:18747/__qa-maps.html)，点击“运行检查”后输出逐图结果。自动化应在后台标签页运行；此端口具有独立的浏览器存储。正式构建使用不带 `--qa` 的第一组命令，正常训练保留全屏和指针锁定功能。`node prepare-offline.mjs --legacy` 仅用于重建旧基线或回退，之后可再运行默认构建切回新引擎。

Windows 的浏览器调度修复需通过新版 `瞄准专家-离线版.exe` 启动才会带入参数。首次使用此次更新时，先保存其他 Edge 窗口中的工作，完整退出所有 Edge 实例（包括后台进程），再双击新版启动器；仅关闭训练窗口未必退出 Edge。已有 Edge 实例可能接管新的打开请求，启动器参数不会补入其既有浏览器进程。启动器沿用原 Edge 配置和本机训练数据，直接在已运行的浏览器中输入页面地址不会增加这些启动参数。这些参数作用于启动的整个 Edge 实例，之后共享该实例的窗口也受影响。

## 枪械皮肤与击杀反馈

“参数设置 → 音频 → 枪械皮肤与击杀反馈”保留独立的皮肤枪模、音效与横幅开关，并按系列提供 Vandal、Phantom、Sheriff、Operator 和近战外观。当前模型目录包含 **15 个系列、26 个武器/皮肤组合、4 个额外变体和 640 项素材**，包括 Champions 2021–2026 的枪械与近战模型。ORA by OneTap 的 Base、Watch、RENEGADE、RAJA、Ignition 五个音效主题均支持四种枪械；各系列实际覆盖以设置面板和 [模型清单](skin-packs/models/index.json) 为准。

当前构建包含 **37 段开火音效、103 段击杀音效、20 段 Successive 试听片段和 44 种横幅**，其中 40 种使用分层横幅、共 92 个独立图层素材。音效、横幅及模型桥接已适配新引擎，复用其原生渲染类、骨架和事件，不另加载第二套 Three 引擎。素材异步加载并提前解码；缺失或加载失败时回退到原生效果。枪械弹道、射速、伤害和训练判定不由皮肤修改。

按键位设置中的检视键（默认 **Y**）播放检视；换弹、开火、切枪和开镜会打断检视，暂停时动作停在当前时刻。换弹按训练的实际装弹时间同步。无限子弹训练也支持手动换弹：默认按 **R**，可在“参数设置 → 键位”中修改；弹药保持无限，换弹期间不能开火。有限弹药仍支持提前手动换弹和打空自动换弹。

枪身保留原始贴图尺寸、各向异性过滤、表面贴图的线性数据通道、原始 UV 和可转换的流动/遮罩材质。透明和裁切状态按来源配置，ORA Operator 的原始零自发光及 RGX 外壳遮罩等修正继续保留。程序光球、体积烟雾等无法可靠转换的效果按素材审核结果停用；网页材质仍是近似，不能完全复现 Riot 的专用着色器，终结技未接入。逐项来源、转换边界与哈希见 [枪模素材审核](skin-packs/audit/weapon-model-sources.json)，材质修正记录见 [枪身材质验证](skin-packs/audit/weapon-body-material-validation.json)。

击杀音与图形沿用原生 1–5 循环，超过五杀从第 1 段重新开始；Successive 原始片段及 Ayakashi 第 6 杀仅用于试听。横幅由外框、圆环、徽章、连杀标记和爆头图层组合，保留各皮肤的原始配色与摆放参数。来源见 [连杀图层审核](skin-packs/audit/banner-layer-review.json)、[Ayakashi 火焰审核](skin-packs/audit/ayakashi-flame-review.json) 和 [开火审核记录](skin-packs/audit/fire-review.json)。

新版行为测试覆盖全部已保留组合在新原生骨架上的构建、动画和销毁，以及默认枪械恢复、检视打断、手动换弹、音效回退和面板生命周期。历史 [枪模验证](skin-packs/audit/weapon-model-validation.json)、[特效验证](skin-packs/audit/weapon-effects-validation.json) 及 [RGX 前后画面](skin-packs/audit/weapon-effects-comparison.png) 来自旧引擎，不能替代新版全组合画面验收。`review-weapon-models.mjs`、`review-weapon-effects.mjs` 仍绑定旧模块，仅适用于旧基线；新版验证使用 `tests/upstream-weapons.test.mjs` 及独立后台测试构建。

离线包运行及常规重建不需要安装 VALORANT、Blender 或导出工具。详细素材来源与构建依赖见 [皮肤说明](skin-packs/README.md) 和 [素材状态](skin-packs/ASSET_STATUS.md)；当前数量以生成的 `offline-manifest.json` 与皮肤目录为准。

## 性能优化与验证

新引擎已重新适配原有性能补丁：RAF 时间戳限帧、共享 HUD 时钟、相邻模拟帧插值、场景/首波机器人/皮肤预热、同帧机器人标签、局部灯光稳定 Top-K、被训练遮挡的大厅隐藏、空画布与枪口层跳过、枪口顶点前缀上传、命中特效有界池化，以及静态地图实例视锥剔除。枪皮桥保留骨架更新去重，启动器保留 Edge 调度参数。覆盖与适配边界由 [新版性能补丁](patches/upstream-performance.mjs) 写入构建清单。

实例剔除保留原始批次、PVS 和拾取身份，阴影更新恢复全部实例；不同视口持有独立可写实例缓冲。地图释放增加活动视口引用保护，最后一个视口卸载后才释放地图资源。不满足静态条件的材质和几何保守回退。新版原生弹道已采用有界合批及有效前缀上传，保留该实现；共享命中图集也沿用原生实现，补丁在其上池化 Mesh/材质。未启用此前收益不稳定的空间重分批实验。

[上游优化对照](docs/aimpro-upstream-optimizations-2026-11-05.json) 记录迁移前审查：逐地图释放、逐文件版本地址和新加载链路已随新引擎接入；纹理数组、KTX2/Basis 和 worker 并非本次首次引入。[合并前优化复查](docs/performance-review-2026-11-05.json) 保留一手资料、适用性与暂缓项。当前验证覆盖行为、资源范围、阴影恢复和释放。已完成的 [新旧版本后台 A/B 报告](docs/engine-comparison-2026-11-05/report.md) 比较整包迁移：RTX 4070、1280×720、两张共有地图各三对，全部 12 组通过同场景与环境检查。亚海悬城渲染提交 CPU 中位数下降 32.28%、绘制调用下降 49.32%；天枢云阙绘制调用下降 15.22%，渲染 CPU 没有一致下降。两图 1% low 中位数均未提升，样本存在出帧波动（原生 GPU 队列限流仍开启），不能据此声称普遍或高刷新率实战 FPS 提升。该测试记录后台绘制提交与 RAF 回调间隔，未测量 GPU 完成帧率或显示器呈现帧率。原始样本、统计口径、限制和复现命令均在报告中。

### 渲染临时对象分配优化

[临时分配补丁](patches/upstream-render-allocation.mjs) 将机器人与相机的插值结果直接写入位置，并复用每个渲染器的机器人 ID 集合。8 个机器人和 1 个相机、40 次重复渲染的[分配计数测试](tests/upstream-render-allocation.test.mjs)中，临时 xyz 对象从 360 个降为 0，`Set` 构造从 40 次降为 1。前后行为差分覆盖原生与相邻帧插值版本、多次渲染、跨 tick、机器人增删和重建；快照生成、启动及逐 tick 失效逻辑保持原样。该计数只描述这两个分配点，不能换算为 FPS 提升。

[新引擎优化前后报告](docs/engine-optimization-2026-11-05/report.md) 的 12 组后台对照全部通过。两份构建的 JS 仅角色渲染模块不同；默认两帧 GPU 队列、地图和输入一致。亚海悬城渲染提交 CPU 中位数变化 +0.57%，天枢云阙为 −2.50%；配对变化中位数分别为 +4.76% 和 −4.62%。平均提交频率中位数均约 60 FPS，1% low 分别变化 −7.53% 和 −0.18%，不宣称整体 FPS 提升。保留此项改动的依据是明确减少临时分配及行为差分一致，收益不能推广到全部场景。

另行测试了零超时 `clientWaitSync` 替代 GPU 状态查询，但 [4 组探索性预试验](docs/engine-optimization-2026-11-05/gpu-poll-pilot.json) 未显示一致收益，正式版保留原生查询方式。该实验未混入 12 组正式对照。

从完整仓库克隆重建本轮基线时，使用以下命令。基线保留当前新引擎和其他补丁，仅关闭本轮临时分配优化；输出目录须尚不存在，构建依赖同前。

```bash
node scripts/build-upstream-offline.mjs --baseline-render-allocations --output=local-data/render-allocation-baseline
node scripts/create-engine-comparison.mjs --before=local-data/render-allocation-baseline --after=dist --output=local-data/engine-optimization-reproduction
node scripts/serve-engine-comparison.mjs local-data/engine-optimization-reproduction
# 在后台 IAB 打开 http://127.0.0.1:18820/__engine-benchmark.html?run=0，并保持文档 visible
# 全部 12 组完成后，在另一个终端汇总：
node scripts/summarize-engine-comparison.mjs local-data/engine-optimization-reproduction --output docs/engine-optimization-reproduction
```

历史迁移比较所需的旧引擎可从提交 `7fdf4b6` 中已跟踪的 `dist/` 恢复到独立目录（以下为 Linux / Bash）：

```bash
mkdir -p local-data/legacy-7fdf4b6
git archive 7fdf4b6 dist | tar -x -C local-data/legacy-7fdf4b6
node scripts/create-engine-comparison.mjs --old-root=local-data/legacy-7fdf4b6/dist --after=dist --output=local-data/engine-migration-reproduction
```

重跑前应核对报告中的模块、场景和采样脚本哈希。上述命令比较恢复的历史包与当前 `dist/`，并使用当前采样脚本；历史报告的原始条件以其记录的哈希为准。

### 旧引擎历史基线

以下均为旧引擎历史基线。旧原生工厂的 80 次命中对照中，atlas 贴图克隆由 80 降至 4，预热后的 Mesh、材质分配由各 160 降至 0；这是当时的资源计数，不能当作新版收益。2026-10-29 的实例剔除和粒子上传验证见 [旧版更新记录](docs/performance-update-2026-10-29.json)。

2026-10-27 主线版本的全高清验证使用 RTX 3060 Laptop / Ryzen 7 5800H、239.760 Hz 显示器，NO.B212F6，240 帧上限、100% 比例、阴影、完整 Champions 2023 Vandal 枪模、动画与枪口特效。下表是该版本的三轮相同十秒模拟脚本；每轮同期 OS 样本核对游戏前台，活动渲染进程保持 Normal 且 EcoQoS 关闭。

| 轮次 | RAF 平均 FPS | 1% Low FPS | 间隔 p99/ms | 最大间隔/ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 195.542 | 105.319 | 8.4 | 12.6 |
| 2 | 186.672 | 65.630 | 8.4 | 69.2 |
| 3 | 183.251 | 109.384 | 8.4 | 12.7 |

该旧版测试仍未证明稳定 240 FPS，也未证明当时的资源池化带来一致的整段 1% Low 提升。主要剩余耗时在地图绘制，骨骼不是此脚本的主要瓶颈。全量空间分批把三角形约从 218 万降至 136 万，但 draw 约从 168 增至 291，帧率下降；选择性分批及粒子合批也未显示一致收益，因此均未启用。此前大厅可见/隐藏的独立同版本 A/B 为 96.768 → 180.115 RAF FPS。

数字来自浏览器 RAF 间隔，不能称为屏幕实际呈现帧数或手动实战成绩。1% Low 按最慢 ceil(1% × 间隔数) 个原始间隔的平均值换算，不等于 1000/p99；1920×1080 使用临时 viewport override 建立渲染负载。原始机器遥测仅留本地，已跟踪的[脱敏验证摘要](docs/performance-validation-2026-10-27.json)包含逐轮结果、OS 有效性计数、资源计数和被拒绝的候选。

旧基线的合并前行为测试曾为 360/360 通过；此数字不是本次迁移的测试总数。当前离线包结果见 [verification.json](verification.json)，九图后台结果见 [新引擎地图验证](docs/upstream-engine-map-smoke-2026-11-05.json)。新版上游 HUD 的“1% Low”采用 `1000/p99`，与上表最慢 1% 间隔均值的换算口径不同，不能直接比较。

`scripts/create-performance-comparison.mjs` 及其 `--graphics-phases`、`__compactionSequence`、`__gpuTiming`、`__glStalls` 等探针仍用于旧基线的独立诊断副本，未作为新版 FPS 验收工具。探针本身也有开销。正常构建不生成这些诊断入口，新版后台验证使用前述 `--qa --output=local-data/new-engine` 流程。

只运行 `tests/` 下的行为测试。Linux / Bash：

```bash
node --test tests/*.test.mjs
```

Windows / PowerShell 显式枚举测试文件：

```powershell
$behaviorTests = @(Get-ChildItem -LiteralPath .\tests -Filter '*.test.mjs' -File | ForEach-Object FullName)
& .\runtime\node.exe --test @behaviorTests
```

媒体相关测试需要按[皮肤构建依赖说明](skin-packs/README.md#build-and-run-on-linux)准备 `ffmpeg`。表面贴图打包测试及部分导入脚本支持用 `FFMPEG_PATH` 指定已安装的 `ffmpeg` 可执行文件完整路径；常规皮肤媒体构建仍要求 `ffmpeg` 位于 `PATH`。请勿在根目录直接使用不带文件范围的 `node --test`，以免自动运行 `qa-artifacts/` 内的历史诊断脚本。

测试覆盖实际客户端函数和皮肤媒体构建行为；完整校验检查本机素材和脚本。真实训练中的流畅度仍取决于地图、画面设置与设备负载。

首次提交是进一步性能优化前的离线基线，标签为 `offline-baseline-2026-10-16`。第三方客户端及素材保留其原有权利归属。
