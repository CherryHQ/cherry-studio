# Agent Note: 将译文复制为图片

Status: implemented

[English](2026-11-06-translation-copy-image.md) | 中文

## Problem

翻译页支持复制文本，但将排版后的译文分享为图片仍需手动截图，可能遗漏视口之外的内容。

## Decision

`TranslateOutputPane` 在现有译文操作旁提供“复制为图片”。它只捕获已完成的译文正文；开启预览时包含渲染后的 Markdown 和公式，纯文本模式保留字面文本。正文使用当前语义背景和前景色；捕获时以主题的 `--card` 色作为底色，避免半透明窗口背景使 PNG 半透明；现有滚动视口 ref 与滚动同步保持原有职责。

操作按需加载 `exportService.captureScrollableAsDataUrl` 和 `copyImageToClipboard`，沿用共享捕获队列、资源与字体准备、完整滚动尺寸以及 PNG 剪贴板转换。调用方等待剪贴板写入完成后才提示成功；捕获或剪贴板失败时使用现有复制失败提示。

空白或仍在生成的译文无法复制为图片。同步的进行中标记防止重复请求。内容、预览模式或翻译状态变化会通过结果版本使未完成的捕获失效，即使旧文本随后恢复也不会写入；卸载同样阻止后续剪贴板写入。已交给操作系统的剪贴板写入无法取消。

## Alternatives considered

- 捕获整个面板会带上无关按钮和字数统计。
- 另建截图实现会重复已有资源处理与捕获串行化逻辑。
- 保存 PNG 文件或增加图片样式配置会超出单个剪贴板操作的范围。

## Consequences

该功能不增加偏好项、持久化格式、模型请求、依赖或凭据访问，沿用图片导出链路的尺寸上限和渲染约束。超限时失败且不提示成功。图片不包含原文面板、历史记录或译文操作控件。

## Verification

- AC1 — `TranslateOutputPane.image.test.tsx`：真实输出面板、导出队列、Markdown 渲染器及 PNG 剪贴板工具捕获完整高度且排除控件，保留渲染后的 Markdown/KaTeX，并禁用空白或生成中的结果；仅替代栅格化和剪贴板边界。隔离 Electron 开发实例经真实历史复用入口验证包含 100 段合成译文和公式的完整 PNG（8120 像素高）；浅深色背景像素 alpha 均为 255，正文不含操作按钮。
- AC2 — `TranslateOutputPane.image.test.tsx`：重复点击、写入拒绝后重试、栅格化失败、结果替换或重新翻译、卸载均保持剪贴板和提示的归属。
- AC3 — `TranslateOutputPane`、`TranslatePage`、`image` 和 `ExportService` 的相关渲染器测试共同通过；前端 TypeScript 检查也通过。
