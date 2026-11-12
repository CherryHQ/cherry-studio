# Agent Note: 知识文件摄入前预检

Status: proposed

[English](2026-11-12-knowledge-format-preflight.md) | 中文

跟踪 [CherryHQ/cherry-studio#18985](https://github.com/CherryHQ/cherry-studio/issues/18985)。复杂文件的解析质量不在范围内，归属于按格式拆分的后续 issue。

## Problem

知识文件的支持范围只在代码中决定，用户在摄入开始前无法得知。

- 扩展名白名单 `knowledgeSupportedFileExts`（`src/shared/utils/file/fileExtensions.ts:8`）过滤渲染进程的选择器和对话框（`src/renderer/pages/knowledge/components/AddKnowledgeItemDialog.tsx:44-49, 227, 244`）。被跳过的文件只产生一条计数提示（`unsupported_files_skipped`）。
- 主进程以通用错误拒绝不支持的扩展名（`assertSupportedKnowledgeFilePath`，`src/main/features/knowledge/ingestion/KnowledgeIngestionService.ts:771-773`）。
- 没有大小或页数检查。
- 纯图片或扫描版 PDF 只有在读取后才被发现：`indexDocumentsJobHandler` 找不到可索引文本时将条目置为失败（`src/main/features/knowledge/tasks/indexDocumentsJobHandler.ts:102-110`）。用户要等任务运行后才知道。
- 单个文件是否需要 OCR 或在线处理器，不会逐文件展示。`FileProcessingSection.tsx` 只展示配置级别的本地 OCR 提示。
- 没有面向用户的矩阵公布有效的格式、大小、页数、扫描和处理器规则。

## Proposal

1. **统一支持矩阵。** 在 `src/shared/data/presets/` 中新增共享定义，按格式列出：接受的扩展名、大小上限、PDF 页数上限、扫描输入是否需要 OCR，以及处理该输入的处理器。由该定义派生 `knowledgeSupportedFileExts` 和选择器过滤器。
2. **共享预检函数。** 位于 `@shared` 的纯函数接收文件元数据（文件名、大小，以及读取成本可接受时的页数），返回 `ok` 或一个原因码：`unsupported_format`、`size_limit`、`page_limit`、`ocr_required` 或 `processor_not_configured`。渲染进程和主进程都调用它。
3. **渲染进程预检。** 在选择文件时运行，逐文件展示原因，只阻止失败的文件。通过的文件照常继续。
4. **主进程预检。** 在 `KnowledgeIngestionService` 中于复制或入队前运行，向 IPC 调用方返回相同的原因码，使渲染进程无法绕过该规则。
5. **扫描与处理器门禁。** 扫描版 PDF 检测在选择文件时做低成本的文本层检查。若需要 OCR 且未配置处理器，以 `processor_not_configured` 阻止，并链接到文件处理器设置。读取后的空文本失败保留为兜底。
6. **文档。** 中英文各一份用户可见的矩阵，由同一共享定义生成，避免漂移。

审批后实现前需要确认的开放决策：

- 大小和页数上限：各格式的具体数值，以及是强制执行还是仅提示。
- 缺少 OCR 处理器时阻止文件还是仅提示，考虑到扫描版 PDF 目前也会失败。
- 页数是否在选择时即时读取，大 PDF 可能耗时。

## Alternatives considered

- **保留读取后失败，仅改进提示文案。** 不作为唯一方案：issue 要求摄入开始前给出原因，而读取后失败仍会浪费一次任务和一条条目记录。
- **仅在渲染进程校验。** 被否决：IPC 及未来的调用方会绕过规则。
- **扩展完成回调 Spec**（`proposed/architecture/2026-10-25-knowledge-file-processing-completion-callback.md`）。被否决：该 note 负责条目如何等待处理结果，本 Spec 负责任何条目存在之前接受什么。两者保持独立并相互链接。

## Acceptance criteria

- AC1 — 不支持的扩展名在选择器和主进程中都以 `unsupported_format` 拒绝，且在任何复制或入队之前 (verification: renderer and unit)
- AC2 — 超过已配置大小或页数上限的文件，在摄入前以 `size_limit` 或 `page_limit` 拒绝 (verification: unit)
- AC3 — 未配置 OCR 处理器的扫描版 PDF，在摄入前以 `processor_not_configured` 阻止，并附带处理器设置链接 (verification: renderer)
- AC4 — 受支持的 PPTX 通过预检并展示所选处理器，解析输出不变 (verification: unit)
- AC5 — 相同输入下，渲染进程与主进程返回完全一致的原因码 (verification: unit)
- AC6 — 发布的矩阵由共享定义生成，中英文页面通过双语配对检查 (verification: docs gate)

## Risks

- 大 PDF 的页数统计可能很慢；检查必须成本有界，或在超时时跳过并提示。
- 除非测试将共享定义与读取器行为绑定，矩阵的值可能与实际读取器行为漂移（`ReaderFactory.test.ts` 已覆盖扩展名路由）。
- 未配置 OCR 时阻止扫描版 PDF，会改变用户今天看到的较晚失败结果，需要明确审批。
