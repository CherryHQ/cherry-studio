# Agent Note: 精简无用途的外部知识库持久化字段

Status: proposed

[English](2026-10-20-external-knowledge-persistence.md) | 中文

## Problem

外部知识库栈持久化了远端层级元数据和扫描文档计数，但生产消费者没有使用这些持久化值。每个额外字段都需要维护数据库约束、实体 schema、写入传递和迁移。

本次检查的实现是[知识库 UI 栈顶](https://github.com/CherryHQ/cherry-studio/pull/20998)，提交为 `9ee0125ffa05e827edb773f78697259c5a4d82c1`。这些改动仍在开放的 PR 中；本文不声称该功能已在 main 发布。

| 字段 | 当前写入者 | 消费者证据 |
| --- | --- | --- |
| Document `canonicalNodeId` | `ExternalKnowledgeSyncService` 元数据构造函数 | 持久化并经 DataApi 返回，未发现后续生产字段读取 |
| Document `parentNodeId` | `ExternalKnowledgeSyncService` 元数据构造函数 | 持久化并经 DataApi 返回，未发现后续生产字段读取 |
| Document `relativeBreadcrumb` | `ExternalKnowledgeSyncService` 元数据构造函数 | 持久化并经 DataApi 返回，未发现后续生产字段读取 |
| Source `lastScannedCount` | `ExternalKnowledgeSourceService` 任务结算 | 持久化并经 DataApi 返回，未发现 UI 或运行时字段读取 |

读取适配器在遍历和规范节点选择时另外使用面包屑元数据。该实时输入不是持久化的 Document 副本，必须保留。

## Proposal

删除四个持久化字段及其依赖约束、实体属性和写入参数。保留 `Connection → Source → Document → KnowledgeItem` 关系及所有已支持的同步行为。

### Scope

- 更新 `externalKnowledgeDocument.ts`、`externalKnowledgeSource.ts`、对应数据服务和共享实体 schema。
- 从 `ExternalKnowledgeSyncService` 移除冗余持久化参数；保留提供方遍历描述符和任务实际使用的扫描计数。
- 调整受影响的 DataApi 契约、fixture 和参考文档。删除每个字段前，复核精确标识符、SQL 列名、整个对象的消费者、备份恢复和导出。发现真实消费者时应修订 Spec，不能静默移除其行为。
- 根据更新后的 schema 生成向前迁移。不得重写已发布的 SQL 或 snapshot、删除用户数据库，或引入兼容双写。

### Preserved behavior

保留 Source 的 `(baseId, provider, tenantId, spaceId)` 唯一约束。更换授权连接不能绕过同空间重复接入限制；同空间多个子树仍不属于本次变更。

保留稳定的远端文档身份、`remoteRevision`、`contentHash`、`lastSeenAt`、文档警告、可用性和本地条目所有权。远端版本避免不必要的读取，内容 hash 避免不必要的索引。保留 `Source.revision` 和 `activeJobId` 发布隔离、固定 Markdown 快照、暂存清理、定时与手动同步、授权恢复及断开后保留本地副本的行为。

本阶段不将 Document 合入 KnowledgeItem，不把所有摘要列合成 JSON，也不引入 `mode`、SyncState 或通用提供方配置。

### Migration and ownership

迁移必须保留所有剩余字段，以及全部 Source、Document、Connection、KnowledgeItem、日程和任务引用。通过真实生产迁移链建立空库和变更前的有数据数据库，插入代表性旧记录，再向前迁移。显式断言 `foreign_key_check` 为空：当前迁移入口只记录违规，不抛出异常。

领域改动在 [PR #20742](https://github.com/CherryHQ/cherry-studio/pull/20742) 所属层实施，写入者改动经 [PR #20856](https://github.com/CherryHQ/cherry-studio/pull/20856) 传播，并在 [PR #20903](https://github.com/CherryHQ/cherry-studio/pull/20903) 和 [PR #20998](https://github.com/CherryHQ/cherry-studio/pull/20998) 验证生命周期与 UI 消费者。将已批准 Spec 集成到实现下层前，检查实时栈和迁移依赖。不得把领域改动藏在 UI 层，或重写已合并的历史。

### Relationship to the wider design

这是外部知识库调整的阶段 A。阶段 B 将接入真实远端检索提供方，引入统一的 `KnowledgeProvider` 入口与独立的 `retrieval`、`documents` 能力，并分离远端检索与本地同步的存储和执行。

该架构保持为独立 Spec：在实施前选择真实提供方，验证其认证、资源和检索契约，明确查询结果、引用和取消能力的改动。批准本文仅授权阶段 A，不代表未实现的通用适配器已获验证，也不授权占位远端提供方。

## Alternatives considered

- 保留所有列：避免迁移工作，但长期维护没有当前业务消费者的同步副本。
- 同时从提供方描述符删除层级信息：会破坏遍历和规范节点选择，只有持久化是冗余的。
- 将 Document 合入 KnowledgeItem：把稳定远端身份与可替换本地版本耦合，使不可用文档和保留的静态副本更难表达。
- 立即重做全部外部知识库表：将授权和迁移风险与未经验证的第二提供方契约混在一起。

## Acceptance criteria

- AC1 — 生产实体读写不再要求四个已删除字段，同时飞书遍历和规范节点选择返回相同的受支持文档集合 (verification: shared/main 契约测试；owner: 领域与适配层)
- AC2 — 空库和有数据数据库均可向前迁移，保留字段值、ID、所有权、任务与日程引用不变，无外键违规，再次启动迁移安全 (verification: 真实 SQLite 迁移测试；owner: 领域层)
- AC3 — 增量同步仍跳过未变化内容、原子替换已变化内容，并拒绝暂停、断开或重新授权后的过期发布；中断的暂存仍可恢复 (verification: main 同步与生命周期测试；owner: 同步与生命周期层)
- AC4 — 同空间重复来源仍被拒绝，警告与最近结果 UI 行为保持，本地快照仍可重新索引，断开仍可保留已完成的本地副本 (verification: main/renderer 测试和针对性 Electron 验证；owner: 生命周期与 UI 层)
- AC5 — 最终实现同步更新受影响的参考文档和双语 note，记录实际执行的范围化验证，不包含无关的提供方、认证或检索改动 (verification: 文档检查和逐层变更范围；owner: 最终集成层)

## Implementation evidence

阶段 A 已在现有领域、适配、同步、生命周期和 UI 层的 PR #20742、#20800、#20856、#20903 和 #20998 中实现。阶段 B 继续暂缓。

- AC1：共享契约和 24 个适配器遍历测试通过。已移除持久化元数据写入者，保留遍历描述符和任务输出的扫描计数。
- AC2：有数据的迁移测试在旧 schema 上失败，追加迁移 `0030_external_knowledge_persistence` 后通过。已验证剩余字段值、所有权、任务/日程引用、外键、完整性及重复执行迁移。空库测试通过。
- AC3：同步与生命周期测试通过，包括内容未变时的跳过、发布隔离、暂存恢复及断开行为。任务结算测试现通过生产迁移测试工具断言真实 SQLite 状态。
- AC4：最终定向运行通过 8 个文件中的 204 个 main 测试，以及 4 个文件中的 135 个 renderer 测试。工作区 Electron 从独立 fixture 数据展示了最近结果与文档警告。断开并保留本地后，Source/Document 记录被移除，已完成条目和 Markdown 快照保留，无外键违规。重新索引由自动化测试覆盖，未发起真实嵌入请求。
- AC5：参考文档、逐层变更范围、范围化 lint/格式检查、node/web 类型检查、迁移链检查及文档检查均通过。只读 DataApi 端点投影精简后的共享实体；仓库搜索未发现按字段读取的备份/导出消费者。未跟踪的集成不在验证范围内。

## Risks

删除列可能触发 SQLite 重建表；错误重建外键会删除依赖记录或产生孤立记录。使用现有迁移入口和生产链 fixture，并检查每个重新生成的索引与约束。

DataApi 当前返回整个实体。仓库搜索只能证明没有已知字段消费者，不能保证未跟踪的外部集成不存在依赖。实现必须检查所有暴露的端点，并在修改形状前识别已发布的兼容承诺。

实现依据用户明确的阶段 A 指令推进。目前尚未记录当前提交的 GitHub Approval；本 note 保持 proposed，实现 PR 保持 draft。真实飞书授权和联网同步尚未验收。
