# Agent Note: 远程 Task API 与结果发现

Status: proposed

[English](2026-11-12-remote-task-api.md) | 中文

## Problem

定时任务结果因远程 `agent.sessions.list` 共用了普通会话过滤条件而无法被发现。任务和执行数据已经存在于调度数据库；再建立一份远程任务模型会引入状态不一致。

对外 API 必须在内部实体演进时保持稳定。因此，数据值只有一个业务来源，再通过显式、有类型约束的投影进入独立维护的 wire schema；不复制调度规则，也不直接导出整个内部实体。

源码基线：`8dfe578c0e6ada83a9b6c0d41489c4c3a6814476`。本文是实现提案，不代表能力已经发布。已有的[定时任务页面 Spec](2026-10-31-scheduled-tasks-page.md)继续拥有桌面页面行为；本文拥有远程查询和结果发现，不取代该 Spec。

## Proposal

### 范围

交付五个只读 Task 方法，并恢复现有会话列表中的任务结果发现。复用当前 Agent 授权、RPC 传输、分页预算、消息读取和订阅。不新增 hello 标志、通用 Revision、订阅、调度器、数据库表或依赖。

任务创建/编辑/删除、暂停/继续/立即运行、Session 状态查询和文件预览分别交付。本切片不新增移动端任务管理页面。通过实际 RPC 连接验证 API 可用性；现有手机会话流程用于回归验收。

### 公开方法

请求使用 strict schema；返回对象沿用现有协议可扩展对象的约定。ID、UTC 时间、内容引用和分页限制复用协议基础定义。公开 TypeScript 类型只从这些公开 schema 派生。

| Method | Input | Output |
|---|---|---|
| `agent.tasks.list` | `{ agentId?, statuses?, cursor?, limit? }` | `{ items: TaskSummary[], nextCursor }` |
| `agent.tasks.get` | `{ taskId }` | `{ task: TaskDetail }` |
| `agent.tasks.runs.list` | `{ taskId, cursor?, limit? }` | `{ items: TaskRun[], nextCursor }` |
| `agent.tasks.runs.get` | `{ taskId, runId }` | `{ run: TaskRun }` |
| `agent.tasks.content.read` | `{ taskId, contentId, revision, offset, maxBytes }` | `{ contentId, revision, offset, dataBase64, nextOffset, eof, sha256 }` |

`statuses` 是非空的 `active | paused | completed | missed` 集合；省略表示四种状态全部查询。先应用 Agent 可见性、heartbeat 排除和状态过滤，再分页。不存在的 `agentId` 筛选返回空列表；按 ID 查询缺失或不可见任务/执行返回 `NOT_FOUND`。必须验证 run 属于请求中的 task，不能只检查 Job ID 存在。

### 稳定任务数据与业务来源

下面是公开外形示意。实现时由 `remote-protocol` 拥有，不依赖 `@shared` 或 Electron。主进程中的薄映射函数接收业务类型，返回从公开 schema 派生的类型。不得用类型断言掩盖不匹配。

```ts
type TaskSummary = {
  taskId: string
  agentId: string
  name: string
  status: 'active' | 'paused' | 'completed' | 'missed'
  trigger: TaskTrigger
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

type TaskDetail = TaskSummary & {
  prompt: { text: string } | { ref: ContentRef }
  timeoutMinutes: number
  workspace: AgentWorkspaceSelection
  reuse: { kind: 'fresh' } | { kind: 'reuse'; sessionId: string | null }
}
```

| 公开数据 | 业务来源 | 允许的投影 |
|---|---|---|
| 身份、名称、创建与更新时间 | `ScheduledTaskEntity` | 将 `id` 改名为 `taskId`，编码已有值 |
| 任务状态 | `ScheduledTaskEntity.status` | 穷尽映射公开状态，不再从 `enabled` 推导一次 |
| 下次执行 | `ScheduledTaskEntity.nextRun` | 无值统一为 `null`，remote 不计算调度 |
| 提示词、触发器、超时 | `ScheduledTaskEntity` | 有界文本/内容引用和显式调度编码 |
| 工作区与会话复用 | `ScheduledTaskEntity` | 映射现有工作区身份和复用字段，不暴露绝对路径 |

