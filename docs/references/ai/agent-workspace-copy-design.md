---
description: Proposed CoW project copies using vscode fs-copyfile, covering service boundaries, ownership, paths, publication, cancellation, recovery, and validation
sources:
  - src/main/ai/agentSession/fork
  - src/main/ai/agents/AgentLifecycleService.ts
  - src/main/ai/runtime/agentSessionWorkspace.ts
  - src/main/data/services/AgentWorkspaceService.ts
  - src/main/data/services/AgentSessionForkService.ts
  - src/main/data/db/schemas/agentWorkspace.ts
  - src/main/core/paths
  - src/shared/ipc/schemas/ai.ts
  - src/shared/data/api/schemas/agentWorkspaces.ts
  - scripts/packaging/before-pack.js
---

# Agent Workspace Copy Design

状态：待实现的技术设计。本文采用 `@vscode/fs-copyfile@3.0.0`，为 Cherry Studio 增加可直接作为 Agent cwd 的独立项目目录。优先使用文件系统 CoW，不支持时按明确策略退回普通复制。本文不改变当前代码行为。

核心决策：**工作区负责引用，副本记录负责目录所有权，复制服务负责文件生命周期，现有 fork 协调器负责会话和运行时历史。** 副本成功发布后独立存在，删除源项目、源会话或最后一个引用均不自动删除副本文件。

## 1 交付范围与行为

第一阶段实现完整的创建、查询、取消、会话 fork 接入、显式删除、重启恢复和打包验证。支持两种入口：从已有项目创建独立副本；在 fork 会话时选择使用独立副本。两者共用同一套文件复制和所有权协议。

| 场景 | 目标行为 |
| --- | --- |
| 用户工作区的现有会话 fork | 未传新选项时继续共用原目录，保证兼容；选择 `copy` 才创建副本 |
| 系统工作区的现有会话 fork | 保持现有按会话创建系统目录的行为及严格校验；可以复用底层复制函数，不迁移所有权模型 |
| 单独复制项目 | 创建可复用的工作区，成功后可给一个或多个会话使用 |
| 副本再复制 | 创建新的独立目录；来源关系仅用于展示，不构成删除级联 |
| 从历史消息 fork | 对话历史取该消息边界，项目文件取本次复制期间的当前内容；不恢复历史文件 |
| 删除或归档会话 | 只移除或保留引用，副本目录继续保留 |
| 显式删除副本文件 | 无任何引用且没有运行中的操作时才允许；完成后保留操作结果以支持重试 |

本阶段不实现自动回写源目录、三方合并、Git 分支管理、跨设备同步、OS 快照、自动 TTL 回收或操作恢复后续传。复制出的目录可运行命令，但 **cwd 和 CoW 都不是安全沙箱**；Agent 的文件与命令权限仍由现有权限系统负责。

## 2 现有代码与接入点

当前 [Agent Session Fork](./agent-session-fork.md) 已有运行时原生历史 fork、文件资源清单、失败回收和同步数据库发布事务。用户项目当前共用目录；只有系统工作区调用 `copyForkWorkspace()`。

| 现有位置 | 所承担的职责 | 本方案的变化 |
| --- | --- | --- |
| `AgentSessionRuntimeService` | fork 准入、取消、关闭时 drain | 将副本准备纳入同一个 fork 的生命周期 |
| `AgentSessionForkOperations` | 工作区准备、driver fork、SDK 产物发布、数据库提交 | 增加用户工作区 `copy` 分支；只记录 `copyId`，不负责删除副本目录 |
| `agentSession/fork/files.ts` | 系统目录复制和 SDK 文件发布 | 抽取可复用的单文件复制；保留原有 SDK 发布语义与系统目录内容校验 |
| `AgentSessionForkService.commitTx()` | 验证源消息和工作区并原子创建子会话 | 接受已准备的目标工作区，在同一事务中发布副本和子会话 |
| `AgentWorkspaceService` | 工作区表、用户目录注册、引用判断 | 识别副本关联；禁止绕过状态门禁注册或使用未发布、删除中的目录 |
| `AgentLifecycleService` | 会话、Agent 和工作区删除的协调 | 区分移除工作区记录与删除副本文件；不把副本当成系统目录回收 |
| `agentSessionWorkspace.ts` | 启动 cwd 校验 | 副本必须处于 `ready` 且根身份匹配；目录丢失时不自动创建空目录 |

不能只替换 `copyFile()` 就算完成集成：数据发布、运行时 cwd、删除语义和恢复所有者必须一起接入。

## 3 原生库的使用契约

