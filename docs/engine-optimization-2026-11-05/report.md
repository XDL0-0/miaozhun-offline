# 新引擎优化前后固定场景性能对比

优化后相对优化前的三轮中位数变化：亚海悬城渲染提交 CPU +0.57%、1% low -7.53%；天枢云阙渲染提交 CPU -2.50%、1% low -0.18%。CPU 提交更快不等于画面更流畅，应结合每轮波动判断。

全部 12 组结果通过校验：2 个场景，每场景 3 对；第 1、3 轮 old → new，第 2 轮 new → old。以下为描述性结果，不作统计显著性结论。

比较对象为同一新引擎的优化前、后构建，old 表示优化前，new 表示优化后。结果对应本次整组改动，不能分别归因于某一项优化。本次不包含压力测试或原生无限帧率测量，预跑（pilot）不纳入统计。

测试在后台不展示的 Codex 内置浏览器（IAB）运行，但采样首尾及事件记录中的 document.visibilityState 均为 visible，以避免隐藏文档节流。绘图缓冲为 1280×720；每组 5 秒模拟预热 + 15 秒模拟采样，固定场景和随机种子 20261105。采样以模拟时钟为准，首帧就绪前的启动暂停不计入这 5 秒模拟预热；记录实际墙钟时长，不按墙钟恰好 15 秒筛除慢帧。

实际采样墙钟时长为 15.001–15.022 秒，模拟时长为 15.000–15.008 秒。每组模拟采样时长须在 15±0.05 秒、总模拟时长在 20±0.05 秒内，采样墙钟与首末渲染跨度均须至少 14.9 秒；墙钟没有 15/20 秒上限。

两组保留相同的原生 WebGL context 设置，stencil=true；每对测试的 GPU、UA、缓冲尺寸及全部 context 属性严格一致。

两版都使用 requestAnimationFrame 调度，当前环境约受 60 Hz 限制；这里的 FPS 是渲染回调间隔指标，不能推断原生无限帧率上限。CPU 数值仅覆盖逻辑 tick 和渲染提交的同步耗时，不包含异步 GPU 完成时间，也不是全进程 CPU 利用率。

所有有效样本均保留：各轮原生绘制提交频率为 53.87–60.00 次/秒，独立 RAF 回调为 58.87–60.00 次/秒。原生调度保留 GPU fence 队列限流（默认最多 2 帧在途），可在进入渲染回调之前跳过绘制；这与 CPU 提交耗时降低可以同时发生。下方列出已记录的队列检查及阻止提交次数；检查的 CPU 耗时不是 GPU 执行时间。本次 GPU timer 未启用，没有 GPU 执行时间样本。不能单凭这些诊断断定 GPU 算力瓶颈或归因于某个改动。

本次未附测试后的隔离端口存储核对记录。

音频及回放录制关闭，原生外观和默认 Vandal 枪械；无全屏、无指针锁定。输入脚本包含转向、开火、换弹、切换武器和检视，不包含玩家移动。阴影开启，renderScale=1，lowLatency=false。

环境 1：GPU 为 `ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4070/PCIe/SSE2, OpenGL 4.5.0)`；厂商 `Google Inc. (NVIDIA Corporation)`；devicePixelRatio=1，hardwareConcurrency=24，deviceMemory=32。UA：`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36`。

表中数值为 3 轮中位数［各轮最小值–最大值］；变化率为 (new 中位数 − old 中位数) / |old 中位数|。CPU、帧间隔和卡顿次数越低越好，FPS 越高越好，draw calls/三角形仅描述提交量。old 为 0 时变化率不定义。

**亚海悬城 B 中路回防（ascent）**

