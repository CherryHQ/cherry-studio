# Agent Note: Agent workspace storage policy

Status: proposed

[English](2026-11-09-agent-workspace-storage-policy.md) | 中文

## Problem

Issue #22415 报告称，智能体读取 400 多张图片后，一个超过 70 GB 的任务输出文件被删除；这些事件数值仍未经核实。所检查的工作树与 `origin/main` 一致，提交为 `e0b6c72ddbc2cc13b19e0863056cd3c59e15d3c3`；下文所有源码锚点均对应此版本。工作区验证检查路径包含关系和可访问性，不测量大小（`src/main/ai/runtime/agentSessionWorkspace.ts:55-76`）。内置 CLI 将会话工作区用作工作目录（`src/main/ai/runtime/claudeCode/settingsBuilder.ts:189-196`、`src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts:197-209`）。有归属声明的工作区不会被孤立数据清理删除，而自动卷容量警告仅在可用空间低于 1 GiB 时触发（`src/main/ai/agents/agentOrphanSweep.ts:73-78,104-108`、`src/main/services/StorageMonitorService.ts:17,78-82`）。建议分四次独立发布：用量测量、软警告、主动启用的取消机制、明确启用的保留策略。本 PR 仅提供分析和可执行的工程提案，不改变行为、偏好设置、源码、测试或数据库模式。

### What the report establishes and what it does not

以下是 #22415 提供的**已报告但 UNVERIFIED 的事件详情**：Windows；应用版本未知；一次智能体任务读取了 400 多张图片；文件名为 `bnv4ybfwg.output`；显示大小为 70 多 GB；应用拥有的会话工作区位于系统盘；文件在检查前已删除。无法从已删除的文件重建确切字节数、已分配磁盘空间、绝对路径、写入时长、内容、图片编码、运行时版本和生成方。不要把报告中的 GB 换算为 GiB，也不要估算每张图片的膨胀比例。

代码支持 CLI 来源的可能性，但不能确定这个具体文件的来源：

- 已安装 SDK 暴露 `SDKTaskNotificationMessage.output_file`（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6298-6313`）。此依赖锚点是本地证据，不是由仓库拥有的实现契约。
- Cherry 将收到的字段复制为 `outputFile`，随后在根消息投影中将其省略（`src/main/ai/runtime/claudeCode/ClaudeRuntimeState.ts:139-146`、`src/main/ai/agentSession/RootMessageProjection.ts:234-243`）。
- 根因章节中的搜索未找到 Cherry 对此任务输出路径的读取方或写入方。这是限定范围内的未发现证据，不能确定 CLI 内部的命名或保留规则。
- Cherry 也会写入合法的工作区文件：`saveAttachment` 解析工作区输出路径并将附件发布到该位置（`src/main/ai/tools/saveAttachment.ts:89-115`）。目录用量统计必须覆盖所有写入方，不能只匹配 `.output` 文件名。

若事件再次发生，建议诊断记录运行时与构建标识、工作区标识、采样时间戳、逻辑大小与已分配大小的区别，以及取消是否已完成。只有在另行决定并取得诊断同意后才保留文件名或内容；此处没有可用的事件载荷。

### Where an Agent run writes data

下文的 `{userData}` 指 Cherry 选定的数据目录，不一定在系统卷上：数据根目录基于 Electron userData 构建（`src/main/core/paths/pathRegistry.ts:50-52`）。事件中位于系统盘的情况并非通用行为。清单覆盖下文有证据的智能体存储根目录和共享存储；任意第三方工具可能写到其他位置，其外部目标为 **UNVERIFIED**。

| 位置                                                                                                           | 所有者                                                  | 命名 / 生命周期                                                                                                                                                                                                                                        | 当前移除触发条件与证据                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{userData}/Data/Agents/system/{date}/{sessionId}`                                                             | Cherry 拥有目录；CLI、Cherry 工具及被调用的工具写入内容 | UTC 日期和会话 ID；按需准备（`src/main/data/services/AgentWorkspaceService.ts:87-95,278-305`、`src/main/ai/runtime/agentSessionWorkspace.ts:36-63`）；根目录注册于 `src/main/core/paths/pathRegistry.ts:263`                                           | 运行时关闭后为回收站归档；永久清除移除产物；孤立数据清理排除每个具有数据库归属声明的路径（`src/main/ai/agents/AgentLifecycleService.ts:496-515,552-574`、`src/main/ai/agents/agentOrphanSweep.ts:73-78,93-114`）。这些路径中没有基于大小的触发条件。 |
| 同级文件 `<workspace>.tar.gz`、`.tar.gz.tmp`、`.archiving`、`.restoring`、`.storage.json`、`.storage.json.tmp` | Cherry                                                  | 归档、暂存和恢复日志后缀（`src/main/ai/agents/agentWorkspaceStorage.ts:13-20`）；gzip 打包（`src/main/ai/agents/agentWorkspaceStorage.ts:160-170`）                                                                                                    | 发布归档时移除暂存内容；恢复提交后移除归档和日志；永久清除移除整套产物（`src/main/ai/agents/AgentWorkspaceStorageService.ts:285-315,406-442`）。清理会保留有归属声明的归档（`src/main/ai/agents/agentOrphanSweep.ts:93-108`）。                      |
| `{userData}/Data/Agents/.forks/{operationId}/...` 和 `{operationId}.json`；复制出的目标系统工作区              | Cherry 协调运行时原生快照                               | 操作 / 分组目录和独立资源记录（`src/main/core/paths/pathRegistry.ts:262`、`src/main/ai/agentSession/fork/AgentSessionForkOperations.ts:264-299`、`src/main/ai/agentSession/fork/resources.ts:30-32`）                                                  | 清理和恢复检查所有权；已发布或保留的资源可继续存在；不会一律按年龄删除（`src/main/ai/agentSession/fork/AgentSessionForkOperations.ts:369-375,406-469`）。                                                                                            |
| `{userData}/Data/Agents/.claude/`，尤其是 `projects/`                                                          | 内置 Claude Code CLI；Cherry 选择根目录并协调归属声明   | CLI 拥有的会话记录；确切内部文件名及其他会增长的子项为 **UNVERIFIED**（`src/main/core/paths/pathRegistry.ts:249-253,476-477`）                                                                                                                         | 驱动回收排除已持久化或仍存活的恢复令牌（`src/main/ai/agents/agentOrphanSweep.ts:141-168,171-194`）；Cherry 传入较长的 CLI 清理周期（`src/main/ai/runtime/claudeCode/settingsBuilder.ts:101-103,335-337`）。                                          |
| `{userData}/Data/Agents/.pi/sessions` 和 `.durable`                                                            | Cherry 选定根目录下的第三方运行时存储                   | Pi 会话 / 持久化存储（`src/main/core/paths/pathRegistry.ts:257-260`）                                                                                                                                                                                  | 运行时专属的孤立数据与永久清除驱动钩子保留已持久化和仍存活的归属声明（`src/main/ai/agents/agentOrphanSweep.ts:141-194`）；仅凭此分派器无法核实内部文件的确切保留规则，为 **UNVERIFIED**。                                                            |
| `{userData}/Data/Agents/.outputs`                                                                              | Cherry 为 Pi 提供的输出存储适配器                       | 运行时提供的 `file.name`、UTF-8 内容（`src/main/core/paths/pathRegistry.ts:259`、`src/main/ai/runtime/pi/piBehaviorHost.ts:145-150`）                                                                                                                  | 此适配器不执行删除。专用过期机制为 **UNVERIFIED**；`rg -n 'feature.agents.outputs' src/main` 找到注册、写入、读取根目录和测试，未找到移除方。不要假定工作区永久清除覆盖此同级根目录。                                                                |
| `{userData}/Data/Files` 中超大的工具结果数据块                                                                 | Cherry FileManager                                      | 基于内容寻址的 `vfs_<hash>.txt` 标记和内部文件条目；全文仍被存储（`src/main/core/paths/pathRegistry.ts:273`、`src/main/ai/contextBuild/toolOutputStore.ts:24-32,52-68`）                                                                               | 消息引用和 `delete_when_unreferenced` 清理策略（`src/main/ai/contextBuild/toolOutputStore.ts:4-8,61-66`）；截断上下文不等于删除磁盘数据。                                                                                                            |
| `{userData}/Data/Agents/{agentId}/memory` 和身份文件                                                           | Cherry / 智能体工具                                     | 每个智能体的数据路径，确保记忆目录存在（`src/main/core/paths/pathRegistry.ts:261`、`src/main/ai/agents/agentDataDirectory.ts:140-151`）                                                                                                                | 孤立数据清理只考虑以 UUID 命名且没有归属声明的智能体目录，并设有新近修改保护门槛（`src/main/ai/agents/agentOrphanSweep.ts:19-23,66-90`）。                                                                                                           |
| `app.logs`                                                                                                     | Cherry 日志 / 传输层                                    | 平台日志，包括 macOS 的 `~/Library/Logs/<App>/`；并非总在 userData 内（`src/main/core/paths/pathRegistry.ts:89`、`src/main/core/paths/constants.ts:101-111`）                                                                                          | `app.logs.retention_days`：启动时、每 12 小时及偏好设置变化时清理（`src/main/services/LogRetentionService.ts:8-31`）。                                                                                                                               |
| `{userData}/Data/cherrystudio.sqlite`                                                                          | Cherry                                                  | 会话 / 工作区行与消息持久化（`src/main/core/paths/pathRegistry.ts:98`、`src/main/data/db/schemas/agentSession.ts:9-24`、`src/main/data/db/schemas/agentWorkspace.ts:10-18`、`src/main/ai/agentSession/persistence/AgentSessionMessageBackend.ts:1-7`） | 会话永久清除删除过期行（`src/main/ai/agents/AgentLifecycleService.ts:342-381`）。删除行后物理数据库文件是否缩小在此处为 **UNVERIFIED**，不得承诺这些字节已回收。                                                                                     |

