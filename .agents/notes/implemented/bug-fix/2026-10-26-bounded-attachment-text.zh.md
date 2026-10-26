# Agent Note: 在解码前限制纯文本附件提取

Status: implemented

[English](2026-10-26-bounded-attachment-text.md) | 中文

## Problem

`extractDocumentText` 在 `attachmentBudget` 限制内联文本前，先完整读取并解码纯文本附件。因此 token 预算无法约束最初的读取、解码器分配与切词输入。Issue #22667 报告约 11 MB、包含超长内联图像文本块的 Markdown 附件会导致应用崩溃；目前缺少原文件、应用版本、崩溃层与日志，原始崩溃仍未确认。

## Decision

纯文本、未知扩展名与无扩展名的文本提取最多接受 8 MiB 源字节。这是本地资源上限，数值与现有文本预览上限一致，提取模块独立持有常量。读取前检查当前文件版本，再用 `FileManager.readChunk` 多读取一个溢出字节，避免检查后文件增大引起全文分配。在解码或缓存前拒绝溢出。PDF 与 Office 解析路由保持原样。

`AttachmentTextTooLargeError` 使用现有本地化文档大小错误与 payload 错误分类。聊天准备将其传给用户，不再替换成仅模型可见的通用无法读取提示。`read_file` 也使用同一提取限制。

## Alternatives considered

- 仅在切词后截断：仍会先执行无界工作。
- 静默解码有界前缀：可能截断内联图片或多字节编码，并假装已读取完整文档。
- 限制全部附件格式：会改变本报告文本路径以外的原生媒体与文档解析行为。

## Consequences

超过 8 MiB 的文本附件需要拆分或缩减。普通文本仍使用原有编码感知解码器与版本缓存。该上限约束本提取路径，但不证明报告者的崩溃原因，也不限制 PDF/Office 解析器、原生媒体、附件总数或渲染进程摄取。

## Verification

- Regression — 通过 `pnpm test:main` 显式指定 `attachmentTextExtraction.test.ts`、`attachmentRouting.test.ts`、`attachmentBudget.test.ts` 与 `ReadFileTool.test.ts`：90 项测试通过。新增 11 MiB 拒绝测试在原提取源码下失败，因为 Promise 成功返回而未拒绝；这是单元回归验证，不是原应用崩溃的复现。