内部字段改名由映射吸收，公开名称保持不变。内部新增枚举成员必须在编译时要求明确投影方式。同类型的语义变化仍需审查，类型检查不能证明其兼容性。

`TaskTrigger` 固定现有 cron/interval/once 含义，但不重导出内部 schema：cron 包含 `expr`、可选 `timezone` 和 `limit`；interval 包含 `ms` 和可选 `anchor`；once 的 `at` 使用 Unix 毫秒。配置中省略的默认项继续省略；客户端展示配置并使用 `nextRunAt`，不自行执行调度。cron 缺少时区表示主机调度器的时区，不是手机时区。

列表包含 `trigger` 和 `updatedAt`，客户端无需逐项获取详情即可展示调度规则与业务更新时间。`updatedAt` 沿用任务现有时间戳，不是独立的 API revision，也不承诺只有用户编辑才会改变它。

初版任务返回不包含 `latestRun` 或 `runSummary`。现有运行摘要是带有乐观取消的 UI 投影，不能当作权威执行记录。不返回 channel 配置、原始 Job input/output/metadata 或 provider 凭据。

### 执行事实与结果位置

在 `AgentTaskService` 增加 `listTaskRuns(taskId, options)` 和 `getTaskRun(taskId, runId)`。两者先解析可见任务，再通过 `JobService` 按 `agent.task` 类型和 schedule 身份查询。结构化输出和已保存的会话关联在该业务所有者中解析。在 `AgentTaskService` 旁定义仅 Main 使用的内部 `TaskRunRecord`；它的持久化字段可以从 `JobSnapshot` 派生，因为它不是公开契约。

公开 `TaskRun` 包含 `runId`、`taskId`、`createdAt`、`scheduledAt`、`summary` 和 `resultLocation`，以及下表的状态事实。读取不得启动任务或 runtime。

`summary` 是从业务所有者结构化输出的 `result` 字符串派生的可空展示摘要，最多 200 个 UTF-16 单元，与现有任务输出对齐。截断保留完整代理对，旧记录中的非法 Unicode 使用替代字符。缺失或非字符串结果返回 `null`，不把原始载荷序列化为 JSON。摘要不是完整回复，也不决定 `outcome`；完整内容仍从关联结果会话读取。

| 业务事实 | 公开状态与字段 |
|---|---|
| `pending` / `delayed` | `queued`；`startedAt: null`；保留 `scheduledAt` 和 `cancelRequested` |
| `running` | `running`；真实 `startedAt`；保留 `cancelRequested` |
| `completed` | `completed`；可空的真实 `startedAt`、真实 `finishedAt`、`outcome: executed \| skipped \| unknown` |
| `failed` | `failed`；可空的真实 `startedAt`、真实 `finishedAt`、有界安全错误 |
| `cancelled` | 只有持久化转换完成后才是 `cancelled`；可空的真实 `startedAt`、真实 `finishedAt` |

`outcome` 来自结构化输出的 `kind`；旧记录缺少该字段时返回 `unknown`，不从结果文案推断成功。run ID 表示跨重试的同一个持久化 Job，不表示某次执行尝试或 Session。重试时间遵循该 Job 当前持久化字段。缺失的开始或结束时间保持 null，包括旧终态记录，不伪造时间。

保留 `getTaskLogs` 现有桌面展示行为，但与新的运行记录共用已保存会话关联的提取逻辑。不能从其折叠后的状态或合成启动时间反推事实。