已注册的用户工作区单独处理：准备过程要求目录已经存在，不会创建目录（`src/main/ai/runtime/agentSessionWorkspace.ts:39-46,73-80`）。下述拟议 P0–P3 默认值仅覆盖系统工作区；统计或删除用户项目需要另行决定范围。

### Root cause

有证据支持的结论是缺少存储控制边界，因而允许报告中的故障发生，不能认定已证明存在图片处理缺陷：

1. **路径验证不等于容量准入。** 会检查包含关系、拒绝路径组件中的符号链接并检查目录可访问性；不检查字节数（`src/main/ai/runtime/agentSessionWorkspace.ts:55-105`、`src/main/ai/agents/agentDataDirectory.ts:48-105`）。
2. **执行过程委托写入。** `settingsBuilder` 选择 `session.workspace.path` 作为 cwd，连同环境传给 CLI 启动过程（`src/main/ai/runtime/claudeCode/settingsBuilder.ts:189-196,327-332`、`src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts:197-209`）。这些启动选项没有施加文件系统字节上限。CLI 中具体的 `.output` 写入方仍为 **UNVERIFIED**。
3. **未找到工作区总配额。** 下文的精确搜索找到了无关的行数、记忆字符限制和能力名称，但没有工作区总字节数的强制限制。这支持所搜源码范围内的未发现结论，不能证明所有依赖内部均不存在此机制。
4. **清理保留有所有者的数据。** 有数据库归属声明的路径不论大小或年龄均被排除；只有无归属产物才会进入五分钟的新近修改保护检查（`src/main/ai/agents/agentOrphanSweep.ts:23,73-78,104-112`、`src/main/ai/agents/AgentWorkspaceStorageService.ts:227-243`）。因此，已完成但未移入回收站的会话可保留工作区的全部内容。回收站归档和永久清除是显式生命周期操作（`src/main/ai/agents/AgentLifecycleService.ts:342-381,506-515,547-574`）。
5. **自动警告较晚且无法归因。** 监控器对 userData 所在卷采样，在可用空间低于 1 GiB 时警告，每 5–60 分钟轮询（`src/main/services/StorageMonitorService.ts:17-29,58-61,78-82`）。渲染进程显示持续的整卷提示（`src/renderer/hooks/useStorageMonitorNotification.ts:10-31`）。快速写入可能在两次采样之间耗尽磁盘，甚至早于任何警告；该机制无法识别正在增长的会话。