| 指标 | old 中位数［范围］ | new 中位数［范围］ | new 相对 old |
| --- | ---: | ---: | ---: |
| 平均 FPS | 59.94［53.87–60.00］ | 59.93［59.81–60.00］ | -0.01% |
| 1% low FPS | 51.28［13.90–56.14］ | 47.42［43.63–56.00］ | -7.53% |
| P99 帧间隔（ms） | 17.700［17.700–63.260］ | 17.700［17.700–17.701］ | -0.00% |
| 渲染提交 CPU（ms/次） | 2.294［2.162–2.425］ | 2.307［2.265–2.404］ | +0.57% |
| 逻辑 tick CPU（ms/次） | 0.208［0.207–0.212］ | 0.212［0.207–0.217］ | +1.70% |
| draw calls/帧 | 430.6［430.5–430.7］ | 430.7［430.5–430.7］ | +0.01% |
| 三角形/帧 | 1961587［1961493–1961648］ | 1961583［1961500–1961602］ | -0.00% |
| >33.333 ms 次数 | 0［0–44］ | 0［0–1］ | — |
| >50 ms 次数 | 0［0–10］ | 0［0–0］ | — |
| >100 ms 次数 | 0［0–0］ | 0［0–0］ | — |

按相同轮次配对计算的 CPU 变化中位数［范围］：渲染提交 +4.76%［-4.85%–+4.78%］；逻辑 tick +1.70%［-2.21%–+5.17%］。

**天枢云阙 A 大预瞄（plummet）**

| 指标 | old 中位数［范围］ | new 中位数［范围］ | new 相对 old |
| --- | ---: | ---: | ---: |
| 平均 FPS | 60.00［59.00–60.00］ | 60.00［59.93–60.00］ | -0.00% |
| 1% low FPS | 54.18［29.93–55.11］ | 54.09［49.89–54.81］ | -0.18% |
| P99 帧间隔（ms） | 17.800［17.700–32.732］ | 17.801［17.700–17.802］ | +0.01% |
| 渲染提交 CPU（ms/次） | 1.887［1.841–1.929］ | 1.840［1.730–1.849］ | -2.50% |
| 逻辑 tick CPU（ms/次） | 0.359［0.353–0.365］ | 0.355［0.334–0.357］ | -1.13% |
| draw calls/帧 | 158.4［158.4–158.7］ | 158.4［158.4–158.4］ | -0.00% |
| 三角形/帧 | 1599477［1599043–1599624］ | 1599579［1599539–1599589］ | +0.01% |
| >33.333 ms 次数 | 0［0–7］ | 0［0–0］ | — |
| >50 ms 次数 | 0［0–0］ | 0［0–0］ | — |
| >100 ms 次数 | 0［0–0］ | 0［0–0］ | — |

按相同轮次配对计算的 CPU 变化中位数［范围］：渲染提交 -4.62%［-6.03%–-2.04%］；逻辑 tick -2.57%［-5.34%–-0.64%］。

每组明细（CPU、draw calls 和三角形均为该组样本均值；帧间隔范围来自该组原始渲染采样）：

