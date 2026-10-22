# Agent Note: 保留知识库操作归属

Status: implemented

[English](2026-10-20-knowledge-operation-ownership.md) | 中文

## 问题

批量重建会等待所有来源获取结束。因此，一个失败的获取操作可能在同一条目较新的重建已经完成后才报告失败，将条目标记为失败并隐藏新索引。

## 决策

每次重建执行在知识库变更互斥锁内认领当前子树。获取失败、重置和任务结算只能修改仍归该次执行所有的条目。容器重置也会检查后代条目。重建任务在重启时放弃执行，因此操作归属仅保存在内存中；结算仅释放自己的认领。

只有在变更锁内确认本地所有者已完成时，未变的远端版本或哈希才能跳过索引。失败的本地所有者走正常的暂存发布流程。清理入队和子树状态更新在调用方事务内使用有界批次；所有批次与所有权撤回一起提交或回滚。

大批量回归还发现，递归状态更新的查询计划会为每个根条目扫描整个知识库。递归步骤使用 SQLite CROSS JOIN 将父节点固定为外层循环，使已有的 base/group 索引可直接查找子节点，避免重复扫描整个知识库。

调度变更与删除知识库共用变更互斥锁和删除准入检查。进行中的断开操作在任务结算和最终删除结束前持有临时排他标记；重新授权跳过这些来源，显式调度或状态变更则拒绝它们。断开失败会释放标记并保留已有的 paused/重试行为；这不引入可跨重启恢复的断开操作。

同步终态清理与结果发布分别处理。授权失效会暂停 Source 并推进其版本，因此旧 Job 不能发布摘要。结算仍可在同一事务中按当前 Source 版本清除该 Job 自己的活跃关联，并在提交后通知。替换 Job 由不同的 id 继续保护。如果清理也要求原版本，成功重新授权后仅手动同步的来源仍会被阻塞。

## 考虑过的替代方案

检查条目状态无法区分 completed → processing → completed。在网络获取期间持有知识库变更锁会阻塞无关变更。持久化代次需要为不会跨重启恢复的工作修改数据库结构。

## 后果

较新的重叠操作优先，无关根条目仍可继续处理。普通删除和外部文档所有权保护继续生效。

## 验证

- Regression — `ownedSubtreeJobHandlers.integration.test.ts`：失败的 A 获取等待 B，较新的 A 重建完成后旧失败才结算；通过真实 SQLite 查询边界验证 A 仍已完成且可见。
- Regression — `reindexSubtreeJobHandler.test.ts`：已有删除、重置、中断和调度回归测试通过。

- Regression — `ExternalKnowledgeSyncService.test.ts`：版本或哈希未变，以及取得锁前发生失败时，都会重建本地所有者。
- Regression — `subtreeDeletion.integration.test.ts`：33,001 个根条目通过真实 JobManager 的载荷验证与真实 SQLite 状态更新；注入失败会回滚所有任务和状态变更。

- Regression — `ExternalKnowledgeSourceLifecycle.test.ts`：在知识库删除期间排队的调度变更不能留下孤立调度。
- Regression — `ExternalKnowledgeDisconnect.test.ts`：取消等待期间提交重新授权不会改变断开版本，最终成功删除来源及文档记录。

- Regression — `ExternalKnowledgeSourceLifecycle.test.ts` 和 `syncExternalSourceJobHandler.test.ts`：凭证失效后，无论结算与重新授权的先后顺序如何，都只清除终态 Job 的关联，保留新版本结果和替换 Job，并在提交后通知。