可复现的未发现证据，从仓库根目录执行：

```sh
rg -n "MAX_TOOL_INPUT_SIZE|MAX_WORKSPACE|WORKSPACE.*(MAX|LIMIT|CAP|QUOTA)|AGENT.*(MAX|LIMIT|CAP|QUOTA)|workspace.*(maxBytes|maxSize|quota|limit|cap)" src/main src/shared --glob '!**/__tests__/**'
rg -n -i "(workspace|agent).{0,100}(max(_| )?(bytes|size)|size(_| )?(limit|cap|quota)|disk(_| )?(limit|quota)|total(_| )?bytes)|(max(_| )?(bytes|size)|size(_| )?(limit|cap|quota)).{0,100}(workspace|agent)" src/main/ai src/main/services src/shared/ai src/shared/data --glob '!**/__tests__/**'
rg -n "MAX_TOOL_INPUT_SIZE" src
ls src/main/ai/runtime/claudeCode/streamAdapter.ts
rg -n 'output_file|outputFile|\.output' src/main/ai/tools src/main/ai/streamManager src/main/ai/runtime/claudeCode --glob '!**/__tests__/**'
rg -n "workspace.*(size|bytes|usage)" src/main src/renderer
rg -n "size|bytes" src/main/ai/agentSession/relocateSystemWorkspaces.ts
```

用量搜索未找到逐工作区磁盘用量界面；渲染进程中的匹配是工作区标签 / 图标（`src/renderer/pages/agents/components/AgentRightPane/AgentSessionDetailsSections.tsx:314`）。迁移搜索未找到大小统计（`src/main/ai/agentSession/relocateSystemWorkspaces.ts:328-382`）。

`MAX_TOOL_INPUT_SIZE` 在源码中没有匹配；`streamAdapter.ts` 不存在。输出路径搜索找到了 `outputFile` 赋值及无关的工具结果属性，未找到 `.output` 文件读取方或写入方（`src/main/ai/runtime/claudeCode/ClaudeRuntimeState.ts:144`）。不要将不存在的逐工具输入常量当作保护措施。Doctor 另有整卷 5 GiB 警告 / 1 GiB 失败及诊断数据大小检查；这些都不是自动的逐会话控制（`src/main/services/diagnostics/doctor/checks/storage.ts:11-13,45-94`）。

### Inventory of today's limits

范围：所检查工作区、读取 / 输出、持久化和检测路径中的上限与阈值；无关的模型 / 提供商限制不构成磁盘策略。二进制单位遵循 `KB=1024`、`MB=1024*KB`、`GB=1024*MB`（`src/shared/utils/constants.ts:1-3`）。**这些机制都不强制限制工作区总字节数。**

