# Agent Note: PPTD 幻灯片预览

Status: implemented

[English](2026-11-14-pptd-slide-preview.md) | 中文

## Problem

Issue #20452 要求在文件预览面板中可视化预览 PPTD 项目。目前 `.pptd` 清单在 `src/renderer/components/FilePreview/filePreviewRegistry.ts` 中没有对应插件，`FilePreview.tsx` 会回退到文本预览并显示 YAML 源码。生成 PPTD 演示文稿（`presentation.pptd` 加 `pages/*.page` 与 `media/`）的智能体因此无法在修改它的工作区里直接审阅幻灯片。

格式定义来自 open-kimi-ppt-skill 的参考文档 `skills/open-kimi-ppt/reference/pptd.md`（PPTD v2，YAML 1.2，px 单位，1px = 1pt）。本 Spec 将该文档视为格式来源，并不声称 Cherry Studio 拥有该格式。

## Decision

- 为 `pptd` 扩展名注册 `pptd` 文件预览插件，形态与 `packages/file-preview/src/plugins/powerpoint/powerPointFilePreviewPlugin.ts` 中的 powerpoint 插件一致，并通过同一注册表接入。插件与 powerpoint 插件并列存放。
- 清单是入口。插件从清单读取 `version`、`title`、`size`、`theme` 与 `pages`，并通过现有文件访问路径，将每个 `pages[]` 路径和相对媒体路径相对于清单目录解析。上游参考还允许媒体 `Image.src` 和背景/填充的 `ImageFill.src` 使用 HTTPS URL；这些引用保留为 URL 来源，不作为本地路径解析，并作为远程 HTTPS 媒体加载。远程加载失败时，与本地媒体缺失一样显示可见占位符。不扫描目录中未列出的 `.page` 文件。
- 每页按 `size` 渲染为固定尺寸画布并缩放到面板宽度。支持问题中列出的元素类型（含富文本标签与主题样式的文本、图片、形状、线条、图标），表格与图表作为独立分支。每种元素类型只有一个渲染器，样式按上游参考定义的优先级解析。
- 数学公式使用 KaTeX，它已是仓库依赖（`package.json`）。公式文本从文本元素内容中提取，本 Spec 不引入第二套数学引擎。
- 提供翻页（上一页、下一页、页码）、缩放和手动刷新按钮。源码/预览切换保留现有文本预览作为源码视图。缩略图在全量范围内纳入本 Spec。
- 不支持的元素类型、无法解析的样式引用和缺失的媒体文件显示可见占位符，并注明元素 id 与原因，不静默丢弃。
- 插件只读，不写入 `.pptd`、`.page` 或媒体文件，也不导出 PPTX。

## Alternatives considered

- 对 PPTD 复用 powerpoint 插件：该插件渲染 OOXML 二进制，而 PPTD 是数据模型不同的 YAML，渲染路径无法共享。
- 借助外部转换器生成 PPTX 再交给 powerpoint 插件：增加导出步骤和预览过期问题，且 issue 明确不要求 PPTX 导出。
- 只渲染清单中的 `pages`，将图表与表格留给后续 Spec：首版更小，但不满足请求者选定的全量范围。若实现时图表渲染成本过高，保留为退路。
- 在 webview 中嵌入外部 PPTD 查看器：issue 将其列为替代方案，但无法让预览留在文件预览面板内，也无法在智能体编辑后刷新。

## Consequences

- 上游参考是第三方文档。其字段名和默认值按原样使用；如有变化，插件跟随本 PR 记录的固定版本。
- 图表和表格是上游规范中体量最大的部分，也是实现的主体。AC4 的占位符兜底保证未支持的类型可见地降级，而不是让整个 deck 失败。
- 解析相对 `pages` 和 `media` 路径依赖项目目录访问路径。逃逸项目目录的路径会被拒绝而不是跟随，媒体测试覆盖了这一点。
- 本环境未运行手动 Electron 验证（AC6）；预览在浏览器测试环境通过，应用内 Electron 检查留待评审。

## Verification

- AC1 — `loadPptdProject` 单元测试解析清单、保持 `pages` 顺序,并在页面缺失时标记而不中断整个演示文稿;画布按清单 `size` 渲染,注册表测试将 `.pptd` 解析到 pptd 插件而非 YAML 文本回退。`packages/file-preview` 全部 644 个测试通过。
- AC2 — `packages/file-preview/src/plugins/pptd/__tests__/pptd.test.ts` 中的 30 个插件测试覆盖文本样式链(默认值 < 主题文本样式 < 内容字段)、富文本标签、遵循 adjustments 的形状路径、线条贝塞尔路径、图片裁剪/适配计算、图标名称解析与表格样式链;文本、图片、形状、线条、图标、表格与图表元素均通过画布按 `bounds` 渲染。
- AC3 — `splitPptdMathSegments` 与 `renderPptdRichText` 测试断言 `\(...\)` 公式走 KaTeX,非法输入显示源码与错误标记而不抛错。
- AC4 — 表格测试覆盖合并区域定位与类别样式链;`buildPptdChartOption` 测试覆盖柱状、折线、面积与饼图映射,并断言不支持的类型(sankey)返回 null,由画布显示命名占位。
- AC5 — `loadPptdProject` 标记缺失页面及其路径;无法读取的媒体在 `usePptdMediaUrl` 中产生错误状态,图片渲染器显示命名元素与 `src` 的 `image_unavailable` 占位。
- AC6 — 翻页、缩放、缩略图与手动刷新在 `PptdFilePreview` 中实现;刷新递增 reload nonce,通过 `readProjectFile` 重新读取清单、`.page` 文件与媒体。本环境未运行桌面端手动验证,已在 PR 中注明。
- AC7 — 源码切换通过 `document.readRange` 重新读取清单字节并以只读视图展示;插件不提供任何项目文件写入路径。
- AC8 — 注册表测试断言 `.pptd` 解析到 pptd 插件,`.pptx` 仍解析到 powerpoint 插件。