从持久化 metadata 读取会话关联，旧记录沿用已有 output 字段回退。验证关联会话属于同一 Agent 且是可寻址 conversation。尚未记录关联时 `resultLocation` 为 `none`；可读取时为带有效 ID 的 `session`；已记录的结果无法打开时为 `unavailable`。多个 run 可以复用同一会话。API 打开关联会话，不承诺跳转到本次精确回复。Job 保留策略不变。

### 有界读取、授权与错误

每个 RPC 入口复用当前 Agent 授权。只有 configuration 授权的设备不能读取任务。撤销和过期继续由 `requireAgent` 检查，不新增 task 权限范围。设备授权不能替代 task/run 归属检查。

采用 offset 分页，默认 20、最大 100。任务和执行均按 `createdAt DESC, id DESC` 排序；只在现有所有者中补齐缺少的确定性次序。紧凑的不透明 cursor 将 offset 绑定到方法和规范化筛选条件，不授予权限，也不承诺跨页快照。不把现有任务扫描重做成索引系统，不读取无界执行历史，也不为每个任务行单独查询日志。

复用响应字节预算和现有缩小页长的方式。nextCursor 按实际返回数量推进；单项超限返回 `RESOURCE_EXHAUSTED / ITEM_TOO_LARGE`。非法 cursor 使用现有 cursor 错误，不能悄悄回到第一页。客户端按 ID 去重，刷新时重新分页。

任务提示词沿用现有 4,096 个 UTF-16 单元的内联阈值和 `ContentRef` 外形。更长文本使用任务专用 content read，每次最多 24,576 字节。让 `contentId` 绑定提示词摘要，revision 沿用已有十进制编码；每次读取都与当前任务校验两者。因此，同一毫秒内的两次写入也不会混读内容，不需要新的持久化 revision 或快照缓存。内容变化返回 `REVISION_EXPIRED`，客户端重取详情并重新读取，不能静默截断提示词。

错误沿用现有 RPC/failure 契约：schema 错误、拒绝/撤销授权、`NOT_FOUND`、`REVISION_EXPIRED` 和 `RESOURCE_EXHAUSTED`。隐藏原始异常栈与 Job 载荷。旧主机缺少新方法时产生不支持方法的结果，消费端不能将其解释为空任务列表。验证实际支持的发布组合，不新增逐功能版本标志。

### 恢复现有会话发现

在内部 `AgentSessionService.listByCursor` 查询中要求 `scope: ordinary | all-conversations`，移除默认参数。公开 DataApi 和 remote 请求 schema 保持不变。桌面 DataApi handler 显式选择 `ordinary`，remote adapter 选择 `all-conversations`。保留显式 ID/回收站查询、置顶排序、可见性和 background 会话排除。更新全部直接调用方及相关消费者测试，让遗漏选择在类型检查时失败。

现有会话 cursor 表示位置续查，不是快照。保留其编码；修复前获取的 cursor 在正常从第一页刷新前可能看不到新增可见项。不为本次修复建立 cursor 版本迁移。

### 逐文件实施顺序

表中的路径表示计划改动，不代表文件已实现。新增模块放在现有目录内。

| 步骤 | 文件 | 工作与验证 |
|---|---|---|
| 1. 业务事实 | `src/main/data/services/AgentTaskService.ts`；`src/main/data/services/JobService.ts` | 增加内部执行记录和所有者查询；让已有任务查询支持 Agent/status 联合筛选；保留日志展示；在真实迁移数据库上验证状态、归属和分页 |
| 2. 发现修复 | `src/main/data/services/AgentSessionService.ts`；`src/main/data/api/handlers/agentSessions.ts`；`src/main/services/remoteAccess/agentQueries.ts` 及直接调用方 | 要求内部 scope；恢复远程任务会话且不暴露 background/回收站会话；验证置顶与后续页 |
| 3. 公开契约 | 新增 `packages/remote-protocol/src/agent/tasks.ts`；已有 `agent/methods.ts` 和 `src/agent.ts` | 拥有有界任务 schema 与五方法映射，从现有 Agent 入口组合/导出；验证协议 schema 和类型检查 |
| 4. 远程投影 | 新增 `src/main/services/remoteAccess/agentTaskQueries.ts`；已有 `agentHandlers.ts` | 显式纯字段映射加业务调用、有界分页/内容和授权；注册完整 Task handler map；通过 RPC 验证 |
| 5. 交付 | `packages/remote-protocol/README.md`、包 changeset、受影响的所有者文档与消费端接入 | 沿用现有包构建发布流程；验证现有手机任务结果发现，以及类型化客户端 task → run → session → messages 链路 |

