# Agent Note: Phase 0b 文档审计结果

Status: implemented

[English](2026-08-19-phase-0b-doc-audit-outcomes.md) | 中文

## Problem

Phase 0b 审计发现有两处实现需要偏离[原始文档治理提案](../../proposed/process/2026-08-18-docs-governance-and-spec-workflow.zh.md)。
提议中的 Chat adapter 与 UI 约定描述了从未落地的 API 和所有权边界。提案
还要求把所有带域前缀的存量文件名改名,但完成后的树中仍有 24 个此类文件。

如果不明确记录这些差异,本应治理仓库的提案会与仓库现实互相矛盾。

## Decision

参考文档以现行实现为准。因此 Phase 0b 删除 `chat/adapters.md` 和
`chat/conventions.md`;未来 adapter 契约实际落地时,再为它增加现行文档。

Phase 0b 不批量改名现有的域前缀文件。除非搬家或歧义要求改名,现有
basename 保持稳定。新增或被改名的文档采用域内最短且无歧义的名称,避免
重复域前缀。

本 note 只取代上述两项 Phase 0b 决策。原治理提案仍定义目标树、frontmatter、
门禁、Agent Notes 与后续推进阶段。

## Alternatives considered

- **保留两篇 target-architecture Chat 文档。** 拒绝,因为 reference 是现行事实的
  权威;即使显式标注 target,仍会向 agent 和贡献者提供不存在的 API。
- **在审计中改名全部 24 个带前缀文件。** 拒绝,因为这会增加入链 churn,
  却不改善内容审计或任何门禁。
- **原地改写原提案。** 拒绝,因为发生变化的决策需要新的取代记录与交叉链接,
  而不是抹除历史。

## Consequences

- Chat reference 只映射已落地的模块与契约。
- Phase 0b 期间保持现有 reference 链接稳定。
- 接受 24 个存量带前缀 basename;无冗余前缀规则在文档新增或改名时生效。