| 场景 / 轮次 / 引擎 | 采样墙钟 s | 平均 FPS | 1% low | P99 ms | 帧间隔范围 ms | 渲染 CPU ms | tick CPU ms | calls / 三角形 | >33.333 / >50 / >100 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [ascent / 1 / old](raw/00-old.json) | 15.002 | 60.00 | 56.14 | 17.700 | 15.400–17.900 | 2.162 | 0.207 | 430.6 / 1961493 | 0 / 0 / 0 |
| [ascent / 1 / new](raw/01-new.json) | 15.002 | 59.81 | 43.63 | 17.700 | 15.400–33.500 | 2.265 | 0.217 | 430.5 / 1961500 | 1 / 0 / 0 |
| [ascent / 2 / new](raw/02-new.json) | 15.002 | 60.00 | 56.00 | 17.701 | 15.300–18.100 | 2.307 | 0.207 | 430.7 / 1961583 | 0 / 0 / 0 |
| [ascent / 2 / old](raw/03-old.json) | 15.022 | 53.87 | 13.90 | 63.260 | 3.100–84.900 | 2.425 | 0.212 | 430.5 / 1961648 | 44 / 10 / 0 |
| [ascent / 3 / old](raw/04-old.json) | 15.002 | 59.94 | 51.28 | 17.700 | 15.400–33.200 | 2.294 | 0.208 | 430.7 / 1961587 | 0 / 0 / 0 |
| [ascent / 3 / new](raw/05-new.json) | 15.002 | 59.93 | 47.42 | 17.700 | 2.700–33.000 | 2.404 | 0.212 | 430.7 / 1961602 | 0 / 0 / 0 |
| [plummet / 1 / old](raw/06-old.json) | 15.003 | 60.00 | 55.11 | 17.700 | 14.500–20.100 | 1.929 | 0.359 | 158.4 / 1599477 | 0 / 0 / 0 |
| [plummet / 1 / new](raw/07-new.json) | 15.002 | 59.93 | 49.89 | 17.802 | 12.600–32.600 | 1.840 | 0.357 | 158.4 / 1599539 | 0 / 0 / 0 |
| [plummet / 2 / new](raw/08-new.json) | 15.002 | 60.00 | 54.81 | 17.801 | 13.600–20.000 | 1.849 | 0.355 | 158.4 / 1599589 | 0 / 0 / 0 |
| [plummet / 2 / old](raw/09-old.json) | 15.002 | 59.00 | 29.93 | 32.732 | 13.100–33.900 | 1.887 | 0.365 | 158.7 / 1599043 | 7 / 0 / 0 |
| [plummet / 3 / old](raw/10-old.json) | 15.001 | 60.00 | 54.18 | 17.800 | 11.000–22.400 | 1.841 | 0.353 | 158.4 / 1599624 | 0 / 0 / 0 |
| [plummet / 3 / new](raw/11-new.json) | 15.002 | 60.00 | 54.09 | 17.700 | 9.400–24.400 | 1.730 | 0.334 | 158.4 / 1599579 | 0 / 0 / 0 |

GPU 队列诊断（仅包含有记录的组；blocked 表示调度器阻止提交，不是慢帧数量）：

| 场景 / 轮次 / 构建 | 检查次数 | 阻止提交次数 | 阻止占比 | 检查 CPU 均值 ms |
| --- | ---: | ---: | ---: | ---: |
| ascent / 1 / 优化前 | 900 | 0 | 0.00% | 0.0108 |
| ascent / 1 / 优化后 | 900 | 3 | 0.33% | 0.0111 |
| ascent / 2 / 优化后 | 900 | 0 | 0.00% | 0.0127 |
| ascent / 2 / 优化前 | 884 | 75 | 8.48% | 0.0117 |
| ascent / 3 / 优化前 | 900 | 1 | 0.11% | 0.0092 |
| ascent / 3 / 优化后 | 900 | 1 | 0.11% | 0.0123 |
| plummet / 1 / 优化前 | 900 | 0 | 0.00% | 0.0113 |
| plummet / 1 / 优化后 | 900 | 1 | 0.11% | 0.0099 |
| plummet / 2 / 优化后 | 900 | 0 | 0.00% | 0.0103 |
| plummet / 2 / 优化前 | 900 | 15 | 1.67% | 0.0099 |
| plummet / 3 / 优化前 | 900 | 0 | 0.00% | 0.0114 |
| plummet / 3 / 优化后 | 900 | 0 | 0.00% | 0.0100 |

采样起止统计快照、存储设置及 CPU 汇总按原记录保存在 summary.json 的各组 gpuPacing 字段中。

<details>
<summary>各组 GPU timer 诊断</summary>

GPU timer 未启用；仅保留状态元数据，没有 GPU 执行时间样本。

