# Agent Note: 截图翻译覆盖层

Status: proposed

[English](2026-11-11-screenshot-translate-overlay.md) | 中文

## 问题

截图功能无法在原位置翻译识别出的文字，同时保留所选图像输出和截图会话归属。

## 提案

使用保守的离线语言估计、选定的已配置模型和固定物理像素框逐行翻译 OCR 结果。不确定、混合文字、重叠或无法容纳译文的行保留原样。背景使用采样的纯色近似，字体使用适配的单行文字。目标语言偏好与翻译功能共享。翻译与标注互斥；导出等待正在进行的工作，并遵循所选视图。保留现有的[截图会话归属决策](../../implemented/bug-fix/2026-11-08-screenshot-result-session-ownership.md)。

AC2 是收窄后的提案，并不能证明原始议题中任意语言保护、忠实排版、段落重建或照片背景还原已完全验收。

## 考虑过的替代方案

- LLM 语言检测和逐块修正源语言：暂缓，采用无需额外模型请求的离线分类。
- 段落重排、精确字体和背景重建：暂缓，因为 OCR 仅提供行文本与矩形，缺少所需布局和图像元数据。
- 工作进行时导出：不采用，以免输出不完整的快照。

## 验收标准

- AC1 — 完成选择的截图提供翻译入口；自动 OCR 关闭时按需启动识别，并说明识别不可用或失败的情况。 (verification: renderer and Electron; owner: implementation worker and delivery agent)
- AC2 — 符合条件的 OCR 行在原物理像素框内获得有界译文替换；在所述离线分类和纯色背景限制下，跳过的行及替换框外像素保持原样。 (verification: unit, raster and Electron; owner: implementation worker and delivery agent)
- AC3 — 原图与译文视图的比较复用已完成结果；工作结束后的复制、保存、确认和聊天输出符合所选视图，控件不进入位图。 (verification: renderer, raster and Electron; owner: implementation worker and delivery agent)
- AC4 — 截图翻译使用选定的已配置模型、记住明确选择，在适当时默认使用可用的当前聊天默认模型，并且不会为无效的明确请求静默替换模型。 (verification: shared schema, main, renderer and Electron; owner: implementation worker and delivery agent)
- AC5 — 重试单个失败块保留其他成功块，并忽略来自已失效选区或复用会话的结果。 (verification: renderer, raster and Electron; owner: implementation worker and delivery agent)

## 风险

- 离线分类可能出错，并会跳过短文本或不确定的文本。
- 纯色背景和适配字体只是近似；不支持的布局可能保持原样。
- OCR 的可用性取决于平台和已安装的后备方案。
- 部分失败会使输出保留原文行。
- 修改共享的目标语言偏好也会影响翻译功能。
- 该拟议 Spec 尚未获得事先的人类 Approval。