Task 方法名、参数和返回类型从其 schema map 派生。实际 Task handler 对象使用完整映射类型，并通过遍历注册；增加方法却未提供 handler 时编译失败。改动限定在 Task 方法组，不重做全部远程方法或引入 operation 框架。既有 Agent 方法仍需覆盖消费者回归。

暂停/继续/立即运行后续通过 `AgentJobsService` 和现有命令回执接入。当前 `runTask` 返回 `boolean`；公开 run-now 前必须返回实际入队/去重的 run 身份，并让 receipt 与准入原子关联。不能从最新日志猜测，也不要求预置 config revision。这部分不成为查询切片的验收依赖。

### 验证计划

以下限定范围的检查定义实现阶段的验证要求，已完成的证据记录在后文。数据库测试使用 `setupTestDatabase()` 和统一 mock。协议测试断言真实失败场景与公开外形，避免只复述映射实现的测试。

```sh
pnpm --filter @cherrystudio/remote-protocol test tests/contracts.test.ts tests/tasks.test.ts
pnpm --filter @cherrystudio/remote-protocol typecheck
pnpm --filter @cherrystudio/remote-protocol build
pnpm test:main src/main/data/services/__tests__/AgentTaskService.test.ts src/main/data/services/__tests__/AgentTaskService.integration.test.ts src/main/data/services/__tests__/JobService.test.ts
pnpm test:main src/main/data/services/__tests__/AgentSessionService.test.ts src/main/data/services/__tests__/AgentSessionVisibility.test.ts src/main/ai/agents/__tests__/runAgentTask.visibility.test.ts src/main/ai/agents/__tests__/AgentJobsService.test.ts src/main/ai/agents/__tests__/AgentLifecycleService.workspace.test.ts
pnpm test:main src/main/services/remoteAccess/__tests__/agent.test.ts src/main/services/remoteAccess/__tests__/agentPagination.test.ts src/main/services/remoteAccess/__tests__/agentTaskQueries.test.ts
pnpm test:shared src/shared/data/api/schemas/__tests__/agents.test.ts src/shared/data/api/schemas/__tests__/agentSessions.test.ts
pnpm typecheck:node
```

`tests/tasks.test.ts` 是计划新增的协议测试文件。类型检查若发现其他直接消费者，用明确文件路径补充验证，不运行完整本地套件。每个实现层运行限定范围的 lint/格式检查、`pnpm check --plan`、`pnpm change:scope --base <verified-ref>` 和 `pnpm docs:affected --base <verified-ref>`，语义审查调度页面、Agent 生命周期和远程访问文档候选。

RPC 场景使用已配对且获 Agent 授权的客户端：任务列表 → 详情 → 某个明确 run 的列表/详情 → 打开关联会话 → 读取消息。在断线重连和多页数据下重复验证。撤销授权后再次读取必须拒绝。另在定时任务执行后打开现有手机会话列表，确认结果仍可访问。类型、单测、RPC、真机和包发布结果分别报告。

### 本地实现验证

