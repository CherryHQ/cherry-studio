# Agent Note: 将对话选区保存到 Notes

Status: implemented

[English](2026-11-03-selection-to-notes.md) | 中文

## Problem

对话选区浮动条和右键菜单提供复制、引用。要把有用段落留在 Notes，需要先复制再手动建笔记，或导出整条消息。

## Decision

两个选区入口都提供“保存到 Notes”。操作在异步工作前捕获所选文字，取首个不是 Markdown 代码围栏的非空行，最多 50 个字符作为标题；没有这样的行时使用“未命名笔记”，并携带配置的 Notes 路径交给现有 `exportContentToNotes` 服务。导出器保留目录校验、文件名碰撞处理、错误提示和成功后明确点击的“打开笔记”操作，见[打开导出的笔记](2026-10-27-open-exported-note.md)。

选区提取复用引用路径：渲染后的公式保留 Markdown 数学定界符，代码查看器的行号被排除。这是文字摘录，不重建原始 Markdown，也不持久化来源消息链接。右键操作要求选区两个端点都在当前消息界面内，且不在可编辑控件中。浮动条沿用现有的选区及可编辑界面边界。

每个选区菜单实例同时只允许一次 Notes 写入。写入结束前禁用再次保存，写入失败后可以重试。保存不修改消息，也不自动跳转。导出器按需加载，不加入选区界面的立即加载依赖图。

## Alternatives considered

- 导出整条消息会保留所选段落以外的无关内容。
- 追加到当日摘录需要额外的目标与追加冲突策略；本次每次操作创建一篇普通笔记。
- 添加来源消息链接或把任意选区 HTML 转回 Markdown，会扩大现有提取契约。

## Consequences

无需新增偏好设置、IPC 路由、持久化格式、依赖或模型请求。两个入口复用已翻译的“保存到 Notes”文案及共享 UI 控件。写入失败不改变来源消息，由现有导出器统一提供一次写入错误提示。

## Verification

- Regression — `src/renderer/components/__tests__/SelectionNotes.test.tsx`：真实浮动条与 Cherry／原生右键菜单操作只保存捕获的段落、保留数学定界符、排除显示的代码行号、避免把代码围栏作为标题、阻止待完成写入重复提交、允许失败后重试并排除可编辑及界面外的选区；真实导出器提供共享成功操作。
- Regression — `src/renderer/components/__tests__/SelectionContextMenu.links.test.tsx`：选中链接时，原有复制、引用及网址操作与“保存到 Notes”并存。
- Regression — 现有选区、数学、浮动条及 `ExportService.test.ts` 测试保护提取、关闭、文件名碰撞后的跳转和失败提示。

在 macOS 开发构建中，使用全新配置与合成对话，验证了 Cherry 右键菜单和浮动条实际写入 Notes 文件。带行号的代码选区保留围栏和缩进，排除显示行号，并以首行代码作为标题。渲染层测试另模拟待完成写入和原生菜单桥接。未验证打包 Electron 与操作系统原生菜单界面。
