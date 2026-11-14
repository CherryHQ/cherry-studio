# Agent Note: 数据目录搬迁后恢复托管 Agent 工作区

Status: implemented

[English](2026-10-31-agent-workspace-relocation.md) | 中文

## 问题

复制应用数据目录会保留 SQLite 中的绝对工作区路径和 Claude checkpoint 配置路径。复制后的原生历史也可能仍以旧工作区作为索引。因此，既有或已归档的 Agent 会话可能无法通过托管根目录校验，或无法续接。仅更新工作区记录不能修复原生历史的归属。

## 决策

启动时在注册 driver 之后、恢复会话之前，修复符合已知布局的系统工作区。外部工作区保留原路径。既有 runtime 生命周期服务负责执行顺序；数据库服务已由阶段顺序保证就绪，不增加生命周期服务。

迁移协调器负责工作区校验、暂存、版本 1 的 `.relocation/<workspaceId>/journal.json` 协议、文件发布和数据库事务。Runtime adapter 负责其产物路径白名单、原生身份、历史校验及 checkpoint 重映射。数据服务为受影响工作区中的消息写入不透明的替换 checkpoint，不改变消息内容或活动时间戳。`AgentWorkspaceStorageService` 持有准入阻断状态，直到经过验证的恢复完成。

Claude 解析每份必需历史的所有者，合并无冲突的项目产物，保留无关文件字节，并重映射托管配置引用。Pi 按自身持久化规则校验保存的身份与 checkpoint，包括初次手动压缩未落盘的情况。待处理的已退役 runtime 历史仍交由既有 Pi 迁移负责。活动、已归档以及支持的中断工作区存储保留原有形态；复制后的目录身份只有在原始归属和内容一致性得到验证后才能重新绑定。

## 考虑过的替代方案

- 仅更新数据库路径：原生历史和配置引用仍保留旧归属。
- 全局替换存储内容中的路径：可能在未证明归属的情况下修改用户消息及外部配置。
- 在宿主或 SQL 服务中解释原生 checkpoint：重复维护 adapter 私有格式，使数据库修复与各 runtime 耦合。
- 不使用恢复 journal 直接提交文件：无法恢复文件系统发布与 SQLite 事务之间的中断。

## 影响

已提交的数据库路径用于区分完成清理与回滚。源和目标摘要、路径范围校验、链接检查及备份保护中断的发布过程；旧 journal 操作仍可恢复，包括已退役 DSH 的产物记录。缺失必需历史或目标冲突时保留可恢复数据，并阻止受影响工作区启动，不创建空的原生对话。经过验证的恢复会解除准入阻断。

修复不增加公共 IPC 或数据库 schema，不搬迁日志、不删除旧 profile，也不迁移用户选择的工作区。复制后的中断存储需要保留原目录及 journal 作为归属证据。原生格式由 adapter 持有，文件系统与数据库的提交协议保持集中管理。

## 验证

- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/relocateSystemWorkspaces.test.ts --maxWorkers=1 --no-file-parallelism`：真实 SQLite 与文件系统场景覆盖历史归属、归档及复制恢复、原生记录损坏、回滚、连续迁移、不透明 adapter checkpoint 的持久化、拒绝跨工作区 checkpoint 写入，以及恢复后解除准入阻断。
- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/agentSession/persistence/__tests__/AgentSessionMessageBackend.test.ts src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts src/main/ai/agents/__tests__/agentDataDirectory.test.ts src/main/ai/agentSession/__tests__/AgentSessionArchivePersistence.integration.test.ts src/main/ai/runtime/__tests__/registerDrivers.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts src/main/ai/runtime/pi/PiRuntimeDriver.test.ts src/main/ai/agentSession/fork/__tests__/publication.test.ts --maxWorkers=1 --no-file-parallelism`：受影响的启动、持久化、存储、driver 和 fork 消费者保持既有契约。

上述文件在定向本地运行中一起通过。原生 SDK fixture 不代表已完成打包 Electron、搬迁后经过身份认证的真实续接，或物理跨卷验收。
