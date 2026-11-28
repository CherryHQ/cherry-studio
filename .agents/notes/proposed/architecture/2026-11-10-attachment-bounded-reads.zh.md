# Agent Note: 有界附件读取

Status: proposed

[English](2026-11-10-attachment-bounded-reads.md) | 中文

## Problem

提取缓存未命中时，聊天附件在请求预算生效之前就被整体读取。`prepareChatMessages()` 通过 `Promise.all` 准备每条消息，每个非原生附件都调用 `extractDocumentText()`，后者在缓存未命中时读取整个正文。之后 `applyInlineCaps()` 才决定有多少文本进入 prompt（[`attachmentRouting.ts`](../../../../src/main/ai/messages/attachmentRouting.ts)）。因此请求预算只限制 prompt，并不限制读取、解码或缓存的字节数。

[2026-11-09 附件准备 note](../../implemented/bug-fix/2026-11-09-attachment-preparation-workers.md) 中的 worker 改动把纯文本解码和分配移出了 Electron 主进程。它有意保留了输入字节读取、完整提取文本缓存以及 PDF/Office 解析的现状。剩余的无界成本包括：

- `FileManager.read(..., { encoding: 'binary' })` 在提取缓存未命中时把整个文件读入内存，包括 30 分钟 TTL 到期或文件版本变化之后。未变化的附件有有效缓存条目时直接返回缓存结果，不读取正文。
- `extractDocumentText()` 以 30 分钟 TTL 缓存完整提取文本，且没有总字节容量上限（[`attachmentTextExtraction.ts`](../../../../src/main/ai/messages/attachmentTextExtraction.ts)）。
- `read_file` 先提取完整文本再分页，因此页大小限制的是结果，而不是工作量（[`ReadFileTool.ts`](../../../../src/main/ai/tools/adapters/aiSdk/builtin/ReadFileTool.ts)）。
- PDF 和 Office 解析器在主进程运行，且没有取消信号。

工作量随源文件大小增长，而不是随附件配额增长。因此一个带超长单行的 11 MB Markdown 文件，在发送时提取缓存未命中的情况下，可能产生全文件的 I/O 和内存开销；缓存命中时复用已提取的文本。本 note 不声称这一机制单独导致了 #22667 的崩溃。

## Proposal

让请求预算同时约束读取，而不只约束 prompt。

### 顺序

- `resolveAttachmentBudget()` 在 `AiService` 中已经早于 `prepareChatMessages()` 运行。它的结果转换为请求的字节配额，使用 worker 已采用的保守 UTF-8 上界。
- 该配额按现有的 `allocateAttachmentBudget` 规则分配给本次请求的非原生文本附件。每个文件最多读取其份额，包括编码检测样本和解码前瞻；这些读取不在份额之外增加配额。
- 对于纯文本，提取永远不会超过其份额读取。超过份额的文件只获得头部摘录和截断标记。

### 纯文本读取

- 通过已有的 `FileManager.readChunk(id, offset, length)` 读取，而不是整体加载文件。
- 增量解码。UTF-8 使用流式解码器，把跨块的不完整多字节序列带到下一块。遗留编码先从有界的前导样本检测，然后以相同方式解码。
- 超长单行由字节游标处理，不做按行扫描。

### 续读游标

- `read_file` 对模型暴露的契约仍是 `offset`/`limit`，但位置改为文件内的字节偏移，并附带读取时的版本（`mtime`、`size`）。
- 如果两页之间版本发生变化，工具返回明确的“文件已变更”错误，而不是拼接新旧文本。
- 早前截断提示中的 UTF-16 偏移在一个兼容窗口内继续接受，之后退役（见 Risks）。

### 缓存

- 提取文本仍按 `(entryId, mtime, size)` 缓存。新增字节容量上限和最近最少使用淘汰。30 分钟 TTL 保留。
- 纯文本只缓存有界读取范围内的提取结果。PDF/Office 的完整文档结果保持现有行为，直到后续 Spec。

### 无工具模型

- 无法调用 `read_file` 的模型只接收有界头部，并附带截断标记，标记中不提及续读。这是现有行为，予以保留。

### 取消