本节针对已检查的 npm 3.0.0 发布包。升级时重新审核 `lib/native.js`、`lib/cp.js`、`src/copyfile.cc`、`src/copyfile_win.cc` 和打包产物，不推断未来版本行为。[发布包](https://registry.npmjs.org/@vscode/fs-copyfile/-/fs-copyfile-3.0.0.tgz)

| 平台 | `COPYFILE_FICLONE_FORCE` 路径 | 方案中的处理 |
| --- | --- | --- |
| macOS | 原生绑定调用 `fclonefileat` | APFS 等支持条件由实际调用决定；不靠平台名称宣称可用 |
| Linux | 包转交 Node `copyFile`，由 libuv 请求 `FICLONE` | 文件系统和挂载配置决定支持情况；包的 `isCloneSupported()` 在 Linux 返回 false，不能据此禁用 |
| Windows | 原生绑定使用 `FSCTL_DUPLICATE_EXTENTS_TO_FILE`，检查块引用计数能力 | ReFS 支持仍受卷与文件条件限制；普通 NTFS 按策略退回普通复制 |

`FICLONE` 是文件系统能力请求，不是所有文件系统都实现的通用快速复制。Linux VFS 将克隆交给文件系统的 `remap_file_range`；不支持时由调用方处理失败。[Linux VFS](https://docs.kernel.org/filesystems/vfs.html)

Cherry 使用库的 `copyFile()`，不直接使用 `cp()` 作为业务引擎，理由是本功能需要全局并发限制、取消后 drain、逐项策略、所有权清理与可观测结果，而包的目录复制没有本方案所需的完整契约。第一版也不启用 macOS 整树快路径，以免两条路径的排除、链接和校验语义不一致。

单文件算法：

1. 目标路径位于本次操作独占且尚未发布的树中；不接受覆盖已有文件。
2. 调用 `copyFile(src, dst, COPYFILE_FICLONE_FORCE | COPYFILE_EXCL)`。
3. 成功记为 `cloned`。`require-clone` 模式下，失败直接上报。
4. `prefer-clone` 模式仅对明确的能力限制退回 Node `copyFile(src, dst, COPYFILE_EXCL)`；成功记为 `copied`，保留降级原因。
5. 任一阶段发现 `dst` 意外存在或身份不明，停止整个操作。不得为了重试先删除未知目标。

Node 文档定义 `EXCL` 和克隆标志，但不保证整个复制操作原子；因此目录对外发布必须由 Cherry 单独控制。[Node copyFile](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode)

不使用硬链接替代 CoW。目标必须有独立文件身份，任一侧后续写入不改变另一侧。普通复制可能仍被 OS 优化，统计只描述调用路径，不宣称精确节省了多少物理空间。

## 4 存储位置与路径管理

默认放在源项目之外、尽量同一文件系统的隐藏目录：

```text
/projects/demo/                         用户源项目
/projects/.cherry-workspaces/
  <sourceWorkspaceId>/
    <copyId>/                          本副本唯一资源根
      manifest.json                    目录身份与恢复凭据
      project.partial/                 未完成文件树
      project/                         发布前准备完成，发布后用作 cwd
      project.disposal/                已脱离使用路径、等待删除
```

`sourceWorkspaceId` 和 `copyId` 均为稳定 UUID；项目名称不参与路径。副本再复制沿用其已选择的存储父目录，不在副本的 `project/` 内嵌套新存储。默认候选为源目录父级；如果源目录位于 Git 仓库子目录，选择可识别的最外层包含仓库之外的父级，避免副本落入祖先仓库。发现该候选不可用时使用注册的应用数据根。

路径选择顺序：明确配置的存储父目录、上述同文件系统候选、`feature.agents.workspace_copies` 对应的应用数据目录。明确配置的目录不可写时直接报错，不悄悄改到另一处；默认候选不可用可以降级，但最终位置和降级原因必须进入记录与结果。`require-clone` 不因位置选择悄悄变成普通复制。

同盘符或同物理磁盘不等于支持 CoW；卷、挂载和单文件状态仍以实际克隆结果为准。拒绝文件系统根、源目录本身、源的后代，以及通过路径别名解析后落回源树的目标。所有存储候选，包括自定义位置，都应位于可识别的 Git 仓库之外，避免没有 `.git` 的副本意外沿用祖先仓库。第一版不提供源项目内 `.cherry/` 模式，避免递归复制和构建、Git、索引器扫描副本。

### 路径模块的前置扩展

现有 `getPath()` 的静态注册表在 preboot 构建，无法直接表达每个项目不同的存储父级。应先扩展 [路径模块](../../../src/main/core/paths/README.md)，不能由业务服务绕开它拼出一套应用目录。

建议增加一个严格限定的类型重载，保持现有调用兼容：

```ts
application.getPath('feature.agents.workspace_copies')

application.getPath('feature.agents.workspace_copy', {
  storageParent,
  sourceWorkspaceId,
  copyId,
  part: 'root' // root | manifest_file | staging | project | disposal
})
```

第二种调用由 `core/paths` 内专用解析函数处理，不往冻结的静态 map 动态写 key，也不引入通用路径模板系统。`storageParent` 来自主进程完成验证的路径选择，ID 必须是 UUID，`part` 是封闭枚举。解析无文件副作用，所有相关 key 加入 `NO_ENSURE`；目录只能由副本所有者显式创建。

记录创建时的完整 location；设置以后修改只影响新副本。删除旧副本必须用该记录的 location 和身份，不能按当前设置重新推算。应用数据 fallback 与动态路径重载都返回同一目录布局。

## 5 抽象与依赖方向

只新增一个拥有运行中任务的生命周期服务。不建立通用存储 provider、跨进程复制引擎、文件系统策略类层次或替代现有 DbService 的 repository 框架。

```mermaid
flowchart TD
  IPC[IpcApi commands] --> Copy[AgentWorkspaceCopyService]
  IPC --> Runtime[AgentSessionRuntimeService]
  Runtime --> Fork[AgentSessionForkOperations]
  Fork --> Copy
  Fork --> ForkData[AgentSessionForkService]
  ForkData --> Records[AgentWorkspaceCopyRecordService]
  Copy --> Records
  Copy --> Tree[copyWorkspaceTree]
  Tree --> File[copyWorkspaceFile]
  File --> Native[vscode fs-copyfile]
  File --> Node[Node fs fallback]
  Copy --> Paths[Application getPath]
  Records --> DB[DbService]
  Lifecycle[AgentLifecycleService] --> Copy
  Lifecycle --> Runtime
```

| 模块 | 形态与责任 | 不承担的责任 |
| --- | --- | --- |
| `AgentWorkspaceCopyService` | WhenReady 生命周期服务；任务 Map、取消控制器、全局限流、恢复、文件清理 | 不理解 SDK 历史，不直接修改会话消息 |
| `AgentWorkspaceCopyRecordService` | `data/services` 直接导入 singleton；表约束、事务状态转换、幂等请求、读模型 | 不遍历文件、不启动任务、不调用生命周期服务 |
| `copyWorkspaceTree()` | 请求级函数；遍历、排除、文件复制、校验、统计 | 不读数据库、不知会话、不决定最终删除权限 |
| `copyWorkspaceFile()` | 薄函数；原生加载、单文件克隆与明确降级 | 不隐藏权限和磁盘错误，不维护目录状态机 |
| `workspaceCopyOwnership.ts` | 领域内文件函数；清单、身份检查、受控改名与清理 | 不扫描任意磁盘，不把路径前缀当所有权证据 |
| 原有 fork 协调器 | 组合副本与 SDK 产物，在同一事务中发布会话 | 不重复维护另一套副本恢复状态 |

新代码建议放在 `src/main/ai/workspaceCopy/`。这些函数有文件写入副作用，且只服务此业务，留在领域目录；不放进全局 `utils`。类型和纯策略与消费者同目录，跨进程 DTO 才放 `src/shared`。不为本目录创建未经 lint 封闭的 barrel。

`AgentWorkspaceCopyService` 使用 `@Injectable`、`@ServicePhase(Phase.WhenReady)`、`BaseService` 和 service registry。Runtime 与 AgentLifecycle 在同阶段显式依赖它，确保先初始化、后停止。它不反向依赖 Runtime 或 AgentLifecycle，也不声明对 BeforeReady 的 DbService、PreferenceService 的冗余 `@DependsOn`。

`onInit()` 建立恢复门禁和待处理清单；只做有限的元数据协调，不阻塞启动去递归删除大目录。后台恢复 Promise 必须被服务追踪。`onStop()` 关闭准入、发出取消、等待运行任务；超时仍有原生 I/O 时保留日志，不能并行清理它正在写入的目录。

## 6 数据模型与 ownership

### 工作区与副本记录

保留 `agent_workspace.type = user | system` 的现有分组语义。新副本作为可选择、可共享的 `user` 工作区存在；**`user` 不再被任何新代码当成“用户拥有目录”的证明**。目录所有权通过关联副本表显式判断。

增加 `agent_workspace_copy` 表，而不把用户成果及删除凭据塞进 Cache 或可丢弃的 `app_state`。一个副本记录同时保存一次创建操作和成功后的资源身份，不另建一张通用任务表。

| 字段组 | 内容与约束 |
| --- | --- |
| 身份 | `id` 为 copyId；`requestId` 唯一；`requestDigest` 为规范化创建输入摘要；`revision` 用于条件状态转换 |
| 来源 | `sourceWorkspaceId` 可空 FK，源被删除时 `SET NULL`；`sourcePathAtCreation`、来源身份和父 copyId 的历史值仅用于溯源 |
| 消费者 | `consumer: standalone | session-fork`、`forkOperationId`、`intendedSessionId`；创建时固定 |
| 目标 | `reservedWorkspaceId` 为非 FK 的预留 UUID；`targetWorkspaceId` 可空、唯一、FK `SET NULL`，只在发布事务创建目标工作区行后赋值 |
| 位置 | 原始 `storageParent`、路径布局版本、资源根绝对路径和最终 cwd；之后不随设置修改 |
| 所有权 | 随机 `ownershipToken`、父目录及资源根文件系统身份、清单版本；身份不明不允许自动删除 |
| 创建状态 | `creating | prepared | ready | failed | cancelled | deleting | removed` |
| 清理状态 | `none | pending | blocked` 与 `cleanupReason`；与创建失败原因分开，避免覆盖原始错误 |
| 契约 | 复制策略版本及已解析选项、校验级别、排除项、创建统计、结构化失败原因 |
| 时间 | 创建、更新、准备完成、发布时间；遵循现有毫秒时间和 schema helper 规范 |

`prepared` 是内部状态，不作为可选工作区对外暴露。`ready` 表示创建事务已发布，不承诺目录永远存在；丢失、外部移动或身份改变作为可用性诊断展示并阻止启动，不能伪装成成功的空目录。

工作区实体增加只读 `storage` 投影：`external`、`system` 或 `managed-copy`，后者带 `copyId`。旧用户工作区回填为 external 的投影，旧系统目录仍按原逻辑处理。renderer 不得写入 `storage`。

约束包括 requestId 和非空 targetWorkspaceId 唯一索引、状态枚举 CHECK，以及来源、状态查询索引。存储 location 中保留原始路径分组 UUID，不因 sourceWorkspaceId 的 FK 被置空而丢失。`requestDigest` 对规范化后的业务输入计算；由服务选择的位置与策略快照在首次预留时冻结，重试不会因当前设置变化生成另一套结果。

### 唯一所有者

| 资源 | 唯一所有者 | 借用者 |
| --- | --- | --- |
| 用户源项目 | 用户 | 复制操作只读借用 |
| `project.partial` 和尚未发布的 `project` | 副本服务对应 copyId | fork 协调器持有准备租约 |
| 已发布的副本目录 | 副本记录所代表的用户成果，由副本服务管理文件生命周期 | 会话、计划任务、渠道、终端等持有引用或使用租约 |
| SDK fork 产物 | 原有 fork 资源协议 | 子会话 runtime |
| 会话与消息行 | 原有数据服务 | 副本服务不接管 |

创建时拥有目录，不意味着可以在引用归零时自动删除。发布前失败允许回滚；发布后只能通过明确的删除命令处理。源 FK、目标 FK 解除后副本记录仍保留，因而数据库清理不会丢失磁盘所有权信息。

`manifest.json` 只保存版本、copyId、ownershipToken、预定路径、已确认身份、阶段和必要校验摘要。它不存源文件内容或凭据，也不是另一套业务真相。SQLite 决定是否已发布及是否准许删除；清单和目录身份共同证明磁盘资源是否是原来那份。仅发现同名目录或一份清单，不能自动接管。

## 7 接口与类设计

以下是目标契约草图，具体 DTO 用 Zod 单点定义并推导类型；不会手写一套重复的 TS/Zod 类型。

```ts
type CopyMode = 'prefer-clone' | 'require-clone'
type CopyValidation = 'metadata' | 'content'

interface CreateWorkspaceCopyInput {
  requestId: string
  sourceWorkspaceId: string
  name?: string
  mode: CopyMode
  validation: CopyValidation
}

interface PreparedWorkspaceCopy {
  readonly copyId: string
  readonly reservedWorkspaceId: string
  readonly cwd: string
  readonly revision: number
}

interface CopyStatistics {
  files: number
  directories: number
  links: number
  logicalBytes: number
  clonedFiles: number
  copiedFiles: number
  excludedEntries: number
  fallbackReasons: Record<string, number>
}
```

源必须由工作区 ID 解析。客户端不能提交 copyId 对应的根目录、ownershipToken、任意目标路径或 prepared 句柄。存储位置读取已经验证的设置；新增位置通过独立的目录选择流程写设置。

| 内部方法 | 契约 |
| --- | --- |
| `startCreate(input)` | 同步完成准入及数据库预留后返回 copyId，服务持有后台 Promise；重试同 requestId 返回同结果 |
| `prepareForFork(input, forkContext, signal)` | 内部入口；创建或复用同一请求，等待到 prepared，返回只读准备句柄；服务继续持有租约直到协调器结束 |
| `finishForkPreparation(copyId)` | 协调器在 `finally` 中调用；读数据库判定已发布则保留，未发布则 drain 后清理；不能由调用方传 `success` 决定删除 |
| `cancel(copyId)` | 停止派发，发 abort，等待原生任务结束后回收；ready 时返回 `already-published`，不删除成果 |
| `remove(copyId, expectedRevision)` | 条件进入 deleting，检查完整引用，脱离 cwd 后删除；幂等；busy 时返回引用信息 |
| `recoverPending()` | 只处理本表记录的未完成操作；可重复执行；身份或存储状态不明则保留并标记 blocked |
| `pauseAdmission()` / `drain()` | 为关闭和备份提供持有式门禁与有界等待；不得只检查一次 Map 长度 |
| `copyWorkspaceTree(input, context)` | 输入已验证路径、策略、signal、全局限流器和进度回调；返回统计及校验清单；失败前等待已派发 I/O 全部 settle |
| `copyWorkspaceFile(src, dst, mode)` | 返回 `cloned` 或 `copied` 及降级原因；不返回未经证实的“CoW 支持率” |

数据服务公开 `reserveTx`、`markPreparedTx`、`publishTx`、`beginDeleteTx`、`finishDeleteTx`、`recordFailureTx`、`get`、`list`。所有 Tx 方法同步、接收 `DbOrTx`，返回条件更新结果；状态不符不能无条件覆盖。`publishTx` 自己验证 prepared 状态、revision 和预留目标，外部不能直接 UPDATE 该表。

`startCreate` 的“同步准入”指进入后台任务前先完成数据库预留，方法仍可返回 Promise；调用方收到 copyId 时必须已经可以查询记录。状态只沿 creating → prepared → ready → deleting → removed 前进，creating/prepared 可进入 failed/cancelled。失败资源的清理通过 cleanup 状态追踪，不把失败操作改成一次成功创建。

cancel 对 failed/cancelled 幂等返回原结果；对 ready 返回 already-published；对 deleting/removed 返回当前状态且不撤销删除。取消创建和中止删除是不同的产品操作，首版不提供后者。

standalone 创建由副本服务调用工作区数据服务和记录数据服务发布。fork 创建由 `AgentSessionForkService.commitTx()` 调用同一组数据方法，在既有源校验之后创建目标工作区、关联副本、创建子会话与消息。数据服务若形成真实相互依赖，遵循现有 `dataServiceRegistry` 解环，不使用动态 import 绕过边界。

### IpcApi 与 DataApi

| 接口 | 用途 |
| --- | --- |
| `ai.agent.workspace.copy.start` | 创建命令，返回 `{copyId}`；默认 prefer-clone + metadata |
| `ai.agent.workspace.copy.cancel` | 取消命令，返回最终创建状态和清理是否待办 |
| `ai.agent.workspace.copy.remove` | 显式删除文件命令，输入 copyId 与 expectedRevision |
| `ai.agent.workspace.copy.progress` | 限频进度事件，含 copyId、递增序号、阶段、已处理项；无完整源路径 |
| `/agent-workspace-copies` 与 `/:id` GET | SQLite 持久读模型，重新打开窗口后可重建状态；不提供绕过文件生命周期的 POST/DELETE |
| `ai.agent.session.fork` 扩展 | 用户工作区选项 `workspace: {mode: 'shared'} | {mode: 'copy', requestId, copyMode, validation}`；未提供时保持 shared |

现有 fork 返回 `{sessionId}` 的契约保留；renderer 用已知 requestId 关联副本状态，GET 支持 requestId 精确查询。fork 的单次请求丢失响应后重试，由副本记录中的 intendedSessionId 返回已发布会话，不再次创建 SDK 历史。相同 requestId 配不同输入、源消息边界或 consumer，报 `request_conflict`。同进程的并发重复请求加入首次协调器的 Promise，只允许一个协调器调用 driver；首次预留的 forkOperationId 和 targetSessionId 不能被重试替换。对失败请求返回原终态；主动重试应使用新 requestId。

进度不是业务真相，可以丢失或重排，UI 只接受更大序号；完成后重新查询持久读模型。copy.start 在退出门禁关闭后拒绝新请求。创建不绑定某个窗口的存活，关闭窗口不隐式取消。

## 8 创建与发布协议

```mermaid
sequenceDiagram
  participant Caller as 创建或 fork 协调器
  participant Copy as 副本服务
  participant FS as 文件系统
  participant DB as SQLite
  Caller->>Copy: 请求和 requestId
  Copy->>DB: 预留 copyId 和 creating 记录
  Copy->>FS: 独占创建资源根并记录身份
  Copy->>FS: 复制到 project.partial
  Copy->>FS: 校验并改名为 project
  Copy->>DB: 条件标记 prepared
  Copy-->>Caller: 准备句柄和最终 cwd
  Note over Caller: fork 在此准备 SDK 历史及产物
  Caller->>DB: 同步事务发布工作区和副本，fork 同时发布会话
  DB-->>Caller: committed
  Caller->>Copy: finish 或 standalone 收尾
  Copy-->>Caller: ready，发送读模型通知
```

1. 准入时捕获源工作区 ID、规范路径、根身份、策略版本、来源关系和完整请求摘要。验证源可读、目标不重叠；落盘前先提交 creating 记录。
2. 在可信父级中独占 `mkdir` 资源根，获取身份，再以 `wx` 写初始清单。若进程在 mkdir 和身份记录之间退出，留下的身份不明目录保留；恢复不得猜测所有权来强行清理。
3. 创建 `project.partial`，进行有界遍历、复制和校验。源工作区无论是否来自副本，都只读使用。
4. 全部文件就绪且通过校验后，更新清单，将 partial 改名为同一资源根内的 `project`；确认目标不存在。同父级重命名不涉及跨卷移动。对外仍不可见。
5. 条件进入 prepared。fork driver 得到最终 cwd，避免 SDK 持久化临时路径后又被改名。driver 若合法写入 prepared 工作区，其新增文件同样属于本次准备资源。
6. 发布前重新检查源业务关系、取消状态与目录身份。在一个同步 `withWriteTx` 中创建目标工作区并把副本改为 ready；fork 额外创建子会话与消息。事务中不 await、不执行文件 I/O。
7. 提交是唯一发布线性化点。之后取消不再回滚；通知失败也不回滚。客户端重试读取已提交结果。
8. 发布失败才进入未发布资源清理。原有 fork 清理只管 SDK 产物，副本服务只管副本资源根；两者互不递归删除对方路径。

文件系统改名和 SQLite 不能组成一个原子事务。设计以“先准备文件、后提交可见引用”的顺序与恢复记录弥合窗口，接受短暂的不可见孤儿，不接受指向半成品的可用会话。

清单更新采用同目录临时文件、写入与同步、原子替换；目录项同步在平台支持时执行。这个协议用于进程崩溃恢复，不承诺无条件抵抗突然断电、控制器故障或不遵守持久化语义的网络存储。发布后启动仍需检查磁盘资源存在。

## 9 复制策略与一致性

### 文件选择

策略是带版本的普通数据，由纯函数判断每个相对路径；不引入可执行用户 filter 回调。首版冻结以下默认行为，结果明确列出排除项：

| 内容 | 行为 |
| --- | --- |
| 常规文件、空目录、隐藏文件、未跟踪与未提交文件 | 复制；不调用 Git checkout，也不按 `.gitignore` 自动丢弃 |
| `.git` 文件或目录，含嵌套仓库入口 | 排除；避免 `.git` 指向原 worktree、对象库或公共 Git 元数据 |
| `node_modules`、`.cherry-workspaces` | 排除；依赖由副本内后续安装，不软链接回原项目 |
| `dist`、`build`、数据集、缓存等其他目录 | 默认保留；不能仅凭名称断言可重新生成；以后可增加明确的可选排除预设 |
| 普通相对软链接，解析后全程位于保留的源树内 | 保留内部指向；验证重定位后仍落在目标树内 |
| 指向源树内部的绝对软链接 | 转换为目标树内部的相对链接；记录转换；不能保留绝对路径指回源目录 |
| 外部、断裂、循环或指向已排除目标的链接 | 报 `unsupported_link`，提供相对路径；不默默解引用，也不静默删掉 |
| Windows junction 和其他不可可靠识别的 reparse point | 第一版拒绝；普通软链接创建权限不足也明确失败 |
| socket、FIFO、设备等特殊文件 | 报 `unsupported_entry`，不读取其内容 |
| 源内部 hardlink | 每个目录项复制成独立文件，不与源共享可写 inode |

路径大小写、Unicode 和命名规则不同可能在目标卷产生冲突。通过排他创建发现并报 `path_collision`，不得覆盖前一个文件。拒绝遍历中出现的非预期挂载边界；Node 无法可靠识别的 bind mount 或恶意 reparse 竞态不纳入安全隔离保证。

副本是项目文件目录，默认没有 Git 历史和分支，UI 不宣称它是独立 Git checkout。若后续需要 Git 状态，单独设计独立仓库初始化或安全的 Git 元数据复制，不能简单取消 `.git` 的排除就算完成。

### 校验级别

默认 `metadata` 保留 CoW 的收益：遍历清单记录相对路径、类型、稳定文件身份、大小、高精度 mtime/ctime 和权限；单文件复制前后重新 stat，复制结束重扫源树，比对新增、删除、替换及元数据变化，检查目标清单和尺寸。发现差异整次失败为 `source_changed`，不无限自动重试。

`content` 在此基础上记录源内容摘要、核对目标摘要，并在最终源扫描再次核对摘要，适用于需要更强校验的请求。哈希使用流和同一个限流预算，不整文件读入内存。它会读取大量数据，CoW 的磁盘空间优势仍在，但不能宣称创建时间只与文件数有关。

两种级别都不是跨文件原子快照。metadata 可能漏掉某些时间戳未反映的修改；content 也不能证明所有文件在同一时刻共存。强一致项目快照需要所有写者配合冻结或文件系统快照，不由 `fs-copyfile` 提供。当前系统工作区 fork 的内容校验不得为了复用新函数降级成 metadata。

仅在主进程中持锁不能阻止编辑器、编译器和外部进程写源目录。复制期间不强行终止源会话；发生变化明确失败，让调用者在合适时机重试。源文件可能在路径校验与原生打开之间被替换，因此后置检测用于发现常规并发，不构成对恶意同用户进程的 TOCTOU 防护。

### 元数据与性能

契约保证常规文件内容、目录结构、内部链接语义及支持平台上的 executable 等必要 mode 位；不承诺完整备份 ACL、xattr、Windows ADS、稀疏布局、压缩和所有文件系统特有属性。所有权使用当前用户；必要 mode 设置失败应失败，时间戳保留失败可以作为明确警告，不能掩盖内容失败。

初始预算为同时运行最多 2 个目录复制、全服务最多 8 个文件 I/O 作业，且哈希纳入同一预算；这些是待基准验证的内部默认值，不承诺性能指标。遍历使用背压和可迭代目录读取，不能 `Promise.all` 整棵树；大型清单可落在本次资源根下，避免无限占用内存。事件最多约 5 次每秒，并在阶段变化和终态立即发送。

不通过全局缓存的“文件系统支持”跳过所有克隆请求。不同挂载点、文件属性和跨卷关系可能不同；首版以实际调用结果为准，避免维护一张文件系统白名单。

## 10 竞态与引用门禁

| 竞争场景 | 处理与线性化点 |
| --- | --- |
| 同请求重复创建 | requestId 唯一索引加请求摘要；先完成预留者获胜，其他读取同一记录 |
| 不同请求复制同一项目 | 各自独占资源根并受全局限流；不相互覆盖，也不承诺相同时间点 |
| 源目录被替换或文件改变 | 根身份和逐项校验；失败不发布；不能靠字符串路径相等判断没变 |
| 源会话或工作区被删除 | 复制源持临时使用租约；删除入口取消或等待相关操作，发布事务再检查源仍符合契约 |
| 取消与数据库提交同时发生 | 提交前检查取消；单主进程同步事务成功后 ready 获胜；不能收到迟到取消后删掉已发布目录 |
| 删除副本与新会话注册 | 同步事务把副本从 ready 改为 deleting；所有引用创建事务检查 ready；二者只能有一方先成功 |
| 删除副本与正在复制该副本 | 源租约计入 busy；引用计数为零仍不能删除 |
| 删除与外部重新创建同名路径 | 删除前将已验证目标改名到固定 disposal 路径，后续只清理身份匹配的 disposal；不再次 rm 原 cwd |
| UI 关闭、IPC 超时或进度丢失 | 主进程继续持有任务；查询 DB 重建状态；不能把断连当取消 |
| 原生复制取消后仍继续写 | 停止派发并等待所有已提交原生 Promise settle，再清理；不能用 `Promise.race` 提前回收目录 |

使用现有 `KeyedMutex` 按 copyId 串行协调文件状态。多 copyId 必须排序取锁；批量删除不嵌套无序锁。长期复制不持 SQLite 事务或会话锁，也不在持有会话锁时等待副本回调再进入同一锁。引用的授权判断以同步数据库事务中的条件更新为准，mutex 只是减少本进程冲突。

引用检查必须包含：普通、归档及回收站会话；Agent tasks 的工作区配置；渠道配置；正在 fork/复制的临时租约；已注册的其他工作区对同一目录、其祖先或后代的别名引用。若终端功能可持有 cwd，也必须参加租约。不能只统计当前活跃会话。

副本自己的 targetWorkspaceId 行是被管理的资源登记，不算阻止删除的额外引用；其他别名工作区仍然阻止删除。完成文件删除后，在同一个最终事务中通过工作区数据服务移除该目标行并标记副本 removed。deleting 期间保留记录用于 UI 和恢复，且禁止所有新使用者进入。

上游必须把 `AgentSessionService.createTx`、计划任务与渠道的工作区绑定、路径注册和恢复入口都接入同一份 **数据层引用准入规则**：ready 可引用，creating/prepared/deleting/removed 不可引用。它位于工作区数据域，可以被其他数据服务同步调用，不能要求 DataApi 去调用 AI 生命周期服务。纯配置引用按 workspaceId 检查；路径注册还需主进程规范化后识别受管资源根及祖先后代重叠。

已有 `findOrCreateByPath` 不得把受管的 partial/project/disposal 子路径注册成 external 来绕过门禁。先按记录中的受管根分类，再做允许性检查。操作期间维持租约，避免异步 canonicalize 完成后状态已变。无法确认的路径别名一律不进入自动删除路径。

对于已移除工作区记录、文件仍保留的 ready 副本，只允许精确的 project 路径在身份验证后重新关联：事务创建工作区行并更新 targetWorkspaceId，继续投影为 managed-copy。资源根、partial、disposal 及 project 子路径均不能注册为另一个 external 工作区。copy.start 的 creating/prepared 来源记录也作为持久化临时引用参与数据层检查；内存租约补足注册、校验到预留之间的窗口。引用门禁必须在所有写入口闭合后才开启文件删除能力。

单主进程是本方案的写入前提。SQLite 条件状态更新跨窗口有效；仅本地 mutex 不协调第二个应用进程。受管根用每副本 UUID 隔离；如果同一用户数据目录被两个进程同时打开，必须由现有实例机制阻止，不能据此设计一个不完整的分布式锁。

## 11 错误模型与降级

内部错误类 `WorkspaceCopyError` 包含 `code`、`phase`、`copyId`、可选相对路径、原始 errno 和 cause。IpcError 暴露稳定 code 与可本地化参数；详细绝对路径与堆栈仅进入受控日志。清理错误追加记录，不替换首次业务失败。

| 错误 | 行为 |
| --- | --- |
| `EXDEV`、`ENOTSUP` / `EOPNOTSUPP`、`ENOSYS` 来自原生克隆 | prefer-clone 允许普通复制，require-clone 报 `clone_unavailable` |
| `EINVAL`、`EIO`、未知错误 | 不泛化为“不支持”；默认失败，只有明确文档与平台测试确认的条件才可加入降级集合 |
| `EACCES` / `EPERM`、`ENOSPC` / `EDQUOT` | `permission_denied` 或 `storage_full`；不换目录重做、不盲目重试 |
| `ENOENT` 来自源文件 | `source_missing` 或 `source_changed`，结合所处阶段；目标父级丢失归为 storage/unowned 错误 |
| `EEXIST`、大小写冲突 | `path_collision` 或 `ownership_mismatch`；不覆盖、不 unlink 未知对象 |
| 原生模块缺失或加载失败 | prefer-clone 可退回 Node 普通复制并明确记录 `native_unavailable`；require-clone 失败；发布构建仍将此视为打包缺陷 |
| DB 源校验不通过或 revision 改变 | `source_changed` / `state_conflict`；未发布资源按所有权清理 |
| 副本仍被引用 | `workspace_in_use`，返回引用种类及数量；不级联删除会话、任务或渠道 |
| 目录身份不匹配、清单损坏 | `ownership_mismatch`；清理 blocked，保留证据，不自行接管 |
| 重复 requestId 输入不同 | `request_conflict`；不重用已有结果执行新工作 |
| 取消 | `cancelled`；可以同时存在 cleanup pending，终态如实显示 |

原生模块采用主进程惰性加载，在能力适配层捕获 import 失败，不能使整个应用启动失败。可缓存本进程的模块加载结果，不缓存所有卷的克隆能力。require-clone 模式不得用 Node 普通复制“救活”失败。

若克隆失败留下目标：仅当包契约和记录能确认是当前独占 staging 内本次创建的对象，才允许清理该对象后降级。否则中止并交给整次操作的所有权清理。第一版宁可保留待处理对象，也不写 `catch { rm(dst); copyAgain() }`。

## 12 删除、恢复与生命周期

### 两种删除语义

现有“移除工作区”仍处理会话与数据库关系，不顺带删项目文件；如果涉及副本，文件记录保留为可查询成果。新增“删除副本文件”明确显示目标目录与不可恢复后果，只有用户显式请求才调用 copy.remove。它不增加默认自动删除或按天回收。

删除协议：检查记录与 manifest/根身份 → 事务检查所有引用与租约、条件进入 deleting → 在已验证私有根内将 project 改名为 project.disposal → 持久记录已脱离 → 递归删除 disposal → 验证剩余仅为自己创建的控制文件 → 清理资源根 → 事务标记 removed。ready → deleting 要求 expectedRevision 匹配；已 deleting 的重试加入同一清理，已 removed 返回原成功结果，不创建新的删除任务。

如果资源根出现不认识的额外用户文件，不递归删除整个资源根；保留并报告 blocked。删除部分完成可重试，仍保持 deleting 并禁止新引用。对只读属性和短暂 Windows sharing violation 只做有界、可取消重试；无法处理则持久化 pending，不阻塞应用退出。已有 source/user/system 根永不成为本服务的 rm 目标。

路径字符串、token 和 `lstat` 组合能处理常规误移动、替换和恢复错误；不能阻止具有同等文件权限的恶意进程在检查后改名。父级为当前用户控制的目录，关键阶段重新验证身份，歧义时停止；需要抵抗恶意重解析竞态时，应先扩展原生层的句柄相对操作，本阶段不做该安全承诺。

### 启动恢复矩阵

| 持久状态与证据 | 恢复动作 |
| --- | --- |
| creating/prepared，目标业务未发布，目录身份可信 | 不恢复源复制；进入失败或取消终态并回收本次资源 |
| fork 消费者且发布事务已提交 | ready 与会话原子存在，保留项目；fork 自己恢复 SDK 资源 |
| ready，但清单阶段落后 | DB 为发布真相；验证资源后修补清单，不能按旧清单回滚 |
| ready，目录丢失或磁盘离线 | 展示不可用；不自动新建、迁移或删除记录，等待存储恢复 |
| deleting，project 仍在 | 核对删除授权、身份和引用后继续脱离；异常则 blocked |
| deleting，只有可信 disposal | 继续清理 disposal，不触碰重新出现的 project |
| deleting，整个资源根不在 | 只有确认父级可访问、卷在线且路径确实不存在才完成 removed；离线不能当删除成功 |
| DB 与 manifest/token/身份冲突 | 保留全部对象，标记 blocked，提供诊断和显式人工处理入口 |
| 磁盘有目录但本 DB 没有对应记录 | 不扫盘自动导入或删除；这是未知资源 |

恢复只访问记录中的确切资源根，不递归扫描整个用户项目或应用数据目录。多个恢复请求串行或合并，同一 copyId 与正常操作共用门禁。已有 ready 工作区可先使用，待恢复副本则在该副本门禁完成前拒绝访问；路径重叠检查读取完整记录，不能忽略正在恢复的行。

备份与数据目录迁移需扩展现有 quiesce 协议：阻止新复制、fork 和删除，等待当前任务 settle，再快照数据库。放在项目旁的副本默认不在 userData 备份范围内；备份必须明确列为外部文件资源。还原到新机器时先标记位置待验证，旧路径不能自动授权删除新机器的同名目录。

## 13 与会话 fork 的具体组合

1. 用户工作区 mode=shared 沿用现有流程。mode=copy 先查 requestId；命中已提交结果即返回，即使源后来已删除也不重新验证源。新请求才进入现有准入和源消息验证，并预留 copyId 与 targetSessionId。
2. fork 资源清单新增版本化的 `workspaceCopyId`，不记录一个“由 fork 可以删除”的副本路径。旧清单读取与旧系统目录清理保持兼容；格式不匹配保留而非猜测。
3. `prepareForFork()` 返回最终 cwd，driver 在该目录语义下创建自己的历史和 resumeToken。消息边界依旧由各 runtime 自己验证，不能用复制文件代替原生历史 fork。
4. SDK 产物按现有协议发布；`commitTx()` 校验源消息前缀、原 workspace 与副本 prepared revision，然后一次提交工作区、副本、子会话和消息。
5. `finally` 调用 `finishForkPreparation()`；副本已 ready 则只释放临时租约。未发布则取消并 drain 相关操作，再清理。后续通知失败不撤销已提交结果。
6. 删除源会话、Agent 或工作区时，现有 lifecycle drain 必须覆盖这个准备调用；副本服务不能另起一个脱离 runtime 的 fork 任务。独立创建的 copy 任务由副本服务自行管理。

prepared 阶段仍可能被 driver 写入，因此 copy.cancel 不能自行删目录。`forkContext` 传入由协调器拥有的取消回调，副本服务发取消后等待准备租约释放；协调器负责中止 driver 并等待它的 worker 退出，然后才调用 finish。finish 自己不等待包含自身的 fork Promise，避免取消与收尾互相等待。这个回调是操作级协作，不是副本服务对 Runtime 的反向容器依赖。无法确认 worker 已结束时只记录待清理，不释放文件删除门禁。

用于新 cwd 的 resume 必须逐 runtime 验证：Pi、Claude Code、DSH 是否把绝对路径、工具状态或权限绑定在原 cwd。若某 driver 不支持用户项目 cwd 变化，应返回明确的 `unsupported_workspace_copy`，不能共享原目录却向用户显示“已隔离”。现有系统目录 fork 能改变 cwd 是接入依据，但不是所有用户项目情况已经被验证的证据。

## 14 依赖、构建与发布前置条件

锁定运行时依赖 `@vscode/fs-copyfile@3.0.0` 并更新 lockfile。该发布包包含源代码和 node-gyp 构建脚本，不自带所有目标的预编译 `.node`。按实际平台配置 `pnpm-workspace.yaml` 的构建许可，明确接入原生依赖构建和打包，不只在开发机器上装一次。

| 项目 | 必须完成的工作 |
| --- | --- |
| macOS / Windows | 为发布目标架构构建并打包绑定；主进程 externalize 包，确保 ESM `createRequire` 的相对 native 路径成立 |
| Electron | 以当前 Electron 与各架构进行加载和真实复制测试；不能仅因使用 N-API 就省掉验证，包也使用 libuv 接口 |
| ASAR | 将绑定放进 unpacked 区，检查安装包内加载路径；不把 native 模块带进 renderer 或 preload bundle |
| Linux | 运行路径使用 Node copyFile；仍验证安装脚本、glibc/musl 发布目标与生产打包，不让无用 native 构建成为安装障碍 |
| Windows 工具链 | 3.0.0 binding.gyp 启用了 Spectre mitigation，CI 工具链需有对应 MSVC 库；不能靠静默关闭编译选项绕开 |
| Windows 长路径 | 原生实现使用 `GetTempFileNameW` 和固定长度缓冲；应向上游修复长路径，再验证长源/目标、UNC 和深目录 |

当前隔离评估在本机 Windows 构建遇到 MSB8040，缺少 Spectre 库，因此还不能宣称此环境已验证原生绑定。该事实是实现阶段的构建前置条件，不影响先完成本文设计。

上游暂未解决长路径时，prefer-clone 可以在准确识别这项限制后绕过原生克隆使用普通复制，并显式记录原因；require-clone 必须报错。不能把所有 EINVAL 归为长路径。发布前应优先补上游修复或可追踪的包补丁，并测试其余路径不受影响。

Electron 原生模块必须针对运行环境正确构建与打包；Node 下的单元测试不能代替安装包内验证。[Electron 原生模块文档](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) Windows 临时文件 API 自身也规定路径长度限制。[GetTempFileNameW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettempfilenamew)

## 15 测试与验收

每组测试验证用户可观察契约，不以 mock 调用次数作为通过依据。数据库测试使用 `setupTestDatabase()` 和生产迁移；生命周期与 application 使用仓库统一 mock。原生测试分平台标记，跳过不能计为通过。

| 测试组 | 必须捕获的错误 |
| --- | --- |
| 文件独立性 | 修改源后副本不变；修改副本后源不变；包含截断、追加、原地覆盖与 rename 替换 |
| 强制 CoW | APFS、启用 reflink 的 XFS/Btrfs、合适 ReFS 上 FORCE 成功；ext4/普通 NTFS 不伪报克隆成功；用平台工具辅助观察共享区段 |
| 明确降级 | unsupported 可以复制，权限/空间/I/O 错误不能被吞；require-clone 不降级；统计符合实际路径 |
| 文件策略 | 隐藏与未提交文件保留；.git/node_modules 排除；内部链接重定位不指回源；外部链接、junction、特殊文件和大小写冲突失败 |
| 源并发修改 | 添加、删除、替换、同大小写入、根目录换位；校验失败不产生可用目标会话 |
| 取消与 drain | 延迟中的 native 调用完成前不清理；取消与提交交错只能得到 cancelled 或完整 ready，不出现 ready 目录被回滚 |
| 幂等性 | 同 requestId 并发/响应丢失重试只出现一个副本和目标会话；不同输入拒绝 |
| 发布事务 | SDK 失败、源消息变化、DB 提交失败不会留下可选的半成品工作区；提交后通知失败仍能查询成功 |
| 删除门禁 | 回收站会话、任务、渠道、别名工作区、源复制租约均阻止删除；并发新引用与 deleting 只能一方成功 |
| 所有权 | 同名目录被替换、manifest/token 改动、根下额外文件、离线卷不能触发错误删除；资源根以外哨兵文件始终不变 |
| 崩溃恢复 | 在预留、mkdir、清单写、复制、rename、prepared、DB commit、detach、rm 后逐点中断；重启结果符合恢复矩阵 |
| 数据迁移 | 已有 user/system 工作区行为不变；新表只追加迁移；解除 FK 不丢所有权记录，不级联删目录 |
| Runtime | 三种 runtime 从新 cwd 继续对话，原 cwd 不被错误沿用；旧 shared 和系统 fork 现有测试继续通过 |
| 安装包 | macOS/Windows x64/arm64 及产品实际 Linux 目标内加载、FORCE/fallback、长路径和跨卷；不能只测开发 Node |

性能记录分别覆盖“小量大文件”和“大量小文件”，比较空闲与并发两份项目：扫描、克隆/复制、校验、发布各阶段耗时，峰值内存、主进程事件循环延迟、取消 drain 时间、逻辑字节与可观测分配空间。先基准再定产品阈值；不承诺任意项目都瞬时复制。

## 16 实施顺序与完成标准

| 阶段 | 范围 | 完成证据 |
| --- | --- | --- |
| 1 依赖与底层契约 | 原生构建链、路径模块扩展、单文件适配和克隆错误分类 | 目标 Electron 加载及 FORCE/fallback 测试；长路径问题有明确处理 |
| 2 数据与所有权 | 追加表迁移、storage 投影、引用准入、manifest 与身份协议 | 实库迁移、引用竞争、误删除哨兵测试 |
| 3 创建与恢复 | 生命周期服务、目录复制、幂等、取消、状态查询与清理恢复 | 崩溃矩阵和 native drain 测试 |
| 4 会话接入 | 用户 fork 的 copy 选项、原子发布、SDK cwd 验证、现有删除入口审计 | 三 runtime 的目标场景以及旧 fork 回归通过 |
| 5 产品入口 | 创建/进度/保留/显式删除交互，终态查询和降级展示 | 实际 Electron 操作、窗口关闭重开、取消及存储不可用验证 |

上线门槛是生命周期闭环，而非“能复制一次”：创建失败可解释，取消不竞态删除，提交成功可重查，旧会话行为兼容，磁盘资源始终能找到唯一所有者，无法证明所有权时保留文件。

以后增加变更比较可以复用副本的来源信息，但内容摘要不足以做三方合并。自动回写必须另存可信基线内容、定义冲突与覆盖协议，并获得明确操作授权；本设计不预先增加一份基线目录或将源项目当成永远不变的 base。

## 相关规范

- [Agent Session Fork](./agent-session-fork.md)：现有 fork 行为与原生历史协议。
- [Agent Lifecycle](./agent-lifecycle.md)：归档、删除、备份 quiesce 的现有所有者。
- [Main Process Architecture](../architecture/main-process.md)：代码放置和依赖方向。
- [Lifecycle Decision Guide](../lifecycle/lifecycle-decision-guide.md)：生命周期与普通数据服务的区别。
- [Paths Module](../../../src/main/core/paths/README.md)：集中式路径与显式物化规则。
- [Data Services](../../../src/main/data/services/README.md)：表所有权、同步事务与真实依赖环处理。
- [IpcApi](../ipc/README.md)：命令、事件和错误的跨进程契约。
