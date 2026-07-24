---
name: cherry-ppt
description: 使用 Cherry Studio 内置 Cherry-PPT 品牌模板生成真实、可编辑并保留 Master/Layout 的 PPTX。用户要求使用 Cherry-PPT、Cherry Studio PPT 模板，或正式红白、企业蓝、Young、CY2K 风格制作演示文稿时触发。不要用于网页演示、普通无模板 PPT 或修改任意外部 PPTX。
---

# Cherry-PPT

使用内置品牌模板创建 PPTX，不重画模板，也不把模板栅格化成整页图片。

## 工作流

1. 根据用途选择模板。用户未指定时，按 [模板目录](references/template-catalog.md) 选择最匹配的一套；只有两种选择同样合理时才追问。
2. 规划页面，只使用 `cover`、`agenda`、`section`、`content`、`closing` 五种跨模板稳定布局。每页一个主张，正文整理为 1-3 个短要点。
3. 按 [Cherry-PPT JSON](references/template-catalog.md#json-contract) 在 workspace 写一个 UTF-8 `.json` 中间文件。不要把 JSON 当成交付物。
4. 调用 `mcp__cherry-tools__export_office`，传入 `operation = cherry_ppt_to_pptx`、JSON 源路径和新的 `.pptx` 输出路径。不要改用 `markdown_to_pptx`。
5. 工具报告文案过长时，缩短对应字段后重试；不要缩小模板字体或覆盖模板元素。
6. 确认输出扩展名、页面数和工具成功结果，再调用 `mcp__cherry-tools__report_artifacts` 登记最终 PPTX。

## 内容规则

- 保留用户数据、事实、来源和术语；不编造 KPI、图表或引用。
- 封面、目录、章节、正文和结束页都填写实际内容，不保留示例文案或 `{{PLACEHOLDER}}`。
- `red` 与 `enterprise-blue` 的目录最多 4 项，章节页没有副标题；`young` 与 `cy2k` 的目录最多 5 项。
- `content.points` 必须有 1-3 项。CY2K 会将三项映射到三块玻璃信息区；其他模板会生成模板内的项目列表。
- 需要图片、真实图表、复杂表格或模板外布局时，保留当前页纲并交给 `cherry-skill-marketplace` 补足精确能力，完成后回到本流程；不得把能力缺口当作完成。

## 输入转换

主题、提纲、Markdown、文档或 HTML 都先提取语义内容，再组织为 Cherry-PPT JSON。不要声称 HTML 的 CSS、动画或交互已转换到 PPTX。

## 交付边界

只交付生成的 `.pptx`。不要交付模板源、JSON、预览图或其他中间文件，除非用户明确要求。
