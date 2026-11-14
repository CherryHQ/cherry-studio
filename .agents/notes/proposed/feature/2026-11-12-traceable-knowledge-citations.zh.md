# Agent Note: 可追溯的知识库引用

Status: proposed

[English](2026-11-12-traceable-knowledge-citations.md) | 中文

## Problem

聊天回答中的知识库引用无法追溯到其证据来源。已对照当前分支核实：

- `kb_search` 的输出（`src/shared/ai/builtinTools.ts` 中的 `kbSearchOutputItemSchema`）不包含页码或字符偏移，因此引用没有位置信息。
- `kb_read` 返回 `charStart` 与 `charEnd`，但 `src/renderer/utils/message/citations.ts` 中的 `parseKbReadCitation` 丢弃了它们。
- `src/renderer/components/chat/citations/KnowledgeCitation.tsx` 中的 `KnowledgeCitationCard` 渲染的是不可点击的 `<span>`，仅显示文档文件名和摘要片段。
- 引用 id 是每次调用生成的带随机前缀字符串，并不标识来源分块。重新索引无法保留这些 id。
- 不存在"不可用"状态。来源缺失与无法解析的引用 id 显示方式相同。

## Proposal

首次交付范围限定为 PDF 引用，与议题中的主要验证场景一致。文本类来源保留字符范围，但本次不提供查看器高亮。

- **索引时记录位置。** 为每个分块持久化位置：PDF 记录来源页码，其他类型记录字符范围。通过 `kb_search` 与 `kb_read` 的输出以可选字段暴露，使本次改动之前持久化的结果仍可解析。
- **引用模型。** 在 `src/renderer/utils/message/citations.ts` 构建的渲染端 `Citation` 上携带 `page`、`charStart`、`charEnd`，并停止在 `parseKbReadCitation` 中丢弃它们。
- **稳定标识。** 引用 id 由 `baseId`、`conceptId` 与分块内容哈希派生，而非每次调用的随机前缀。内容未变的重新索引保留原 id，早期消息中的引用仍可解析。
- **打开并高亮。** 使 PDF 引用的 `KnowledgeCitationCard` 可点击，在引用页码打开来源并高亮摘要文本。
- **可用性。** 打开前通过 `probeKnowledgeSourcePath`（`src/main/features/knowledge/pathStorage.ts`）探测来源。来源已删除时显示"不可用"，id 无法解析时显示"无效"。两种状态必须不同。

## Alternatives considered

- **仅显示位置，不做查看器。** 改动更小，但不满足议题中"点击 PDF 引用打开查看器"的要求。
- **保留每次调用的 id，重新索引时按内容匹配重映射。** 避免新的 id 方案，但重映射依赖启发式，分块边界在重新索引时移动即失效。
- **在消息中存储摘要快照并跳过来源探测。** 来源删除后回答仍可读，但议题要求回答将引用标记为不可用，而非展示过期内容。

## Acceptance criteria

- AC1 — 知识库引用显示文件名及其位置（PDF 为页码，其他为字符范围）。（verification: unit + renderer）
- AC2 — 点击 PDF 引用，在引用页码打开来源并高亮摘要文本。（verification: Electron）
- AC3 — 对分块内容未变的文档重新索引后，既有引用 id 保持不变，早期消息中的引用仍可解析。（verification: unit）
- AC4 — 来源文件已删除的引用渲染为"不可用"，且不打开任何内容。（verification: unit + renderer）
- AC5 — 无法解析的引用 id 渲染为"无效"，与"不可用"区分。（verification: unit + renderer）
- AC6 — 本次改动之前持久化的引用结果仍可解析并渲染，且无位置信息。（verification: unit）

## Risks

- **页码提取未经核实。** 当前 PDF 提取流程是否暴露页边界尚未确认。若未暴露，AC2 需要解析器改动，规模可能大于本 Spec 的假设。
- **分块哈希的开销。** 基于内容哈希的 id 会增加索引时的开销。在大型知识库上测量后再确定。
- **持久化结果的迁移。** 旧结果没有 `page` 或稳定 id。AC6 覆盖解析；本 Spec 不提议回填。
- **待决问题：非 PDF 查看器。** Markdown 与文本来源的字符范围高亮是否纳入本次改动，还是放入后续工作，需要决定。
