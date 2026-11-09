# Agent Note：Session 消息树存储约束

Status: implemented

[English](2026-11-09-session-tree-storage-constraints.md) | 中文

## 问题

Session 消息的父节点只是无约束文本。直接写入可以保存不存在的父节点、其他 Session 的父节点，或没有父节点的普通消息。直接新增约束又会拒绝已发布 v2 数据库中的平铺历史及 v1 导入器写入的数据。

## 决策

要求 `(role = 'root') = (parent_id IS NULL)`，并建立 `(session_id, parent_id)` 到 `(session_id, id)` 的复合外键及配套唯一索引。保留已有的 root 唯一索引。父节点外键使用 NO ACTION：普通删除必须先重接子节点，整段 Session 删除仍级联清理全部历史，不沿深层消息链递归级联。

在自动生成的约束迁移之前追加自定义补数据迁移。仅重建没有选中节点且没有任何父节点连边的历史，按 `(created_at, id)` 排序。保留已有分支、选中节点、时间戳和消息事实。迁移器关闭外键期间，显式检查已有父节点是否合法；失败时回滚整个升级。补 root 时关闭 FTS 插入触发器，避免与显式分配的 FTS rowid 冲突；生产迁移器随后恢复触发器。在迁移事务内重建 FTS，确保生成的 root 即使没有文本也有对应的 FTS 文档。该一次性重建会扫描已有可搜索文本；仅恢复触发器会破坏外部内容一致性，并可能导致后续 Session 删除失败。

v1 导入器创建 root，按规范化后的时间戳和 ID 顺序插入消息，在有界批次之间维护各 Session 的尾节点。root、正文、选中节点和 FTS 更新都在已有导入保存点中完成。数量校验排除生成的 root。直接写 SQL 的测试夹具通过共享辅助函数创建真实 root。

## 考虑过的替代方案

- 仅约束父节点 ID 的外键允许跨 Session 连边。
- 父节点级联删除可能误删后代，长链还会触及 SQLite 触发器深度限制。
- 仅靠启动 Seeder 补树太晚，因为结构迁移先于 Seeder 执行。

## 影响

这些约束保护局部父子关系，不证明无环、选中节点合法性或原生执行身份。已有非法连边会阻止迁移，不会静默选择替代父节点。

## 验证

- Regression — `agentSessionTreeConstraints.test.ts` 使用真实文件 SQLite，覆盖非法插入和更新、先重接后删除、含 2,000 个后代的整段 Session 删除、树字段引入前及约束引入前的带数据升级、分支和 FTS 结果保留、FTS 外部内容一致性以及升级后删除空 Session 和有消息的 Session，以及非法连边导致的事务回滚。
- Regression — `AgentsMigrator.treeValidation.test.ts` 覆盖 10,001 条消息的跨批次导入及跨 Session 的时间戳规范化；`AgentsMigrator.transforms.test.ts` 检查回滚和重试；`AgentsMigrator.sessionCache.test.ts` 在导入后执行数量校验。现有数据、运行时、搜索、回收站和迁移消费者使用合法树夹具验证。
