# Agent Note: 保留知识库操作归属

Status: implemented

[English](2026-10-20-knowledge-operation-ownership.md) | 中文

## 问题

批量重建会等待所有来源获取结束。因此，一个失败的获取操作可能在同一条目较新的重建已经完成后才报告失败，将条目标记为失败并隐藏新索引。

## 决策

每次重建执行在知识库变更互斥锁内认领当前子树。获取失败、重置和任务结算只能修改仍归该次执行所有的条目。容器重置也会检查后代条目。重建任务在重启时放弃执行，因此操作归属仅保存在内存中；结算仅释放自己的认领。

## 考虑过的替代方案

检查条目状态无法区分 completed → processing → completed。在网络获取期间持有知识库变更锁会阻塞无关变更。持久化代次需要为不会跨重启恢复的工作修改数据库结构。

## 后果

较新的重叠操作优先，无关根条目仍可继续处理。普通删除和外部文档所有权保护继续生效。

## 验证

- Regression — `ownedSubtreeJobHandlers.integration.test.ts`：失败的 A 获取等待 B，较新的 A 重建完成后旧失败才结算；通过真实 SQLite 查询边界验证 A 仍已完成且可见。
- Regression — `reindexSubtreeJobHandler.test.ts`：已有删除、重置、中断和调度回归测试通过。