2026-11-12 本地已通过协议、业务服务、现有消费者、共享 schema 与 RPC 的定向验证，以及协议包构建/类型检查、主进程类型检查、改动文件 lint/格式检查和文档治理检查。类型化 RPC 场景使用真实本机 WebSocket 与 Noise 加密，重连后继续 Task/run 分页并打开已保存的会话消息。虚拟源码编译检查也拒绝了遗漏会话 scope（TS2345）、缺少 Task handler（TS2741）和未处理运行状态（TS1360），没有修改工作区源码。移动真机验收和协议包发布仍待完成，本地检查不代表这两项已经通过。

## Alternatives considered

| 备选方案 | 不采用的原因 |
|---|---|
| 用 Pick/Omit 导出内部实体 | 内部改名、枚举与私有字段可能悄悄改变公开契约 |
| 在 remote 计算任务状态或保存任务行 | 复制现有业务所有者，产生分叉状态 |
| 把当前展示日志作为执行事实返回 | 排队、取消和启动时间带有展示专用含义 |
| 先加入逐功能 hello 版本、集合 Revision 或订阅 | 交付这些查询和发现修复不需要这些机制 |
| 捆绑任务控制、CRUD 和文件预览 | 在恢复读取前引入独立的副作用与授权工作 |

## Acceptance criteria

- AC1 — 现有远程会话发现可在置顶及后续页返回普通与任务会话；桌面普通会话发现不变，隐藏/background/回收站会话仍被排除。 (verification: unit + RPC + device; owner: session implementer)
- AC2 — 任务列表在确定性分页前应用 Agent 可见性、heartbeat 排除及四种状态筛选，覆盖多页与组合筛选。 (verification: unit + RPC; owner: task data implementer)
- AC3 — 任务列表与详情从业务所有者派生值，包含触发器和更新时间；公开字段独立定义，不序列化凭据、原始 Job 载荷或绝对路径。 (verification: unit + protocol; owner: protocol implementer)
- AC4 — queued、running、completed、failed、cancelled 执行保留真实开始/结束及取消事实，覆盖重试、启动前失败和旧输出记录。展示摘要有界、保留有效 Unicode，且独立于 outcome。 (verification: unit + RPC; owner: task data implementer)
- AC5 — 执行查询验证请求中的任务，仅解析已保存且可读取的关联结果会话；未运行、会话删除、会话复用及历史保留场景均不回退到无关会话。 (verification: unit + RPC; owner: task data implementer)
- AC6 — 长提示词读取遵守 wire 预算，可检测包括同毫秒写入在内的内容替换，不混读版本，也不静默截断。 (verification: unit + RPC; owner: remote implementer)
- AC7 — 仅有 configuration 授权、授权过期或被撤销时不能读取任务数据；五个方法全部经过现有授权边界。 (verification: RPC; owner: remote implementer)
- AC8 — Task 方法缺少已注册的类型化 handler、遗漏内部查询 scope 或未处理业务状态分支时，类型检查失败。 (verification: typecheck; owner: contract implementer)
- AC9 — 任务和执行分页满足条数/字节限制，因大小缩页不跳项，拒绝非法或范围不匹配的 cursor，并明确返回不可拆分单项超限错误。 (verification: unit + RPC; owner: remote implementer)
- AC10 — 真实类型化 RPC 客户端在重连后通过 task/run/session/message API 访问定时任务结果；发布包与现有移动端发现路径分别验证。 (verification: RPC + device + package; owner: integration implementer)

## Risks

现有任务查询在切片前扫描候选 schedule；本文限制响应大小，但不承诺 SQL 层任务分页。并发编辑时 offset 分页可能重复或遗漏，需要刷新。新主机为旧客户端恢复发现，但新的 Task 方法需要主机已实现对应接口，不承诺任意版本组合互通。

执行历史可能被清理而会话仍保留，多个 run 也可能共享一个会话。这些是明确的 API 结果，不能因此捏造缺失记录。包发布与移动端/真机验证属于完成证据，不能由桌面构建成功推定。

用户于 2026-11-12 在本会话中批准本地实现。本文保持 proposed，等待仓库评审和交付流程；本地验证不代表协议包已经发布或移动真机已经验收。
