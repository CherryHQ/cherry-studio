# Agent Note: 右侧栏可编辑 Markdown 即时预览

Status: implemented

[English](2026-11-11-sidebar-markdown-live-preview.md) | 中文

## Problem

右侧栏原先使用 `StaticMarkdown` 阅读，再通过独立源码编辑器修改。直接复用 Composer 会丢失表格、图片、公式和 Mermaid 渲染，并把聊天令牌及发送行为带入文件编辑。

## Decision

在 `components/markdownLivePreview` 中共享逐行源码 schema、Markdown 会话、语法装饰和编辑按键。Composer 保留现有适配层。文档界面对完整文档执行一次 `AppMarkdown` 渲染，再将非活动顶层区块通过 portal 放入 ProseMirror widget，保留引用定义和脚注上下文。选中区域时显示其源码，离开后恢复完整渲染。链接、图片和渲染控件保留原有交互。

原始源码始终是编辑依据，包括 frontmatter、回车符、行尾空格和模板字面量。仅在渲染时遮蔽 frontmatter，不修改源码。组合输入期间延迟提交临时文字。前文偏移变化时，未修改的预览 widget 保留 DOM。

右侧栏可写 Markdown 的即时预览和源码模式共用现有文件编辑会话。自动保存、手动保存、冲突、重试和离开保护仍由会话负责。通用 `FilePreview` 保持只读。两个界面共用 `MarkdownFileHostProvider` 解析图片和文件导航，并使用现有 Markdown 样式与设计令牌。

## Alternatives considered

- 直接复用 Composer：会丢失完整渲染，并引入聊天专属行为。
- 仅在右侧栏实现富内容：会重复共享渲染职责。
- 将富文本文档序列化回 Markdown：会改写无关源码格式。

## Consequences

完整文档解析和渲染保留了文档上下文，但没有虚拟化。在 Electron 开发环境中，一个包含 200 个章节、56,780 个字符的样例，每次按键至两帧完成耗时 183–377 ms，现有源码编辑器为 29–34 ms（各 10 次采样）。这些结果包含自动化和开发构建开销，不代表生产性能基准。大文档仍可使用源码模式；增量富内容渲染属于后续性能改进。

Widget 包装必须保留正常的外边距折叠和首尾、相邻区块间距。共享富文本样式排除文档界面，避免编辑器规则覆盖预览排版。文件持久化与安全策略不迁入编辑器。

## Verification

- AC1 — `ArtifactPane.test.tsx` 验证两种模式共用草稿和手动持久化；Electron 中挂载的生产侧栏与会话通过自动保存写入真实文件，在源码/预览切换中保留未保存草稿，并通过 Cmd+S 保存。
- AC2 — `MarkdownLivePreview.test.tsx` 覆盖真实表格、公式、引用链接、图片定义和脚注；Electron 样例通过共享渲染器验证本地相对图片、列表/任务、公式和 Mermaid。格式错误的内容仍可在源码模式中访问。
- AC3 — Electron 并排样例比较 `StaticMarkdown` 与即时预览在浅色/深色、320/600 px 宽度下的几何尺寸、字号和颜色，包括富内容与横向溢出。
- AC4 — 共享源码/按键测试覆盖编辑语义；Electron 连续交互验证进入/失焦、撤销/重做、跨区替换及 CDP 中文组合输入，且不提交中间文字。仅渲染的组件测试断言不提交草稿。
- AC5 — `documentSource.test.ts` 验证无关编辑后保留 BOM、CRLF、frontmatter、模板字面量及行尾空格；只读组件测试与现有 `ArtifactPane.test.tsx` / `FileEditSessionManager.test.ts` 覆盖权限、失败、冲突及离开保护。
- AC6 — 定向 Composer 界面、冷输入、输入适配器、建议、占位符和现有即时预览/按键测试通过；Markdown 文件预览和注册表测试保留通用预览路由及图片/链接行为。Renderer 类型检查和改动范围 lint 检查验证迁移后的消费者。