```json
[
  {
    "caseId": "ascent",
    "round": 1,
    "engine": "old",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "ascent",
    "round": 1,
    "engine": "new",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "ascent",
    "round": 2,
    "engine": "new",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "ascent",
    "round": 2,
    "engine": "old",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "ascent",
    "round": 3,
    "engine": "old",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "ascent",
    "round": 3,
    "engine": "new",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "plummet",
    "round": 1,
    "engine": "old",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "plummet",
    "round": 1,
    "engine": "new",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "plummet",
    "round": 2,
    "engine": "new",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "plummet",
    "round": 2,
    "engine": "old",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "plummet",
    "round": 3,
    "engine": "old",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  },
  {
    "caseId": "plummet",
    "round": 3,
    "engine": "new",
    "gpuTiming": {
      "enabled": false,
      "supported": false,
      "disjoint": false,
      "errors": [],
      "summary": null
    }
  }
]
```

</details>

平均 FPS = 1000 / 平均帧间隔；1% low = 1000 / 最慢 ceil(N×1%) 个帧间隔的均值，不等于 1000/P99。P99 使用线性插值分位数。卡顿为严格大于阈值的帧间隔数。三轮范围不代表置信区间。完整配置、WebGL context 属性、每组样本范围、配对变化及原始数据 SHA-256 见 [summary.json](summary.json)。

计划 SHA-256：`06acad048e2cff30a06ba309149425ca5c42917dcbda815af03f16e043c251af`。
old 原始游戏模块 SHA-256：`0823f7fe2979672e6b0e483360f1e76c6c54dbdcdfdfe3ca497d82b5e6622299`。
new 原始游戏模块 SHA-256：`0823f7fe2979672e6b0e483360f1e76c6c54dbdcdfdfe3ca497d82b5e6622299`。
old 原始地图渲染模块 SHA-256：`c163cf1197de1b16d351d55f6a15d6a2e65769fd532e055ec092cd57c22dd261`。
new 原始地图渲染模块 SHA-256：`c163cf1197de1b16d351d55f6a15d6a2e65769fd532e055ec092cd57c22dd261`。
old 角色渲染模块 SHA-256：`a13dc9d2ac7a04b8612766217733dce5bc2f5a8ea016e11620608aeb4f129f10`。
new 角色渲染模块 SHA-256：`76716f37c321e5e57f15de3dae2e6bbc60ae6bde52ddadf99b59dca3703301b7`。
ascent 场景 SHA-256：`c82142155b131360b2a7318a568b0c4288ec4df725e7ee5b9d36b90232d0d70a`。
plummet 场景 SHA-256：`d76915f2fc2f0d5df46cfbaa70ea579f012d7284a5e68abd33425d7d2ca06c31`。
共同采样 runtime SHA-256：`6fc9ea4ed2a7a7cb4ebd385ad2f30fdecbb2b9780e830101755b29e131f02d5a`；共同 metrics SHA-256：`d6991f43b6fad8ec24d6b1aea070f97fd418232eca83e81435dfb1cfb2e5c5bd`。

重新汇总已有结果：

```bash
node scripts/summarize-engine-comparison.mjs '/home/yuyuan/miaozhun-offline/local-data/engine-optimization-2026-11-05' --output '/home/yuyuan/miaozhun-offline/docs/engine-optimization-2026-11-05'
```

重跑需要一个尚不存在的隔离目录；以下服务启动后，在后台不展示的 IAB 中打开首组 URL，并保持文档 visible。12 组会按计划自动跳转；全部完成后再汇总。

```bash
node scripts/create-engine-comparison.mjs --before='<保存的优化前构建目录>' --after='<保存的优化后构建目录>' --output=local-data/engine-comparison-reproduction
node scripts/serve-engine-comparison.mjs local-data/engine-comparison-reproduction
# 以后台不展示的 IAB 打开 http://127.0.0.1:18820/__engine-benchmark.html?run=0
# 所有 12 组完成后，另一个终端执行：
node scripts/summarize-engine-comparison.mjs local-data/engine-comparison-reproduction --output docs/engine-comparison-reproduction
```

复现时将目录占位符替换为保存的优化前、后构建，使用同一采样脚本并先核对上述哈希。后台测试仍会占用真实 CPU/GPU，本报告只适用于这些固定场景与设置。
