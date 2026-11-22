---
description: 未来知识块治理的纯存储基础，以及修订和来源边界
sources:
  - src/main/data/db/schemas/knowledgeChunkGovernance.ts
  - src/main/data/services/KnowledgeChunkGovernanceService.ts
  - src/shared/data/types/knowledgeChunkGovernance.ts
---

# 知识块治理存储

[English](chunk-governance-storage.md) | 中文

这是[拟议知识块治理功能](../../../../.agents/notes/proposed/feature/2026-11-22-knowledge-chunk-governance.md)的纯存储基础，不改变检索、重建、引用或知识块检查器。目前没有用户变更端点调用该服务。表中的 `excluded` 标志目前不会从搜索中排除知识块。

## Ownership

`KnowledgeChunkGovernanceService` 拥有主数据库的 `knowledge_chunk_governance` 和 `knowledge_chunk_governance_history` 表。每库派生索引保持不变，数据服务不执行文件系统、服务商或嵌入工作。

记录将知识库/条目及准确单元 ID 绑定到源内容哈希、原始 UTF-16 偏移量、原始文本及其 SHA-256 哈希。创建操作检查源条目属于该库、为已完成且非目录条目，并且所属库已完成。复合外键在服务之外仍保证库/条目所有权。永久删除条目/库会级联删除记录及历史。

未来知识工作流在调用 `create` 前必须获取并验证实际索引来源快照，并通过每库变更锁及检索发布进行协调。偏移长度相同不能证明传入文本是真实索引来源。本服务不承担来源验证或检索权威职责。

## Revisions and history

创建操作在同一同步写事务中写入修订 1 及其状态历史。状态包含排除标志、标签及可选文本修正。标签去除首尾空白、不得为空、去重并排序。`null` 表示移除修正，空修正会被拒绝。状态变化不覆盖原始来源证据。

`updateState` 要求准确的已保存来源哈希及预期修订。来源/修订过期时失败，不改变任何表。状态变化时递增修订并原子追加历史。规范化后相同状态不产生变化。历史写入失败时，对应当前状态写入也回滚。读取/历史查询按知识库、条目和单元限制范围。服务返回内部数据库行，不是已发布的跨进程实体端点。

追加迁移保持现有来源不变，不虚构治理记录。这些表位于正常数据库中，而非可替换索引。测试通过第二个文件数据库连接读取记录和历史；完整应用重启、知识库导入/导出及恢复工作流尚未针对本功能验证。

## Boundaries Still Pending

- 批量操作及其原子选择校验。
- 源/块身份变化协调及可见的需审阅状态。
- 候选上限/重排前立即排除，以及进行中搜索的修订复查。
- 有效文本/嵌入作业、匹配的词法/向量发布及崩溃恢复。
- 原始/修正引用修订处理及历史引用。
- 检查器控件、用户确认、费用提示及原生验收。

工作流和检索层执行Spec 前，不得暴露写入或将存储状态称为已索引/已生效。Spec 保持 proposed；本层不能独立解决 issue #19001。

## Verification

存储测试通过 `setupTestDatabase()` 使用生产迁移，覆盖原始证据、独立连接读取、规范化变更、过期来源/修订冲突、移除/无变化语义、注入历史写入失败、范围守卫和所有权级联。向前迁移测试从追加迁移前且已有知识行的数据库开始，检查原行保留且不虚构决策。