| 常量 / 设置                                                                       | 当前值                                                           | 证据                                                                                                                          | 限制对象 / 相关性                                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_PROBE_TIMEOUT_MS`                                                      | 5,000 ms                                                         | `src/main/ai/runtime/agentSessionWorkspace.ts:13,84-105`                                                                      | 目录探测等待时间；无存储上限。                                                                                                                  |
| `MAX_RECURSION_DEPTH`                                                             | 1,000                                                            | `src/main/utils/fileOperations.ts:9,176-179`                                                                                  | 目录大小辅助函数的深度；不限制文件数、字节数或运行时写入速率。                                                                                  |
| `READ_FILE_MAX_BYTES`                                                             | 128 KiB                                                          | `src/main/ai/agents/doctor/doctorTools.ts:62,399-410`                                                                         | Doctor 的单次读取；对写入**没有帮助**。                                                                                                         |
| `SIZE_CAP_BYTES` / `PAGED_SIZE_CAP_BYTES`                                         | 5 MiB / 50 MiB                                                   | `src/main/ai/tools/adapters/aiSdk/builtin/FsReadTool.ts:28-32,196-212`                                                        | 整文件 / 可读取文件的绝对大小；对 CLI 写入**没有帮助**。                                                                                        |
| `DEFAULT_READ_LIMIT`                                                              | 2,000 行                                                         | `src/main/ai/tools/adapters/aiSdk/builtin/FsReadTool.ts:47-60`                                                                | 默认读取页，模式中没有上限；输出字符上限才是约束。                                                                                              |
| `CONTEXT_PERSIST_THRESHOLD_CHARS` / 回退值 `READ_OUTPUT_CHAR_CAP`                 | 50,000 个字符                                                    | `src/shared/ai/builtinTools.ts:190-197`、`src/main/ai/tools/adapters/aiSdk/builtin/FsReadTool.ts:41-46`                       | 上下文卸载和每次调用返回的文本，请求可覆盖；卸载的全文会被存储（`src/main/ai/contextBuild/toolOutputStore.ts:52-68`）。**不限制持久化字节数。** |
| `MAX_REQUESTED_OUTPUT_TOKENS` / `DEFAULT_REQUESTED_OUTPUT_TOKENS`                 | 128,000 / 32,000 tokens                                          | `src/main/ai/runtime/claudeCode/environment.ts:47-51,91-110`、`src/main/ai/runtime/claudeCode/settingsBuilder.ts:297-307`     | 请求的模型输出；有条件地固定环境变量。对工具 / CLI 文件增长**没有帮助**；未建立字节换算关系。                                                   |
| `MIN_AUTO_COMPACT_WINDOW` / `MAX_AUTO_COMPACT_WINDOW`；`AUTO_COMPACT_TRIGGER_PCT` | 100,000 / 1,000,000 tokens；80%                                  | `src/main/ai/runtime/claudeCode/environment.ts:40-41,69-85`                                                                   | 上下文预算计算和触发条件，不是文件系统压缩。                                                                                                    |
| `AGENT_SESSION_MESSAGES_MAX_LIMIT` / 默认值                                       | 200 / 50 行                                                      | `src/shared/data/api/schemas/agentSessionMessages.ts:28-34`                                                                   | 消息列表分页行数；对消息字节数或磁盘写入**没有帮助**。                                                                                          |
| `AGENT_MEMORY_MAX_WRITE_CHARS`                                                    | 1,000,000 个字符                                                 | `src/shared/ipc/schemas/agent.ts:39-49`                                                                                       | 单次记忆编辑器写入的输入；**不限制**重复写入、工作区内容或 CLI 输入。                                                                           |
| `MAX_TOOL_INPUT_SIZE`                                                             | 不存在                                                           | 上文的未发现搜索；已有记忆输入限制位于 `src/shared/ipc/schemas/agent.ts:39-49`                                                | 没有通用逐工具输入字节上限的证据；即使输入有界，仍不能限制工具生成的字节数。                                                                    |
| `FRESHNESS_GATE_MS`                                                               | 5 分钟                                                           | `src/main/ai/agents/agentOrphanSweep.ts:22-23`、`src/main/ai/agents/AgentWorkspaceStorageService.ts:233-239`                  | 孤立数据回收要求的最小陈旧时间，不是有归属工作区的保留周期。                                                                                    |
| `CLAUDE_SESSION_RETENTION_DAYS` → `cleanupPeriodDays`                             | 365,000 天                                                       | `src/main/ai/runtime/claudeCode/settingsBuilder.ts:101-103,335-337`                                                           | Cherry 提供的 CLI 会话记录清理设置；不是工作区保留规则，也不是对本次事件的保证。                                                                |
| `data.trash.retention_days`                                                       | 默认 30 天；0 禁用自动行清除                                     | `scripts/data-classify/data/target-key-definitions.json:1174-1178`、`src/main/services/trash/trashPurgeJobHandler.ts:121-128` | 仅针对已在回收站中的数据；为 0 时仍清理残留。每日调度：`src/main/services/trash/TrashService.ts:44-56`。                                        |
| `STORAGE_LOW_THRESHOLD_BYTES`；`intervalForFree`                                  | 1 GiB；可用空间 ≥20/≥10/≥5/≥1/<1 GiB 时分别为 60/30/15/10/5 分钟 | `src/main/services/StorageMonitorService.ts:17-29`                                                                            | 仅提供整卷警告。                                                                                                                                |
| `DISK_LOW_BYTES` / `DISK_CRITICAL_BYTES`；`DIAGNOSTIC_DATA_LARGE_BYTES`           | 5 GiB / 1 GiB；200 MiB                                           | `src/main/services/diagnostics/doctor/checks/storage.ts:11-13,45-94`                                                          | Doctor 警告 / 失败及诊断数据阈值，不是运行中工作区的强制限制。                                                                                  |

这是新的存储策略决策，在[托管工作区迁移](../../implemented/bug-fix/2026-10-31-agent-workspace-relocation.md)之上补充；该说明继续拥有迁移恢复决策。本提案不取代现有说明。

## Proposal

本节所有内容均为**提案**，包括名称、阈值和默认值。每个阶段均需单独进行实现评审，并可独立于后续阶段发布。

### P0 — Measure and surface

1. 新增 `src/main/ai/agents/AgentWorkspaceUsageService.ts`，作为 `WhenReady` 生命周期服务，在 `src/main/core/application/serviceRegistry.ts` 注册。遵循 `StorageMonitorService` 的 `@Injectable`、`@ServicePhase`、启动后台检查和 `registerInterval` 所有权模式（`src/main/services/StorageMonitorService.ts:41-55,94-102`、`src/main/core/application/serviceRegistry.ts:165-170,191-194`）。像该服务一样，通过 `application.getPath` 解析根目录，通过 `loggerService` 记录日志（`src/main/services/StorageMonitorService.ts:3-9,59,70`）。
2. 测量每个活跃系统工作区下普通文件的逻辑字节数。对有界的小目录树复用 `getDirectorySize`，或在同一模块暴露有界且可恢复遍历进度的变体；现有实现跳过符号链接和特殊文件，但递归遍历没有工作量 / 时间预算（`src/main/utils/fileOperations.ts:162-220`）。保持现有调用方契约不变。
3. 拟议采样器：每 **5 秒**触发一次全局 tick，同时仅有一个遍历，轮转活跃工作区；**每个 tick 最多检查 2,000 个条目或执行 100 ms 的调度工作**，先达到者为准。在条目之间让出执行权，保留有界游标，避免生成无限大小的 `readdir` 数组。轮次开始 / 结束时也通过同一队列测量。不持续扫描空闲会话；只在检查 / 准入或 P3 调度时刷新空闲工作区。
4. 累加 `lstat.size`，绝不读取文件内容。发布 `bytes`、`checkedAt`、`complete` 和 `error/stale` 状态。部分结果是下界，不是零或精确总量。单次文件系统调用无法通过 JS 截止时间中止；在其完成前保留槽位，不启动替代调用。成本上限约束调度工作，不约束操作系统延迟。拒绝遍历链接 / 重解析点，并重新验证目录，防范替换竞态。
5. 在 `src/shared/ipc/schemas/ai.ts` 中新增拟议请求 `ai.agent.workspace.get_usage` 和事件 `ai.agent.workspace.usage_changed`；在 `src/main/ipc/handlers/ai.ts` 中与现有工作区路由一起实现请求（`src/shared/ipc/schemas/ai.ts:458-467`、`src/main/ipc/handlers/ai.ts:273-276`）。通过 `IpcApiService` 发送主进程拥有的快照，参照自动重命名使用 `useIpcOn` 消费（`src/shared/ipc/schemas/ai.ts:548-551`、`src/main/services/TopicNamingService.ts:467-468`、`src/renderer/hooks/agent/useSession.ts:578-584`）。重连后由请求提供初始状态；事件包含工作区 ID 和单调递增的采样序列。
6. 在会话详情界面显示用量 / 陈旧状态（`src/renderer/pages/agents/components/AgentRightPane/AgentSessionDetailsSections.tsx:314`）；新增渲染进程订阅 hook。建议将整卷警告提高至 **5 GiB**，保留独立的 **1 GiB 严重**诊断，并在**智能体轮次运行期间每 30 秒轮询容量**。其他时候保持现有自适应频率。这既不取代目录统计，也不取代当前健康状态 / 提示传递机制（`src/main/services/StorageMonitorService.ts:24-29,78-82`、`src/renderer/hooks/useStorageMonitorNotification.ts:10-31`）。

P0 不停止轮次，也不删除数据。发布门槛是可信且成本有界的测量、可观察的陈旧 / 错误状态，以及更早的卷容量通知。

### P1 — Soft cap

在 `bytes >= warn_bytes` 时增加可配置警告；建议默认值为**每个系统工作区 1 GiB**。每次跨越阈值仅发出一次警告，保持可见的超阈值状态，仅在一次完整采样低于阈值后重新布防。若部分结果的下界已达到阈值，足以发出警告；较小的不完整结果不能清除警告。提供检查 / 打开工作区、使用正常 Stop 操作停止，以及存储设置入口。执行自动继续；继续运行无需确认。在后续实现中添加 i18n 字符串，新控件使用 `@cherrystudio/ui`。整卷警告保持独立可见。在用量服务 / 拟议 `usage_changed` 事件中实现警告状态；现有整卷提示展示了恢复后清除的持续警告模式（`src/renderer/hooks/useStorageMonitorNotification.ts:17-29`）。

### P2 — Hard cap through existing cancellation

建议默认 `max_bytes = 0`（禁用）；提供 **10 GiB** 作为需主动启用的预设。启用时要求 `0 < warn_bytes < max_bytes`，或用 `warn_bytes = 0` 禁用软警告。超限条件为 `bytes >= max_bytes`，包括已达到该值的部分结果下界。首次超限时，先锁存超预算状态并阻止准入，再取消。调用 `application.get('AiStreamManager').abortAndDrain(buildAgentSessionTopicId(sessionId), 'agent-workspace-over-budget')`；这是复用现有方法的拟议新原因字符串。话题构建器位于 `src/main/ai/agentSession/topic.ts:16-18`；保留流程已从主进程调用此方法（`src/main/ai/agents/AgentLifecycleService.ts:360-365`）。`abortAndDrain` 获取分派锁、中止、等待执行循环并关闭会话（`src/main/ai/streamManager/AiStreamManager.ts:1383-1417`）。其取消回退会到达 `AgentSessionRuntimeService.abortPendingTurn`，中止当前轮次控制器（`src/main/ai/streamManager/AiStreamManager.ts:1361-1374`、`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1832-1837`）。流中止会关闭运行时；Claude 拆卸会等待关闭（`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1056-1063`、`src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts:471-485`）。不要凭空设计 CLI `setQuota` API，也不要将后台任务 Stop 当作轮次取消（`src/shared/ipc/schemas/ai.ts:478-482`）。建议增加独立的相邻 `<workspace>.budget.json` 锁存文件，在取消前原子记录工作区 / 会话标识和超限状态。不要复用归档事务日志。扩展存储产物枚举 / 所有权、永久清除、恢复和迁移，使其包含新后缀；现有后缀所有权集中管理（`src/main/ai/agents/agentWorkspaceStorage.ts:13-20`、`src/main/ai/agents/AgentWorkspaceStorageService.ts:227-243,422-442`）。锁存写入失败时，仍在内存中阻止准入；硬策略启用时，重启后任何准入都必须先完成新测量。所有准入路径都通过运行时宿主设门槛，包括排队、定时、后台和复用会话；不能只依赖渲染进程控件。已持久化的超限保持阻断，直到用户显式操作：清理并重测至预算以下、提高 / 禁用上限，或选择新工作区。不自动重试或静默复用。预检测量不完整时必须继续阻止准入并显示可恢复状态，不能静默授权用量未知的工作区。每个超限轮次仅取消一次；拆卸过程中继续测量，报告待完成 / 失败的取消。保留部分文件。不要为强行降到预算以下而删除输出。采样在最坏情况下的超限幅度无界；真正的磁盘保证需要另行评审的操作系统隔离 / 配额设计。

### P3 — Retention of finished sessions

建议为**空闲且已完成的系统工作区会话**提供可选的年龄和总大小策略，排除运行 / 排队轮次、分叉操作、待恢复工作和所有权未核实的对象。建议默认禁用自动保留策略。“已完成”必须根据运行时 / 队列状态和最近已结束活动判断，不能只凭陈旧的目录 mtime。启用后建立空闲最久优先的候选列表：达到期限或配置的保留工作区总预算时，使会话有资格进入现有回收站 / 归档生命周期。在生命周期锁下重新检查，**每分钟最多处理一个会话**，策略满足或候选耗尽即停止。不另设并行清理所有者。现有稳定会话检查和关闭后归档行为是组合接入点（`src/main/ai/agents/AgentLifecycleService.ts:547-575,577-614`）。使用归档 / 恢复机制进行可逆移除；压缩不保证回收足够空间，还会临时需要归档空间余量（`src/main/ai/agents/AgentWorkspaceStorageService.ts:285-315`、`src/main/ai/agents/agentWorkspaceStorage.ts:160-170`）。可用空间不足时推迟打包，提供显式永久清除 / 导出决策。从这些调用点无法确认压缩线程位置，为 **UNVERIFIED**。`agent.workspace.retention_days` 将决定合格会话何时移入回收站；`data.trash.retention_days` 继续决定入回收站后何时最终清除。现有默认 30 天和 0=不自动清除的语义保持不变，包括为 0 时继续清理残留（`scripts/data-classify/data/target-key-definitions.json:1174-1178`、`src/main/services/trash/trashPurgeJobHandler.ts:121-128`）。大小预算不能越过此宽限期；应显示暂不可回收的保留字节，而非承诺总量硬上限。让现有孤立数据清理回收真正无归属的残留，保留待恢复和新近修改保护检查（`src/main/ai/agents/agentOrphanSweep.ts:53-59,93-114`）。绝不能仅因工作区较大，就将有数据库归属声明的工作区重新定义为孤立数据。

### Proposed preferences and generation

| 拟议键（并非现有策略）                | 阶段 | 拟议默认值 / 单位           | 语义                                                                     |
| ------------------------------------- | ---- | --------------------------- | ------------------------------------------------------------------------ |
| `agent.workspace.warn_bytes`          | P1   | 1,073,741,824 字节（1 GiB） | 0 禁用软警告；否则为正整数。                                             |
| `agent.workspace.max_bytes`           | P2   | 0 字节（禁用）              | 正整数启用取消阈值；建议的主动启用预设为 10,737,418,240 字节（10 GiB）。 |
| `agent.workspace.retention_days`      | P3   | 0 天（禁用）                | 正整数启用按年龄判定已完成会话移入回收站的资格。                         |
| `agent.workspace.retention_max_bytes` | P3   | 0 字节（禁用）              | 正整数启用按保留系统工作区总量选择空闲最久的会话；回收站宽限期仍适用。   |

将新产品键加入 `scripts/data-classify/data/target-key-definitions.json`，然后运行 `npm_config_verify_deps_before_run=false pnpm data:generate` 并检查生成变更。生成器拥有 `preferenceSchemas.ts` 和迁移映射；不要手工编辑生成输出（`scripts/data-classify/README.md:7-8,13-26`）。本次仅文档 PR 不包含生成器或偏好设置变更。

### Impact surface

| 阶段 | 拟议文件 / 模块                                                                                                                                                                                       | 偏好设置 / 渲染进程                                                                                                                                                                 | 性能成本与回归风险面                                                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0   | 新增 `AgentWorkspaceUsageService.ts`；`fileOperations.ts`；`serviceRegistry.ts`；`StorageMonitorService.ts`；`src/shared/ipc/schemas/ai.ts`；`src/main/ipc/handlers/ai.ts`；运行时宿主开始 / 结束接线 | 无新产品偏好设置；拟议 5 GiB 警告常量 / 活跃轮询频率。新用量 hook；现有 `src/renderer/pages/agents/components/AgentRightPane/AgentSessionDetailsSections.tsx`；后续 PR 中的语言目录 | 元数据成本随条目数增长，不随文件内容字节数增长。IPC 扇出 / 陈旧状态、启动延迟、定时器泄漏、UI 刷新顺序及共享辅助函数调用方均可能回归。保留辅助函数调用方契约（`src/main/utils/markdownParser.ts:379`、`src/main/features/miniApp/management.ts:79`）。 |
| P1   | 用量服务阈值状态；渲染进程详情 / 设置 / 通知集成                                                                                                                                                      | `warn_bytes`；定义与重新生成的 `src/shared/data/preference/preferenceSchemas.ts`；全部语言翻译                                                                                      | 不增加第二个遍历器。需评审关闭 / 重新布防行为、跨窗口重复提示、无障碍支持和合法大任务。                                                                                                                                                                |
| P2   | 用量服务；`AgentSessionRuntimeService.ts`；`AiStreamManager.ts` 集成；`agentWorkspaceStorage.ts`；`AgentWorkspaceStorageService.ts`；`relocateSystemWorkspaces.ts`；分叉产物处理；IPC 确认操作        | `max_bytes`；生成的偏好设置模式；运行受阻说明、清理 / 重查、提高上限 / 新建工作区控件                                                                                               | 准入 / 队列竞态、超限状态重启持久化、关闭死锁、恢复阻塞、重复取消、部分产物、无界预检延迟。拟议侧车文件必须随所有工作区生命周期操作一同处理。                                                                                                          |
| P3   | `AgentLifecycleService.ts`；用量服务候选统计；`AgentWorkspaceStorageService.ts`；回收站作业协调；现有孤立数据清理集成                                                                                 | `retention_days`、`retention_max_bytes`；生成的偏好设置模式；保留预览及保留字节总量                                                                                                 | 归档读写全部内容；主要风险是可用空间峰值消耗、恢复保真度、活跃会话保护及回收站宽限期。不要盲目改写各运行时的保留规则。                                                                                                                                 |

对于无预算限制的完整扫描，设 `B` 为文件代表的逻辑字节数，`E` 为每个工作区的条目数，`N` 为活跃工作区数，`I` 为间隔秒数。所请求的统计覆盖量是**每秒代表 B × N / I 字节**，但实际 I/O 约为 **E × N / I 次元数据操作**，不是读取 B 字节内容。当前辅助函数使用 `readdir` / `lstat` / `size`（`src/main/utils/fileOperations.ts:191-209`）。拟议每 5 秒 tick 的全局 2,000 条目预算，将调度限制在约每秒 400 个条目；N 或 E 增大时，重访延迟会增加。应发布该采样年龄，并在发布前对冷热元数据缓存做基准测试。

跨平台实现要求（属于提案，不是已经测试的平台保证）：

- **Windows：**通过集中路径 API 保留长路径和 UNC 处理；测试排除 junction / 重解析点、锁定文件、拒绝访问的子树及杀毒软件导致的元数据延迟。跳过不可访问条目后，不能将遍历报告为完整。
- **macOS：**区分逻辑长度与 APFS 稀疏 / 压缩 / 克隆分配；日志可能位于另一根目录（`src/main/core/paths/constants.ts:101-111`）。测试不区分大小写的包含关系和被重命名的目录。
- **Linux：**测试符号链接、挂载变化和权限错误。不要假定文件系统 `bavail` 等于全部可回收容量；当前卷统计计算 `bsize*bavail` 和 `bsize*blocks`（`src/main/services/StorageMonitorService.ts:58-60`）。
- **三个平台均需：**跳过链接 / 特殊文件，将消失的条目视为陈旧采样，并限制排队工作量。需测试遍历替换竞态和硬链接；硬链接文件可能被保守地重复统计。目录策略不覆盖清单中其他根目录、外部路径或已脱离管理的工具的写入。

### Verification plan

**本次仅文档提案：**验收要求限定范围的配对生成 / 检查及 `npm_config_verify_deps_before_run=false pnpm docs:check` 通过，并由维护者评审证据、范围和策略选择。未授权产品测试、依赖重建或运行时变更。根据 [Agent Note 规则](../../README.md)，此三件套在实现完成前应位于 `proposed/architecture/`；开始实现需要当前 Spec 头提交获得 Approval。参考文档的前置元数据、结构和索引发现适用于 `docs/dev/references/`，不适用于此提案（`scripts/docsGovernance/verify-doc-frontmatter.ts:55-58`、`scripts/docsGovernance/verify-doc-structure.ts:62-63`、`scripts/docsGovernance/gen-doc-index.ts:59-60,82-92`）。链接检查递归扫描 `docs/` 和 `.agents/`（`scripts/docsGovernance/check-doc-links.ts:86-92`）。不要为此说明运行 `docs:index` 或编辑生成的 `docs/dev/README.md` / `docs/dev/sources-index.json`。

后续实现应使用带明确文件路径的命令。Vitest 主进程项目名为 `main`，包含 `src/main` 测试（`vitest.config.ts:37-57`）。现有入口包括下列存储监控、工作区存储、生命周期、运行时宿主和孤立数据清理测试（均存在；锚点为文件首行）。

```sh
# P0: extend existing capacity tests; add a usage-service test in its implementation PR.
npm_config_verify_deps_before_run=false pnpm exec vitest run --project main src/main/services/__tests__/StorageMonitorService.test.ts
# P2: existing runtime-host contract and storage recovery coverage.
npm_config_verify_deps_before_run=false pnpm exec vitest run --project main src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts
# P3: existing lifecycle and reclamation consumers.
npm_config_verify_deps_before_run=false pnpm exec vitest run --project main src/main/ai/agents/__tests__/AgentLifecycleService.workspace.test.ts src/main/services/trash/__tests__/agentOrphanSweep.test.ts src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts
```

测试入口证据：`src/main/services/__tests__/StorageMonitorService.test.ts:1`、`src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts:1`、`src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts:1`、`src/main/ai/agents/__tests__/AgentLifecycleService.workspace.test.ts:1`、`src/main/services/trash/__tests__/agentOrphanSweep.test.ts:1`、`src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts:1`。这些是后续验证命令，**不是本 PR 已运行的测试**。新测试存在后应添加其明确路径；不要省略过滤条件来运行整个项目。

| 阶段 | 必需契约用例（每项均捕捉特定回归）                                                                                                                                                                                                                 | 发布证据                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| P0   | 伪造嵌套目录树合计已知普通文件大小；空树=0；不跟随指向外部的符号链接 / junction 和特殊文件；替换竞态不能逃出根目录；权限失败产生部分 / 错误状态；tick 不重叠；预算公平让出；慢系统调用不启动新遍历；重连收到最新采样并拒绝旧序列                   | 已知大小一致；每个 tick 的条目 / 截止时间监测保持在调度预算内；UI 区分新鲜 / 部分 / 陈旧状态；覆盖可用空间阈值边界与活跃轮询。 |
| P1   | 低于 / 等于 / 高于阈值；每次跨越警告一次；重复 / 部分采样不刷屏或错误清除；设置变化与禁用警告；跨越后任务继续                                                                                                                                      | 用户看到带工作区归因的警告，运行轮次继续；不自动取消。                                                                         |
| P2   | 每个超限轮次仅发起一次取消；通过真实中止处理到达停止状态；排队 / 定时运行不能将其重启；超预算工作区不被静默复用；锁存在重启 / 迁移后保留；锁存写入失败 / 扫描未知不能授权运行；清理加显式重查解除阻断；提高 / 禁用上限需显式操作；取消失败保持可见 | 断言终止 / 准入结果，不能只断言 mock 调用。用户保留部分文件并看到确切原因；重启后不隐式重试。                                  |
| P3   | 年龄 / 大小仅选择空闲最久且合格的会话；排除活跃 / 排队 / 分叉 / 恢复工作；锁内重查资格；保留回收站 0 值和正数宽限期；归档 / 恢复往返保留字节；中断的归档 / 永久清除可恢复；孤立数据新近修改保护有效；Windows 锁定文件重试保留所有权                | 测得的回收字节区分回收站 / 归档和最终清除；不删除用户工作区或有归属的活跃状态；恢复与还原保持无损。                            |

后续涉及数据库的用例使用仓库 `setupTestDatabase()` 测试工具，工作区存储测试已在使用（`src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts:6,27-28`）。使用统一的 application / 服务 mock，不手写模式或 Drizzle 链桩；同一测试导入共享 mock 工厂（`src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts:17-24`）。

后续实现的 Windows/macOS/Linux 手工端到端场景：使用可丢弃的系统工作区和安全测试阈值（例如警告 16 MiB、硬上限 32 MiB）。通过智能体任务增量生成大型合成文件，不接近真实磁盘耗尽。观察统计及软警告时任务继续，再观察硬取消、稳定的 Stop 状态、保留的部分产物及受阻的下次运行。重启并验证阻断持续存在。显式清理 / 重查或提高上限后继续。完成会话，主动启用保留策略，推进测试时钟，观察回收站 / 归档与无损恢复，再显式永久清除并回收字节。记录超限幅度、检测 / 拆卸延迟、CPU、元数据操作数及可用空间；验证用户工作区对照目录未被触碰。

## Alternatives considered

由于 CLI 拥有具体写入操作，可移植的 Cherry 策略只能通过观察用量并停止准入 / 执行，**在目录层面**执行限制。工具包装器无法拦截每次写入（`src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts:197-209`）。拟议“硬上限”是取消阈值，不是文件系统配额：增长可能与测量竞态、在拆卸期间继续，或发生在 cwd 之外。不控制全部写入方或采用操作系统配额，就不存在有限超限幅度的保证。

| 选项                     | 保护范围                           | 破坏的行为 / 未覆盖风险                                    | 执行位置                                                                                                                                              | Windows / macOS / Linux 可移植性                                       | 成本                                       |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| A. 仅提前警告            | 给整卷压力留出更多反应时间         | 没有可归因的会话控制；无人值守 / 快速写入仍可填满磁盘      | `StorageMonitorService` 阈值 / 频率（`src/main/services/StorageMonitorService.ts:17-29,58-61`）                                                       | 所有支持平台均有现有 `statfs` 路径；需验证目标卷语义                   | 低：容量查询，无递归遍历                   |
| B. 达到目录阈值即取消    | 检测后限制继续增长；阻止自动复用   | 中断合法大任务；保留部分产物；取消可能延迟                 | 工作区采样器 → 现有 `abortAndDrain`（`src/main/ai/streamManager/AiStreamManager.ts:1383-1417`）                                                       | 三个平台采用相同应用层策略；不假定存在可移植的文件系统配额             | 中 / 高：元数据遍历、准入检查、拆卸竞态    |
| C. 软阈值警告并继续      | 大型合法工作可见，用户可选择       | 不防止磁盘耗尽；警告疲劳                                   | 采样器 → 拟议工作区 IPC 事件                                                                                                                          | 与 B 相同的三平台遍历注意事项；不依赖取消                              | 中：遍历和去重警告 UI                      |
| D. 已完成会话保留 / 压缩 | 累积的非活跃工作区存储             | 未明确同意就启用可能移除有价值的输出；无法停止运行中的写入 | 现有归档 / 永久清除所有者（`src/main/ai/agents/AgentLifecycleService.ts:496-515`）                                                                    | 三个平台均适用；Windows 打开文件的锁需要重试，归档需要可用空间余量     | 高：遍历、压缩读写、恢复 / 还原验证        |
| E. 移出系统卷            | 存在其他卷时将压力与操作系统卷隔离 | 目标卷可填满 / 断开；迁移临时复制数据；不是字节上限        | 集中路径注册表加迁移流程（`src/main/core/paths/pathRegistry.ts:263`、`src/main/ai/agentSession/relocateSystemWorkspaces.ts:176-208,235-266,328-382`） | Windows 的盘符 / UNC 路径；macOS/Linux 的挂载点；需测试跨卷复制 / 恢复 | 高：位置 UI、迁移、运行时历史 / 检查点协调 |

建议先实施 A+C，取得测量证据后可选启用 B，D 仅在保留策略获批后实施。E 保持为独立的位置控制项目；只改一个根目录而不迁移历史 / 存储是不够的（`src/main/ai/agentSession/relocateSystemWorkspaces.ts:277-320,328-382`）。

## Acceptance criteria

- AC1 — 已知普通文件目录树产生正确的逻辑字节总量；遍历被跳过、无法访问、发生变化或尚未完成时，明确显示部分 / 陈旧 / 错误状态，而非零或精确完整总量。 (verification: unit)
- AC2 — 采样同时仅有一个遍历，每 5 秒 tick 公平共享全局 2,000 条目或 100 ms 的调度预算，限制游标 / 排队工作量，并保留慢系统调用的槽位而不启动替代遍历。 (verification: unit)
- AC3 — 会话详情显示带归因的逐工作区字节数、采样年龄及完整 / 部分 / 陈旧 / 错误状态；重连取得最新快照，迟到的序列不能将其覆盖。 (verification: renderer)
- AC4 — 每次跨越软阈值只显示一次工作区警告，轮次继续；重复或不完整且较小的采样既不重复警告也不清除警告，仅完整的低于阈值采样才能重新布防。 (verification: renderer)
- AC5 — 已启用硬上限发生超限时，通过现有 abortAndDrain 路径对每个超限轮次恰好发起一次取消，到达稳定停止状态或可见的待完成 / 失败状态，并保留部分产物。 (verification: Electron)
- AC6 — 已持久化超限状态在重启和迁移后仍存在，阻止排队 / 定时 / 后台 / 复用会话的准入和静默重试，仅在显式清理 / 重查、修改上限或选择新工作区后解除；预检用量未知不能授权准入。 (verification: Electron)
- AC7 — 保留策略在生命周期锁下仅选择合格、空闲且已完成的系统工作区，排除活跃 / 排队 / 分叉 / 恢复 / 所有权未知的工作，每分钟最多处理一个会话，保持无损恢复，最终清除仍由 data.trash.retention_days 决定，包括值为 0 的情况。 (verification: unit)
- AC8 — 智能体轮次运行期间，整卷健康状态在可用空间低于 5 GiB 时警告，每 30 秒轮询容量，保留独立的 1 GiB 严重诊断，并独立于工作区警告保持可见。 (verification: Electron)

## Risks

对庞大目录树采样可能比检查单个大文件成本更高；全局预算以更陈旧的采样换取速度。稀疏 / 压缩 / 克隆文件和硬链接可能在逻辑字节数超过已分配空间时造成误报。应如实标注指标；未经文件系统专属验证，不承诺物理字节准确性。取消可能中断合法工作并留下部分产物；脱离管理的写入方或缓慢拆卸可能继续增长。保留策略的压缩本身需要磁盘余量。对于合法大工作区，在考虑删除之前，用户需要可见的退出 / 提高上限选项和检查 / 导出路径。

回滚提案：以中性默认值禁用硬策略 / 保留策略（`max_bytes=0`、`retention_days=0`、`retention_max_bytes=0`）；软警告可用 `warn_bytes=0` 禁用。若 P0 采样器接线 / 卷阈值变更导致性能回归，可分别回退。为向前兼容保留超限记录和恢复日志；绝不能仅为回滚策略而删除产物。已经完成的保留策略永久清除无法通过修改偏好设置撤销，因此预览 / 同意及恢复检查是发布要求。

非目标：修改 CLI 内部实现或确定已删除事件文件的来源；将 token / 输入 / 读取限制换算为磁盘配额；在本提案中修改数据库模式；自动删除用户工作区；在保留决策前启用已完成会话删除；声称用一个工作区阈值约束全部智能体关联根目录；在这些阶段实现独立卷迁移。

### Open decisions for maintainers

1. 默认仅发布警告，还是取得 P0 数据后默认启用硬阈值？请确认拟议 1 GiB 警告和需主动启用的 10 GiB 上限。
2. 限制仅覆盖系统工作区，还是纳入明确登记的用户工作区，并单独约定所有权 / 清理契约？
3. 超限后按提案取消并关闭轮次，还是要求另行设计可恢复的暂停契约？
4. 如需默认保留年龄 / 总预算，什么值可用于自动将已完成会话移入回收站，同时遵守现有最终清除宽限期？
5. 接受逻辑字节统计和采样超限幅度，还是在声称防止磁盘耗尽前要求已分配字节测量 / 操作系统隔离？
6. 独立工作区卷设置是否值得另设迁移项目，包含运行时历史、归档 / 恢复及卷断开后的恢复？
