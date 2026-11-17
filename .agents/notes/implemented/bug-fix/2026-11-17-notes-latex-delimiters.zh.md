# Agent Note: 保留 Notes 中的 LaTeX 分隔符

Status: implemented

[English](2026-11-17-notes-latex-delimiters.md) | 中文

## 问题

Notes 通过 TipTap 原生 Markdown 扩展解析内容。其数学扩展能识别美元符号分隔符，却不识别 `\[...\]` 或 `\(...\)`，因此这些公式在笔记中显示为原始文本，而聊天渲染正常。

## 决定

扩展现有块级与行内数学 tokenizer，分别识别方括号包围的显示公式和圆括号包围的行内公式。保持美元符号分隔符行为及序列化格式不变。

## 备选方案

- 预处理笔记文本并替换为美元符号分隔符：会在 Markdown tokenizer 之外重复解析分隔符，并可能改动普通文本或代码。
- 将 Notes 解析器替换为聊天 Markdown 管线：会扩大编辑器契约变更范围，还需要映射完整的富文本编辑器 schema。

## 影响

Notes 无需改写已保存文件即可支持与聊天渲染一致的四种 LaTeX 分隔符。序列化仍使用既有美元符号格式。

## 验证

- 回归 — `src/renderer/components/RichEditor/__tests__/nativeMarkdown.test.ts`：验证方括号显示公式和圆括号行内公式被解析为数学节点；既有测试覆盖美元符号行内与显示公式。
