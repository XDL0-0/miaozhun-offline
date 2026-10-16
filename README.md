# 瞄准专家本机离线版

Windows 本机离线训练包。双击 `瞄准专家-离线版.exe`，启动仅监听 `127.0.0.1:18746` 的服务，并使用 Edge 打开训练界面。

`site/` 保存采集的原始公开客户端资源，`dist/` 保存可运行的离线版本。`prepare-offline.mjs` 根据原始资源及离线适配脚本重建 `dist/`；`verify-offline.mjs` 检查素材、场景和 JavaScript。自带 Node 运行时位于 `runtime/`。

成绩、设置、收藏、录像与编辑器草稿保存在使用此应用的浏览器本机存储中，不包含在仓库内；可在界面中点击“完整备份”单独导出。

首次提交是进一步性能优化前的离线基线，标签为 `offline-baseline-2026-10-16`。第三方客户端及素材保留其原有权利归属。

## 性能优化与验证

`patches/` 中的补丁在构建时应用，原始 `site/` 保留不变。当前优化覆盖相邻模拟步的移动插值、共享 HUD 刷新、本机数值限帧和场景资源预热。数值帧率上限可在“参数设置”中选择，与刷新率设置共同生效。

在本目录的 PowerShell 中运行：

```powershell
.\runtime\node.exe --test
.\runtime\node.exe prepare-offline.mjs
.\runtime\node.exe verify-offline.mjs
```

测试覆盖实际客户端函数的行为；完整校验检查本机素材和脚本。真实训练中的流畅度仍取决于地图、画面设置与设备负载。