- 中止会停止后续的分块读取，并阻止排队中的 worker 任务启动。正在运行的 worker 仍按现有方式终止。

### 不在本 Spec 范围内

PDF 和 Office 解析限制、按页读取 PDF，以及 Office 转换的隔离执行，需要单独的 Spec。本 note 覆盖纯文本、预算顺序、缓存、游标和取消。这一拆分需要批准确认；见 Risks。

## Alternatives considered

- **单文件大小上限（例如 PR #22670 中的 8 MiB）。** 作为最终设计被拒绝。该 PR 已关闭且未合并，既不限制总量，也不限制已接受文件的耗时，多个被接受的文件仍可能耗尽请求配额。如果迁移需要，它可以作为临时防护保留。
- **保留整文件读取，只加缓存。** 被拒绝。#23927 移走的 CPU 工作不是唯一成本。缓存未命中时，整文件读取仍随源文件大小增长；完整文本缓存也没有总字节容量上限。
- **移除内联附件文本，只依赖 `read_file`。** 被拒绝。不支持工具调用的模型会完全丢失附件内容，这会改变所有提供商的行为。
- **所有提取都使用 utility process。** 推迟。它适合 Office 转换，但 Office 不在本 Spec 中。纯文本解码不需要原生崩溃边界。

## Acceptance criteria

- AC1 — 对于 11 MB 纯文本附件，准备阶段读取的全部字节数，包括编码检测样本和解码前瞻，不超过该请求的单文件配额。(verification: unit, fake `FileManager` counting read bytes)
- AC2 — 对于一次请求中的多个非原生文本附件，跨附件读取的总字节数（包括编码检测样本和解码前瞻）以及内联的 token 数，分别不超过相应的请求配额。(verification: unit)
- AC3 — 分块解码与整缓冲区解码结果一致，包括跨块边界拆分的多字节 UTF-8 字符、大于单块的单行文本，以及遗留编码样本。(verification: unit)
- AC4 — 连续的 `read_file` 分页内容连续，没有丢失或重复字符。如果两页之间文件版本发生变化，工具返回明确的文件已变更错误。(verification: unit)
- AC5 — 在读取或排队的 worker 任务期间中止请求，会停止后续读取，并阻止该任务启动。(verification: unit)
- AC6 — 提取缓存的字节数永不超过其容量，并优先淘汰最近最少使用的条目。TTL 仍会使条目过期。(verification: unit)
- AC7 — 无法调用工具的模型只接收有界头部和截断标记，不包含续读指令。(verification: unit)
- AC8 — 在真实 Electron 聊天发送中，附带一个 11 MB 单行 Markdown 附件和历史中的多个附件时，读取字节数与主进程峰值内存保持在批准时设定的阈值内，且主进程事件循环延迟不随源文件大小增长。(verification: Electron)

## Risks

- **字节配额与 token。** UTF-8 字节上界对 ASCII 和散文偏保守，因此内联的文本少于窗口允许的量。这是 #23927 已接受的成本。
- **编码检测。** 从有界样本检测遗留编码时，如果样本不具代表性，可能选错编码。错误选择会产生乱码，而不是崩溃。当样本存在歧义时，检测仍须退回保守的 null 结果。
- **游标兼容性。** 现有对话记录和截断提示中含有 UTF-16 的 `offset=` 值。在一个兼容窗口内同时接受两种形式，会增加之后需要移除的代码。
- **版本竞争。** 两页之间被替换的文件能通过版本检测出来，但 `mtime` 和 `size` 都未变化的文件检测不出来。这一点被接受，理由与现有缓存键相同。
- **范围拆分。** 将 PDF/Office 拆到后续 Spec，意味着本层之后最大的单文件成本仍然存在。批准时应确认该拆分，或将两者合并。
- **AC8 中的阈值。** 本 note 不设定数值上限。在批准实施前，必须先设定并测量这些阈值。

## Open decisions for approval

1. PDF/Office 放入后续 Spec（建议），还是纳入本 Spec。
2. 缓存字节容量的取值。
3. AC8 中读取字节数、峰值内存和事件循环延迟的阈值。
4. 是否保留 UTF-16 `offset=` 兼容，以及保留多久。
