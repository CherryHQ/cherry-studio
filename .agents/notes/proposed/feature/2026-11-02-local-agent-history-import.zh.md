# Agent Note: 本地智能体会话历史导入

Status: proposed

[English](2026-11-02-local-agent-history-import.md) | 中文

## 问题

用户在 Cherry Studio 之外使用 Claude Code、Codex、OpenCode 和 WorkBuddy，积累了会话历史。用户需要查看这些历史，并在原工作目录中继续任务。

[Issue #22728](https://github.com/CherryHQ/cherry-studio/issues/22728) 描述了这一来源导入能力。用户选择已有智能体作为导入目标。每段原会话保存为独立的智能体会话，工作目录也按会话绑定。预览和目录映射与 [#19002](https://github.com/CherryHQ/cherry-studio/issues/19002) 存在交集；本方案不恢复外部工具的权限、待执行动作或文件快照。

## 提案

### 导入目标与入口

入口为**设置 → 导入外部应用数据 → 导入本地应用数据 → 来源应用**。在现有外部数据导入页面内增加本地应用分组。每个来源打开共用导入向导。来源实现完成后才显示可用入口；现有网页导出数据的导入入口保持原用途。

| 来源 | 目标智能体 | 导入目标 |
|---|---|---|
| Claude Code | 用户选择的已有智能体 | 每个选中的原会话创建一个智能体会话 |
| Codex | 用户选择的已有智能体 | 每个选中的原会话创建一个智能体会话 |
| OpenCode | 用户选择的已有智能体 | 每个选中的原会话创建一个智能体会话 |
| WorkBuddy | 用户选择的已有智能体 | 每个选中的原会话创建一个智能体会话 |

每批导入都要求用户选择一个已有智能体。选中的原会话分别创建独立会话，统一归入该智能体。不同来源可以选择同一个目标智能体。使用智能体的稳定 ID，不按名称或来源名称匹配。导入器不创建智能体，不修改其名称、指令、模型、权限或其他配置。

首版只允许选择正常使用的 Pi 智能体。其他智能体仍显示，但不支持的运行时不可选，并说明原因。不修改智能体运行时。没有合适目标时，引导用户正常创建或配置。回收站中的目标需先恢复或改选。更换目标后重新预览；目标删除后停止剩余导入，不新建智能体。

### 工作目录绑定

工作目录按智能体会话选择，与目标智能体独立。目标智能体的默认目录不能覆盖来源记录的目录，也不能覆盖“不使用工作目录”的规则。

| 来源状态 | 导入行为 |
|---|---|
| 记录了本机可用目录 | 预览后注册或复用用户工作目录，并绑定会话 |
| 没有记录目录 | 显示“不使用工作目录”，复用现有系统工作目录机制 |
| 目录不存在或不可访问 | 显示原路径，要求选择替代目录或跳过会话 |
| 路径属于其他平台 | 导入前映射为有效的本机目录 |
| 记录了多个或变化的目录 | 识别来源主目录；无法确定时在预览中选择 |

不能把失效路径静默当成没有目录。不能根据会话文件的存储目录推断任务工作目录。适配器读取已验证的 `cwd`、`directory` 或对应字段。相同规范化路径复用用户工作目录。绑定不复制项目，也不写入来源目录。

[工作目录契约](../../../../src/shared/data/api/schemas/agentWorkspaces.ts) 使用 `{ type: 'system' }` 表示“不使用工作目录”。会话仍关联工作目录记录，运行时可创建 Cherry 管理的内部目录。不新增空路径或第三种工作目录类型。

[会话契约](../../../../src/shared/data/api/schemas/agentSessions.ts) 禁止带消息会话更换工作目录。必须在消息写入前完成映射，确认时重新检查，执行前仍走现有运行时校验。路径失效时，该会话返回预览。

### 存储归属与顺序

使用 `agent`、`agent_session`、`agent_session_message` 和 `agent_workspace`。导入会话对应 type 为 `conversation` 的 `AgentSession`，不创建助手话题。智能体消息是平面序列，不创建普通聊天的虚拟根节点，也不使用 `parentId` / `activeNodeId` 作为持久化字段。

| 现有服务 | 复用或扩展方式 |
|---|---|
| [AgentService](../../../../src/main/data/services/AgentService.ts) | 读取并校验选中的已有智能体及其运行时，不调用 `createAgentTx`，不更新智能体配置 |
| [AgentSessionService](../../../../src/main/data/services/AgentSessionService.ts) | 通过 `createTx` 处理归属、历史创建时间和目录绑定，补充导入元数据与活动时间 |
| [AgentWorkspaceService](../../../../src/main/data/services/AgentWorkspaceService.ts) | 复用 `findOrCreateByPathTx` 和 `createSystemWorkspaceForSessionTx` |
| [AgentSessionMessageService](../../../../src/main/data/services/AgentSessionMessageService.ts) | 增加用于历史时间、来源身份和顺序的专用批量导入契约 |

首版保留现有 `createdAt, id` 分页排序。新增历史写入方法，保留非递减来源时间；相同时间的本地主键严格递增。来源顺序与时间冲突时在预览中拒绝，提交前再次检查。不能改写有效时间，也不能只在渲染进程补排序。

有效来源时间可能晚于本机时间，例如快一天。首版在预览中拒绝受影响会话，并在写入任何会话数据前复查。末条时间恰好等于当前毫秒时，在事务外等待下一毫秒后重新检查。保留原时间。独立消息顺序后续设计。

复用智能体会话列表、搜索、生命周期和数据变化通知。各数据服务管理自身表，导入器不能绕过这些约束。

### 只读预览与命令边界

每个来源使用一个适配器，由主进程统一编排导入：

```ts
type Source = 'claude-code' | 'codex' | 'opencode' | 'workbuddy'

interface HistorySourceAdapter {
  source: Source
  discover(root: string, signal: AbortSignal): AsyncIterable<SessionRef>
  read(ref: SessionRef, signal: AbortSignal): Promise<NormalizedSession>
}

interface NormalizedSession {
  source: Source
  originalSessionId: string
  sourcePaths: string[]
  sourceVersion?: string
  title: string
  workingDirectory?: string
  messages: NormalizedMessage[]
  selectedBranchId?: string
  sourceFingerprint: string
  diagnostics: ImportDiagnostic[]
}
```

上述 schema 是拟定的内部契约。归一化消息包含来源 ID、来源顺序、可用父链、角色、内容、模型和原时间。诊断包含文件与行号或数据库记录、问题代码和原因。

使用类型化 IpcApi 命令 `discover`、`preview`、`commit`、`cancel` 和 `retryInitialization`。扫描结果携带主进程生成的引用。预览绑定可用的 Pi 目标、选中分支和目录选择。提交只接受预览 ID 和选中会话。主进程校验窗口归属、有效期和绑定目标；拒绝替换目标 ID 或界面拼出的数据库记录。初始化重试使用已保存会话 ID。

预览显示目标智能体、标题、解析后的消息数、原模型、时间范围、来源路径、原目录与最终目录、重复状态、跳过项、降级项和阻塞原因。JSONL 行数不等于消息数。已知元数据与丢弃的对话内容分开统计。

在主进程内存保留不可变快照，包含目标及运行时、消息、诊断、适配器版本、目录选择、全部来源依赖和指纹，包括 Codex 继承历史。预览有效期为 15 分钟。流式读取 JSONL，上限为单行 4 MiB、单会话 32 MiB、每批 100 个会话且不超过 128 MiB。输入和归一化结果分别检查体积。超限时在确认前拒绝，不截断。首层通过边界和内存夹具后才启用入口。

扫描和预览不创建智能体、工作目录记录、会话、消息或持久预览文件，也不修改来源存储。过期、取消和关闭窗口时释放内存。确认时重新校验目标智能体的可用状态与运行时兼容性、来源指纹、目录状态和预览版本。目标或运行时变化、其他输入失效时重新预览；只写入已确认的快照。

按会话返回已导入、已存在、失败或未处理。消息、跳过记录和降级内容块分别计数。

### 来源读取器

| 来源 | 存储与解析规则 | 兼容边界 |
|---|---|---|
| Claude Code | 读取 `CLAUDE_CONFIG_DIR` 或 `~/.claude/projects/` 下的会话 JSONL，解析已验证的正文、UUID、父链、时间和 cwd | 先评估现有 SDK 会话读取能力；缺少时间或行诊断时，使用带版本识别的原始读取器 |
| Codex | 从 `session_index.jsonl` 获取标题，在 `CODEX_HOME` 或 `~/.codex` 的 `sessions`、`archived_sessions` 中发现支持的历史 | 索引不是完整清单；区分消息和事件，只支持已验证的历史布局 |
| OpenCode | 只读打开选定的 `opencode.db`，在一致读事务中读取会话、消息、内容块和 directory | 探测结构与版本，包含 WAL 中已提交数据；禁止迁移、checkpoint、修改 journal 模式或创建来源侧文件 |
| WorkBuddy | 根据受支持版本的脱敏样本确定桌面存储、会话字段和工作目录字段 | CodeBuddy CLI 文档不能证明 WorkBuddy 桌面端兼容性 |

Claude Code 提供[会话存储说明](https://code.claude.com/docs/en/agent-sdk/sessions)和 [SDK 会话读取接口](https://code.claude.com/docs/en/agent-sdk/typescript#getsessionmessages)。每条原始记录都归类为消息、元数据、已知非消息事件，或有明确诊断的不支持与损坏记录。

Codex 的[名称索引](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/session_index.rs)是追加式，同 ID 取最后一条有效记录。索引缺失不能隐藏受支持会话。优先从 `response_item` 读取正文，从 `turn_context` 读取模型。使用 `event_msg` 获取诊断和状态，或按明确支持的旧格式补齐，避免重复正文。使用有效 ordinal 或源文件顺序，不能只按时间排序。参见[持久记录类型](https://github.com/openai/codex/blob/main/codex-rs/history/src/rollout_payload.rs)。

使用索引或会话元数据中的线程 `id`，不能使用分支可能共享的根 `session_id`。压缩、继承和多 rollout 历史只按已验证的版本规则恢复；否则阻止该会话并指出缺口。不能拼接所有同 ID 文件。参见[会话身份](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)与 [rollout 持久化](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs)。

OpenCode [存储说明](https://dev.opencode.ai/docs/troubleshooting/#storage)允许自定义数据库位置。其[开发版结构](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts)包含 `session_v2`、`session_message`、`session_part`，消息使用 `seq`，内容块使用 `ordinal`。不能认为这些表名覆盖所有发布版本。拒绝未知结构。若无法无副作用读取，要求关闭来源应用或使用一致的离线副本；只复制正在使用的数据库文件并不够。

腾讯的[目录文档](https://cloud.tencent.cn/document/product/1831/137016)描述的是 CodeBuddy Code。WorkBuddy 需单独验证会话发现、消息、时间、目录、外部工具输出和子代理。确认格式后才能启用来源入口。

所有适配器允许手动选择存储目录。在[路径注册表](../../../../src/main/core/paths/pathRegistry.ts)的 `external.*` 下注册默认位置，保持不自动建目录的行为。不扫描整个用户目录，不读取账号密钥。存储路径和工作目录是不同输入。

### 消息转换与续聊

| 来源内容 | 导入表示 |
|---|---|
| 用户与助手文字 | 按对应角色保留正文、原消息边界和时间 |
| 可用推理文本 | 使用现有 reasoning 内容块，报告界面与运行时的兼容限制 |
| 工具调用与结果 | 首版保存带标签的历史文本，包含名称、参数、输出和错误 |
| 系统指令与压缩记录 | 保存历史说明或兼容性结果，不能替换当前智能体指令 |
| 文件与图片引用 | 保存历史引用文本，标出缺失、不支持和未复制项，不自动下载 |
| 未知类型或坏 JSON | 报告位置，继续解析可还原内容 |

历史工具仍以静态文本保存。读取时将受支持的工具调用和结果标记转成已完成的展示项，放入现有“已处理”折叠区，旧导入记录也适用。有调用 ID 时关联工具结果，不能误当成用户发言。无法关联的结果保留为有标签的历史说明。不导入待执行工具、审批或生成状态。明确完成、失败和中断的消息分别使用 `success`、`error` 和 `paused`。

将选定的来源分支转换为平面的智能体会话。有明确活动分支时使用它；否则在预览中选择。其他分支列为未导入项。能独立还原的子代理会话作为独立候选项，归入选中的目标智能体。不能串联互斥分支。

有效时间转为 UTC 毫秒，同时保留原始字符串。时间缺失或非法时，使用选中路径上一条有效时间；首条消息可使用有效会话开始时间。预览必须标注推定值；没有依据则阻止该会话。来源消息身份和推定标记保存在类型化消息来源字段中，不拼入正文。会话活动时间取历史活动时间，保留已有智能体自身的创建时间。

完整历史模型信息写入 `messageSnapshot.model`。没有匹配的本地模型时，`modelId` 留空；缺失信息显示为未记录。不创建虚假的模型或账号配置。历史引用保持为普通文本，遵守现有 Markdown 渲染规则。

第一层交付续聊，仅支持 Pi 目标；选择器禁用其他运行时。可见消息不能证明已有原生上下文。通过独立导入入口复用 [Pi 历史转换](../../../../src/main/ai/runtime/pi/retiredSessionHistory.ts)，不伪装成旧运行时迁移，不使用外部 resume token。保留导入历史尾部的用户消息，不能套用旧迁移的待投递消息过滤规则。

使用目标智能体当前的指令、模型选择规则和权限。没有可用模型时仍可导入历史，续聊前必须通过正常流程选择模型。确认后初始化 Cherry 自己的原生历史，不请求模型，也不执行历史工具。复用 `app_state` 保存内部可重试的初始化标记，与会话一起提交；业务来源身份仍保存在会话上。

原生文件发布与 SQLite 提交是两件事。使用稳定的目标原生会话 ID、经过验证的临时输出和持久关联。重试不能重复历史。初始化失败时保留可读历史，提供重试，并阻止无上下文请求。[运行时主入口](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts)必须在历史就绪后才接纳首个真实请求。验收检查实际模型输入，不能只看界面消息。权限使用当前 Cherry 配置。

### 身份与原子提交

导入目标是用户选择并绑定到预览的已有智能体 ID。不增加智能体来源标记、来源与智能体映射或来源智能体唯一约束。来源身份保存在导入会话上，不决定会话归属。

在 `agent_session` 中增加可空的 `importMetadata`：

```ts
interface AgentSessionImportMetadata {
  version: 1
  source: Source
  originalSessionId: string
  sourcePaths: string[]
  sourceVersion?: string
  originalWorkingDirectory?: string
  sourceFingerprint: string
  importedAt: string
  adapterVersion: number
  report: { skippedRecords: number; downgradedParts: number }
}
```

活动目录继续由 `workspaceId` 表示，原路径只作来源信息，不另建工作目录状态。为未归档会话的 `source + originalSessionId` 添加查询索引，与所选智能体无关。在同步写事务中检查身份，串行处理重复导入。查询索引不设唯一约束，使归档副本恢复后能与新导入副本并存。更换目标不会复制或移动已导入会话；结果需展示原会话及当前归属。既有无元数据会话不受影响。路径和内容哈希不作为身份。没有经过验证的稳定 ID 时拒绝导入。

| 情况 | 结果 |
|---|---|
| 重复导入已有会话，包括改选其他目标 | 返回原会话及归属，不复制、不移动 |
| 来源历史增加 | 提示已导入，不自动追加或覆盖 |
| 目标智能体在回收站 | 要求选择可用目标 |
| 已导入会话已归档 | 保留归档副本，向选中的智能体导入新会话；原副本仍可恢复 |
| 会话已永久删除 | 允许重新导入到选中的有效智能体 |
| 用户重命名智能体或移动会话 | 保留改动，重导入不移回 |
| 用户复制或派生会话 | 清除新会话的唯一导入身份 |
| 不同副本使用同一来源 ID | 提示冲突，不静默合并 |

每个来源会话使用一次同步 `DbService.withWriteTx`。每次事务重新校验目标智能体的可用状态与运行时兼容性，再一起创建必要的工作目录记录、绑定该 `agentId` 的会话、消息、来源信息和初始化标记。失败时回滚该会话的写入；保留已有智能体及其其他会话。各会话独立提交。混合批次跳过有阻塞问题的会话，保存可导入会话。保留成功结果，重试时只重新校验未成功的选择。取消或目标失效时不再启动后续会话，并报告已提交的结果。

文件读取、解析、目录校验和指纹计算在写事务外完成。事务内没有 `await`、文件写入或网络请求。组合各数据服务的 Tx 方法，提交后再发布事件。不能把大段会话拆成多个独立提交来规避事务上限。

为会话元数据、类型化消息来源和活动身份查询索引追加迁移，不增加智能体来源标记或导入记录表。覆盖已有数据、回收站、复制和现有完整及精简备份恢复。保留来源身份。缺少原生文件时，需从持久历史可靠重建后才能续聊；否则明确阻止。本次不新增会话级备份合并。

### 实现归属与堆叠

来源适配器、诊断、归一化和主进程预览编排放在 `src/main/services/conversationImport/`。跨进程命令放在 `src/shared/ipc/schemas/conversationImport.ts`，补齐 handler 和注册。编排服务使用现有生命周期容器。

扩展 [ImportMenuSettings](../../../../src/renderer/pages/settings/DataSettings/ImportMenuSettings.tsx)，增加本地应用分组，以及用于目标智能体选择、会话选择、目录映射、预览和结果的共用弹窗。使用 `@cherrystudio/ui`、i18next 和设置搜索。主进程不能导入渲染进程的网页导入器。

数据改动归属上文中的智能体会话、消息和工作目录服务；智能体服务负责目标校验。同步扩展会话 schema 和消息来源类型。原生历史初始化归属运行时主入口及所选运行时适配器。路径注册、迁移、备份兼容和提交后通知随所属改动交付。

本中英文方案是底层文档 PR。当前方案版本获得明确人工 Approval 后，通过 gh-stack 顺序实现四个来源：

```text
main
  <- codex/local-history-import/design
  <- codex/local-history-import/claude-code
  <- codex/local-history-import/codex
  <- codex/local-history-import/opencode
  <- codex/local-history-import/workbuddy
```

| 层 | 来源 | 完整功能范围 | 回归范围 |
|---|---|---|---|
| 1 | Claude Code | 共用界面与契约、目标智能体选择、目录规则、迁移、原子写入、受支持目标运行时的历史初始化和 Claude 读取器 | 完整导入与续聊，确认前零写入，无重复 |
| 2 | Codex | 索引与历史版本、事件去重、线程身份和 cwd | Codex 及受影响的 Claude 行为 |
| 3 | OpenCode | 结构探测、一致只读数据库读取、顺序和 directory | OpenCode 及受影响的前序来源 |
| 4 | WorkBuddy | 已验证的桌面格式、消息和目录映射 | WorkBuddy 与完整四来源契约 |

通用基础随第一层交付，不另加第五个实现层。开始某个来源代码前创建对应分支，验证并提交后再增加下一层。WorkBuddy 调查可以提前，代码实现仍在最后。若方案先合并，第一实现层改为基于 main。

每个实现 PR 以紧邻下层分支为目标，并将已验证的 AC ID 关联到本方案。共享底层改动回到其所属层，再向上 rebase 并运行受影响验证。方案实质变化需重新获得 Approval。使用 `gh stack view --json` 检查层级。累计证据覆盖全部 AC 前，文档保持 proposed；最后一层再转为 implemented。

## 考虑过的替代方案

| 替代方案 | 不采用的原因 |
|---|---|
| 创建助手和普通话题 | 不满足智能体归属和会话工作目录要求 |
| 按来源或每段历史自动创建智能体 | 用户选择已有目标，自动创建会绕过用户选择 |
| 合并来源全部历史到一个会话 | 会混合任务和目录，保留独立来源会话 |
| 给全部导入会话套用目标智能体的默认目录 | 会覆盖来源目录和明确的“不使用工作目录”状态 |
| 按来源或显示名称选择智能体 | 名称可改且不唯一，使用用户明确选择的稳定 ID |
| 只保存可见消息 | 无法保证续聊时运行时拥有历史上下文 |
| 各来源分别实现预览和写入 | 重复身份、时间和事务逻辑 |
| 所有读取器放在一个实现 PR | 无法逐来源顺序实施和审查 |
| 重导入时自动追加或覆盖 | 需要协调来源分支与 Cherry 后续消息，增量同步后续设计 |

## 验收标准

- AC1 — 设置入口在“导入外部应用数据 → 导入本地应用数据”下，只启用已完成的来源。（验证：renderer navigation and settings search）
- AC2 — 导入要求用户明确选择已有智能体，本批新导入会话统一归属该智能体，不新建智能体或修改其配置。（验证：unit database fixtures and renderer selection/empty-state cases）
- AC3 — 每个原会话保存为独立智能体会话，不创建普通话题，不混合历史。（验证：unit multi-session fixtures）
- AC4 — 正确绑定已记录的工作目录，相同规范化路径复用用户工作目录。（验证：unit workspace and session relations）
- AC5 — 缺少工作目录时显示“不使用工作目录”，复用现有系统工作目录语义。（验证：unit and renderer）
- AC6 — 目录缺失、不可访问或属于其他平台时，预览要求映射或跳过，不能静默降级。（验证：unit and Electron directory fixtures）
- AC7 — 存在匹配的未归档会话时，重复或并发导入不新增副本，改选其他目标也一样。归档副本不阻止新导入。选择使用智能体 ID，名称相同也不混淆；已有活动会话保留归属。（验证：unit concurrency, cross-target, rename, and namesake fixtures）
- AC8 — 空输入、取消预览、全部重复和事务失败时，不遗留空会话或工作目录，不新建或改写智能体配置。（验证：unit state and source-directory comparisons）
- AC9 — 导入正文、有效原时间及受支持的来源顺序，在存储、分页和重新加载中保持一致。来源时间比本机快一天时，要么保留时间并将后续用户、助手消息排在全部历史之后，要么在预览中拒绝，并在写入任何会话数据前再次检查。（验证：unit clock-skew/ordering fixtures with controlled time and renderer paging/reload）
- AC10 — 坏 JSON 和未知记录有可定位的原因，其余可还原消息仍可导入。（验证：unit mixed-record fixtures）
- AC11 — 失败会话完整回滚，同批有效会话仍保存。重试未成功选择时不复制成功项。取消时保留已提交会话，且不启动后续会话。（验证：unit fault injection and cancellation）
- AC12 — 来源或目录变化、目标更换或被删除、运行时变为不兼容、预览过期时，重新选择或预览；拒绝其他窗口的令牌和替换的目标 ID。（验证：unit and renderer boundary checks）
- AC13 — Codex 索引和事件不产生重复正文，共享根会话 ID 不会合并不同线程。（验证：unit missing-index and fork fixtures）
- AC14 — OpenCode 正确读取支持结构及 WAL 已提交数据，并明确拒绝未知结构。（验证：unit real SQLite fixtures）
- AC15 — WorkBuddy 仅支持已声明版本样本验证过的桌面格式和目录字段。（验证：unit versioned adapter fixtures）
- AC16 — 历史工具调用和结果作为已完成工具项折叠到“已处理”，旧导入记录也适用。打开、导入或展开历史不会执行历史工具、发起审批或自动生成。（验证：unit runtime boundaries and Electron）
- AC17 — 首次续聊使用目标智能体配置，模型输入中导入历史位于新用户消息之前，包含已接受的时钟偏差场景；导入前说明不支持的目标运行时，初始化失败可重试且不重复历史。（验证：unit captured model input with controlled time, target-runtime compatibility, and recovery faults）
- AC18 — 导入会话可搜索、复制、回收和恢复；副本不继承唯一导入身份。（验证：unit existing data-service integration）
- AC19 — 向前迁移和现有完整及精简备份往返保留来源、归属与工作目录；缺少原生历史时可靠重建或明确阻止续聊。不新增备份合并。（验证：unit populated-database migration and restore fixtures）
- AC20 — Windows、macOS 和 Linux 满足目录映射与只读来源访问要求，区分模拟和实机证据。（验证：unit platform cases and platform-native Electron）
- AC21 — 方案之后按 Claude Code、Codex、OpenCode、WorkBuddy 顺序形成四个 gh-stack 实现层，各层差异范围明确。（验证：docs gate and gh stack topology/diff inspection）

数据库用例使用 `setupTestDatabase()`，每层按明确路径运行受影响测试。平台模拟不能替代实机验证。这些标准是未来产品验收要求，不是本文档 PR 已完成的验证证据。

## 风险

| 风险或未定选择 | 处理要求 |
|---|---|
| 目标运行时兼容性 | 使用所选智能体的运行时，完成并验证历史初始化后才允许选择，不静默修改智能体配置 |
| 时间回拨或来源时钟超前 | 预览和提交前拒绝冲突输入；保留时间并验证续聊衔接 |
| 目录缺失 | 写消息前解决，因为现有带消息会话不能更换工作目录 |
| 原生文件与数据库一致性 | 使用持久初始化标记、稳定原生身份、验证后的输出和重试恢复 |
| WorkBuddy 与上游变化 | 获取桌面样本并固定支持版本，开发版结构不代表所有发布版本 |
| 工具与附件保真 | 评审首版文本和引用降级范围，明确列出未迁移产物 |
| 大输入 | 开放导入前通过夹具确定单行、会话和批次上限 |
| 备份恢复 | 现有完整及精简备份保留来源身份；不新增合并能力 |
| 与 #19002 的交集 | 在合适位置复用预览和目录映射能力，保持四来源实现顺序 |

首版固定为 Pi 目标、拒绝时间冲突、工具历史文本、附件引用和现有备份恢复。重导入跳过未归档匹配项；归档副本保持原样，并允许导入新会话。增量同步另行设计。各来源启用前补齐声明版本清单和边界夹具。WorkBuddy 桌面样本是第四层前置条件。缺少样本时前序层可独立交付，但 WorkBuddy 不启用，#22728 保持未完成。