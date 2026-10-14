---
description: Proposed remote-protocol files and Desktop function contracts for RPC dispatch, atomic admission, journals, checkpoints, and lifecycle ownership
sources:
  - src/main/features/apiGateway
  - src/main/ai/streamManager
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/data/services
  - src/main/data/db/schemas
---

# Remote Protocol and Desktop Implementation Design

> **状态：Desktop LAN 直连已实现（不含中继与 Mobile）。** 本文细化文件、函数和资源所有权；签名省略
> imports 和部分 DTO。网络契约以 [API 设计](./remote-agent-access.md) 为准，部署与授权以
> [架构方案](../api-gateway/remote-agent-access.md) 为准；场景编号对应 [时序图](./remote-agent-sequences.md)。
> 实现落点见 `src/main/services/remoteAccess/README.md`；与本文件清单的差异（合并的文件、
> 回执与预留未在同一事务、消息态审批不进增量流）在该 README 中列出。

本地 WebSocket client 的测试链路、场景矩阵与通过标准见
[测试规范](./remote-agent-testing.md)。

旧 PR #20717 的原型代码已备份并从工作树撤下；本文保留目标设计。`remoteAccess`、
`RemoteCommandService` 及原型新增的 owner 接口均需重新实现，不能视为现有基线能力。

## Design boundaries

按已确认的[共用基础设施决策](../api-gateway/remote-agent-access.md#shared-infrastructure-for-configuration-transfer-and-agent-access)，
provider/model 配置传输与 Agent 复用下述连接、配对、设备身份、认证、加密、RPC 与中继入口。
配对成功前一次确认允许的业务能力；配置传输适配器调用 provider/model 数据 owner，
不依赖 Agent 的 journal/checkpoint/执行回执。本文文件清单仍是 Agent 部分，配置传输的
业务契约、统一配对结果及旧 HTTP 导出迁移策略需补齐后才能冻结协议。

最小实现保留一个公共包和现有 Desktop 服务边界：

- `remote-protocol` 定义可验证的数据与纯变换，不管理连接、重试、数据库或密钥。
- Gateway 拥有 HTTP/WS 入口；`RemoteAccessService` 拥有远程连接、授权编排和有界恢复资源。
- `AiStreamManager` 与 runtime/approval 所有者拥有执行状态、流式通知、准入和竞争裁决。
- 数据服务拥有持久化事实；远程命令回执和执行预留必须参加同一个 SQLite 事务。

优先复用现有 `StreamListener` 和 `addListener()`；后者注册后同步回放 buffer。
原型中的 `observeTopic()`、`getTopicSnapshot()` 和 `commitAgentMessage` 已随旧代码撤下，
它们仅作为状态观察、快照和事务组合的设计参考。先通过接入/回放/跨执行测试定位缺口，
再对 owner 接口做最小扩展；不预设新的 session 事件模型，不把 snapshot 当完整增量日志。
不能把 `dispatch()` 的排队/steer 行为直接当作 v1 的 idle-only send，也不在 remoteAccess
加第二套执行锁。

以下目录是第一版目标清单，按交付步骤创建，不先建空目录。文件名遵循
[命名规范](../architecture/naming-conventions.md)，依赖遵循 [Main 架构](../architecture/main-process.md)。

## Package files and exports

```text
packages/remote-protocol/
├── package.json                  # 只开放 . 与 ./agent；发布 JS、声明和 fixtures
├── README.md                     # 版本矩阵、导入示例、语义边界
├── src/
│   ├── index.ts                  # common 的显式 re-export
│   ├── agent.ts                  # ./agent 的显式 re-export，无初始化逻辑
│   ├── jsonRpc.ts                # 标准 envelope schema；区分缺失 id 与 null
│   ├── connection.ts             # hello、auth、pairing 的 schema 工厂
│   ├── errors.ts                 # RemoteFailure 与应用错误校验
│   ├── negotiation.ts            # 完整协议版本的交集选择
│   ├── encoding.ts               # 私有 JCS 适配、十进制与 UTF-8 基础操作
│   └── agent/
│       ├── resources.ts          # 设备授权、session、execution、message、part、interaction
│       ├── methods.ts            # 请求/结果/error details 的唯一 schema map
│       ├── events.ts             # 增量事件、通知、cursor、projection schema
│       ├── checkpoints.ts        # checkpoint DTO、规范编码与完整安装
│       ├── reducer.ts            # 连续批次应用、前置条件与内容完整性
│       └── commands.ts           # mutation 类型集合、receipt、规范命令编码
├── fixtures/                     # JSON 输入、独立预期结果、兼容性向量
└── tests/                        # 按上述函数/契约命名，不是网络集成环境
```

`src/agent.ts` 是 package subpath 的具名入口，不再增加 `agent/index.ts` 或嵌套 barrel。
`package.json.exports` 封闭深层导入；仓库内部也检查 root→agent 的反向依赖及相对路径绕过。
`agent/*` 可以引用 common 叶子文件，不能经 root barrel 回绕。root 不导出 Agent 的事件联合。

Schema 使用单一运行时校验实现并推导 TS 类型；沿用仓库已有 Zod 技术栈，具体版本与打包
格式在 Node/Expo packed-artifact 验证后锁定。`agentMethods` 保持 API 文档已有的
`{ params, result, errors }` 形状；Desktop 的调度优先级和 handler 不放进公共包。

### Common functions

```ts
type ProtocolSupport = { protocolVersions: readonly number[] }
type ProtocolOffer = { protocolVersions: readonly number[] }
type ProtocolSelection = { protocolVersion: number }

function negotiateProtocol(
  local: ProtocolSupport,
  remote: ProtocolOffer
): NegotiationResult

type NegotiationResult =
  | { ok: true; selection: ProtocolSelection }
  | { ok: false; error: RemoteFailure }

function connectionMethods<A>(authorizationSchema: RuntimeSchema<A>): ConnectionMethodSchemas<A>
function pairingMethods<A>(authorizationSchema: RuntimeSchema<A>): PairingMethodSchemas<A>
```

`RuntimeSchema<T>` 是本文对实际 schema 类型的简写，不新增一个通用 schema 框架。
`ProtocolSupport/ProtocolOffer` 只列出完整实现过的协议版本，首版为 `[1]`；运行时 schema
约束为非空、有界、正整数列表。`negotiateProtocol` 选择最大公共版本，无交集则返回
`UPGRADE_REQUIRED` 与 `supportedProtocolVersions`。不再组合 wire/domain 版本或 capabilities。
客户端检查返回版本在自己的 offer 内，且与安全握手绑定值一致。这个纯函数不读取应用版本
号或时钟；不同 Mobile/Desktop release 只要共同支持完整 v1 就可以互通。

一个协议版本对应一组方法/schema/reducer/命令编码语义。首版只实现 v1，后续明确要兼容旧版
时才添加旧版适配和真实旧包 fixtures，不预建版本插件框架。支持旧版必须保持旧版结果与事件
语义，不能仅把版本号改成 1。新增必需语义升协议版本；只有实际出现可选功能才另行设计能力协商。
详见 [版本兼容规则](./remote-agent-access.md#protocol-version-compatibility)。

JSON-RPC 请求关联与派发复用成熟库；包里的 `jsonRpc.ts` 只定义标准结构校验，不实现 RPC engine。
[JSON-RPC 规范](https://www.jsonrpc.org/specification) 是 envelope/batch/notification 的依据；
[json-rpc-2.0](https://github.com/shogowada/json-rpc-2.0) 仍只是候选，需验证本项目的配额、错误、
关闭清理与激活响应顺序后才能采用。已有库能力不足时先评估适配点，不复制整个引擎。

### Agent functions

```ts
type AgentMutation =
  | 'agent.sessions.create'
  | 'agent.messages.send'
  | 'agent.executions.cancel'
  | 'agent.interactions.respond'

type IntegrityPrimitives = {
  sha256(bytes: Uint8Array): string
}

function encodeAgentCommand<M extends AgentMutation>(
  method: M,
  params: AgentParams<M>
): Uint8Array

function encodeAgentCheckpointPage(page: AgentCheckpointPage): Uint8Array

function applyAgentEvents(
  projection: Readonly<AgentProjection>,
  batch: AgentEventBatch,
  materializedContent: MaterializedContent,
  integrity: IntegrityPrimitives
): ApplyAgentEventsResult

function installAgentCheckpoint(
  descriptor: AgentCheckpointDescriptor,
  pages: readonly AgentCheckpointPage[],
  materializedContent: MaterializedContent,
  integrity: IntegrityPrimitives
): InstallAgentCheckpointResult
```

`AgentMutation`、`AgentEventBatch`、checkpoint 类型及结果联合从 schema 推导，随 `/agent` 导出。
`IntegrityPrimitives` 定义在 common 并由 root 导出；调用者注入经验证的**同步、确定性** SHA-256
实现，包本身不实现密码算法或依赖 Node crypto。密钥、签名和安全通道不在这个接口里。
这是对原 API 草案中“校验摘要但不内置 crypto”的具体补全，不是 wire 字段变化。

| 函数 | 输入/输出边界 | 失败保证 |
|---|---|---|
| `encodeAgentCommand` | 校验后的原始 named params；JCS 编码 `{ method, paramsWithoutCommandId }` | 不补默认值，不做 Unicode 归一化；方法和全部前置条件参与身份 |
| `encodeAgentCheckpointPage` | 编码页面 body，排除 `pageDigest` | 页面顺序与 item 顺序确定，不依赖对象插入顺序 |
| `applyAgentEvents` | 完整有界批次 → 新 projection/cursor，或 `gap/epoch/revision/content` | 失败不改变输入、不推进任何游标；重复前缀跳过后校验连续后缀 |
| `installAgentCheckpoint` | 全部页面、所需 live baseline → 新 projection/cursor | 缺页、重复页、关系不完整、长度或摘要不符均拒绝整体安装 |

`MaterializedContent` 按 `contentId + revision` 索引，条目含 bytes 与声明的摘要/长度；函数校验
实际 bytes。调用者按描述符限制总字节数，再收集所需内容；函数不 fetch、不读文件、不访问
数据库。成功后的持久化属于 Mobile，Desktop 也用相同 fixtures 校验输出能被还原。
纯函数可以在有界调用内创建局部 hash/decoder 状态，不保存跨连接的全局状态。

活跃文本使用稳定 part ID 与 UTF-8 offset；禁止用数组下标或每个 token 的全量 JSON diff。
`part.completed` 的摘要从已物化文本验证。当前执行在 finalizing 期间仍保留完整基线，
收到 durable `history.committed` 和执行终态后才可释放 overlay。已归档消息不再接收
message/part 增量；历史更新只使缓存失效并按需重读，不用创建事件表示重新加载。
续传缺少本地实时基线或连续日志时，停止推进 cursor/ACK，关闭旧订阅并不带 cursor
重新订阅，统一恢复 checkpoint；不新增历史精确版本补齐、消息级补洞或 upsert 机制。
以 [v1 实时与历史边界](./remote-agent-access.md#v1-livehistory-boundary) 为准。
大型 checkpoint 的分阶段验证先留在调用方；暂不抽象成通用同步 SDK。

## Desktop file organization

```text
src/main/features/apiGateway/
├── ApiGatewayService.ts          # 既有：listener 启停与 LAN serving 状态
├── server.ts                     # 改造：同一 listener 的 WS upgrade 接入/关闭
├── app.ts                        # 改造：remote route 隔离于 provider-key guard
└── routes/remoteAgent.ts          # 改造：/v1/remote/connect 薄入口

src/main/services/remoteAccess/
├── index.ts                      # 对外只导出 service 与必要入口类型
├── README.md                     # 改写为新所有权与依赖说明
├── RemoteAccessService.ts        # 远程资源总所有者，沿用既有 lifecycle 注册
├── connection.ts                 # 每连接状态、generation、有限队列与清理
├── secureChannel.ts              # 所选安全协议库的 Desktop 适配
├── identity.ts                   # 既有身份存储适配；不可因换端口换身份
├── rpc.ts                        # JSON-RPC 库适配、预算、响应屏障、错误净化
├── connectionHandlers.ts         # hello / authenticate / refresh / ping
├── pairing.ts                    # invitation/claim/本地批准与 key 绑定
├── authorization.ts              # 设备授权开关/代次、密钥绑定、过期与资源归属检查
├── agentHandlers.ts              # 穷尽的 method→handler 映射，薄派发
├── agentQueries.ts               # 资源查询与授权后 DTO 投影
├── agentCommands.ts              # durable command 身份、事务组合、回执
├── RemoteAgentListener.ts        # 实现既有 StreamListener，只适配流式与终结回调
├── agentProjection.ts            # 既有 chunks/状态/审批通知 → Agent wire event/DTO
├── agentJournal.ts               # session/protocolVersion epoch、连续 seq、有界保留
├── agentSubscriptions.ts         # prepare/activate/ack/close 与发送额度
├── agentCheckpoints.ts           # 不可变页、内容 pin、摘要、lease
├── agentContent.ts               # revision-pinned 内容与有界分页，无任意路径
└── __tests__/                    # 按契约验证，而非按 helper 数量建测试
```

这些小写文件是普通函数及私有状态类型；连接和 journal 记录由 `RemoteAccessService` 创建和销毁。
它们不注册独立的全局监听器/定时器，不建立 manual singleton。首版不为每张时序图或每个
method 建一个 Service。以后某一职责需要独立启动/停止时，再按 lifecycle 规则拆服务。

### Gateway and lifecycle contracts

```ts
interface RemoteAccessService {
  acceptConnection(peer: RemoteSocket): Disposable
  createInvitation(input: LocalInvitationInput): Promise<LocalInvitation>
  decidePairing(claimId: string, decision: LocalPairingDecision): Promise<void>
  revokeAgentAccess(deviceId: string, expectedGrantId: string): Promise<void>
  pause(): Disposable
  drain(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }>
}

type RemoteSocket = {
  send(record: Uint8Array): Promise<void>
  close(code: number): void
  onRecord: Event<Uint8Array>
  onClosed: Event<void>
}
```

这是 Desktop 内部适配接口，不是第三个公共包入口。Gateway 负责协议升级与初始字节/连接
上限；`acceptConnection` 在未 ready、停服或 backup pause 时拒绝接入。当前 Node Gateway
使用 Elysia 适配层，实施时先验证它的 WS upgrade 支持；必要时把 `ws` 的 upgrade 接在现有
listener 上，不能回到第二端口。框架选择不改变此服务边界。

Gateway 的 route 先检查应用已完成 bootstrap，再通过
`application.get('RemoteAccessService')` 解析服务并检查其 ready/active 状态；未就绪时拒绝。
拟新增的 RemoteAccessService 按非 conditional 服务注册，不能用 `getOptional()` 掩盖启动顺序。
Gateway 不声明对 RemoteAccessService 的生命周期依赖，避免
与后者拟声明的 `@DependsOn('ApiGatewayService')` 形成启动环。Remote 依赖同阶段的执行
所有者；BeforeReady 的 Db/Preference/Cache 不加 `@DependsOn`。

Remote 的 `onInit` 注册 Gateway 状态、设备授权变更、Agent ingress、统一 sweep；用
`registerDisposable/registerInterval` 管理。`onActivate` 加载身份并允许接入；`onDeactivate`
先停止接入，关闭 channel，再清理订阅、checkpoint、observer 和 key material。`pause/drain`
只控制远程入口与已准入任务的交接，执行的停止/排空由 AgentLifecycleService 统一协调。
普通 socket 断开不会取消已准入 Agent。服务引用用 `application.get()`，日志用 loggerService，
新增磁盘路径经 `application.getPath()` 注册，不能让 helper 自行创建资源目录。

`createInvitation/decidePairing/revokeAgentAccess` 仅供可信本地 UI 的 IpcApi handler；不加入远程
JSON-RPC method map。持久化设备授权经现有 paired-device 数据 owner 查询，配对动作不伪装成 DataApi。

### Per-connection dispatch

```ts
function createConnection(peer: RemoteSocket, deps: ConnectionDependencies): RemoteConnection
function receiveRecord(connection: RemoteConnection, record: Uint8Array): Promise<void>
function dispatchRpcRecord(connection: RemoteConnection, plaintext: Uint8Array): Promise<void>
function closeConnection(connection: RemoteConnection, reason: CloseReason): void

type RpcCallContext = {
  connection: RemoteConnection
  afterReply(commit: () => void, abort: () => void): void
}

type AgentHandlers = {
  [M in AgentMethod]: (ctx: RpcCallContext, params: AgentParams<M>) => Promise<AgentResult<M>>
}
```

依赖对象仅组合真实依赖：安全库适配、RPC 库实例、身份/授权操作、Agent handlers、clock；
不是可加载插件注册表。handler 表用 `satisfies AgentHandlers` 检查穷尽性，schema 从包导入，
不在 `protocol.ts` 复制第二份。同步查询由 async handler 包装，不把 SQLite 查询改成异步。

`receiveRecord` 的顺序是：密文尺寸/状态校验 → 安全库认证解密 → UTF-8/JSON 解析 →
标准 envelope 校验 → 方向/连接状态 → method schema → 当前授权 → 预算 → handler →
result schema → 编码/加密 → 单 writer 发送。每个阶段都有明确错误边界，密文认证失败直接
关闭；内部异常记录到本地，回包不含 stack、路径或 provider 信息。

每连接拥有 `secured/negotiated/authenticated/expired/closed` 状态与递增 generation；旧
异步任务可结束其已准入工作，但不能在新连接发送结果。RPC pending 被清理不等于撤销业务。
`RemoteSocket.send()` 只表示写入按序传输队列成功，不代表手机收到或落盘；单 writer 同时
负责框架 buffered bytes 与应用队列上限，不能把队列转移到底层后宣称内存已释放。

Batch 先做 bounded admission/preflight，再交由库派发。输出总预算在副作用前预留，不能
等执行完成才发现响应数组超限。所有 request-only 方法收到 notification 都在副作用前丢弃，
不回错误。bootstrap 状态按接收记录时判断，不能靠同一 batch 里先 hello/auth 后业务偷渡。
有效 request 中的 `id: null` 仍是请求；无 id 才是 notification。

`afterReply` 是 adapter 的局部提交屏障：单请求回复或包含它的 batch 响应全部入 writer 后，
才 commit 对应 activation；发送失败就 abort、释放准备资源。它不用于启动业务命令。
控制响应与 bulk pages 分队列调度，但同一订阅事件顺序不可打乱；已经写出的字节无法抢占。

### Authorization and pairing

```ts
function authenticateConnection(conn: RemoteConnection, input: AuthenticateParams): Promise<AuthContext>
function refreshConnection(conn: RemoteConnection): Promise<RefreshResult>
function authorizeSession(auth: AuthContext, sessionId: string, tx?: DbOrTx): AuthorizedSession
function authorizeCommand(auth: AuthContext, stored: StoredCommand, tx?: DbOrTx): void
function claimPairing(peer: ProvenPeer, input: PairingClaimParams): Promise<PairingClaimResult>
```

`AuthContext` 包含服务端证明过的 device/key/grantId（授权代次），不来自 params 的自报身份。
access token 必须对应当前设备的 enabled 代次；每次命令事务、读取以及待发事件写出前重检。
`authorizeSession` 不接收 view/send/approve 参数，也不查资源 allowlist：检查设备授权后，
再检查 session 存在、属于本 Desktop 的 Agent 资源且满足操作所需 lifecycle/runtime 条件。
content/interaction/message 还必须属于请求指定的 session，不能用不匹配的 ID 绕过关联校验。
`authorizeCommand` 检查回执属于当前 device+grantId，再检查它引用的资源；不再有“原始动作权限”。

配对使用既有 `ApiGatewayPairedDeviceService` 保存证明过的 public key 与可空的
`agentRemoteAccess: { grantId, status: 'enabled' | 'revoked' }`。没有独立授权表/服务或 scope/
capabilities/revision 字段；原有 provider token 保持独立，不自动打开 Agent 开关。
初次批准和撤销后的再次批准分配新 grantId；已 enabled 的重复批准保持原代次。更换设备 key
需要新的本地确认并生成新代次。claim 仍按 invitation/device key 幂等、单 claimant、限时回收。

本地 `revokeAgentAccess` 对 deviceId+expectedGrantId 做条件更新，防止迟到的旧操作影响新代次。
撤销先持久化，再关闭对应连接、丢弃未写出的内容并释放订阅；无需删除 paired-device 记录或
撤销其 provider 权限。已经准入的动作仍由执行 owner 收尾，不冒充自动取消。重新批准后，
旧 token、页面、订阅和 pending command 不能更换 grantId 自动继续。安全库/令牌格式仍待验证。

## Execution-owner contracts

在现有模块内增加/修改下列落点；不新建顶层 `remote/` 或第二个 Agent runtime：

| 文件 | 拟改动 | 谁调用 |
|---|---|---|
| `ai/streamManager/AiStreamManager.ts` | 复用 listener，按需新增 observe/snapshot；仅补测试证实的回放完整性或跨执行接入缺口；既有 topic 锁仍是唯一准入锁 | remote adapter、本地执行入口 |
| `ai/streamManager/api/commitSessionCommand.ts` | 把事务预留与提交后的 activation 组合到既有锁 | manager 的委托实现 |
| `ai/streamManager/context/agentSubmission.ts` | 新增同步 reserve 接口，参考已撤下的原型；明确 idle-only 准入 | commitSessionCommand、既有 dispatch |
| `ai/agentSession/AgentSessionRuntimeService.ts` | activation/recovery/approval 的通用接口 | stream owner |
| `ai/streamManager/persistence/*` | 提交后发布 durable history revision；失败不冒充 terminal success | 执行终结流程 |

类型仅在 main 使用就留在这些模块内；真正跨 main/renderer 的通用事实才进入现有
`src/shared/ai/transport`。它们不得引用 `remote-protocol` 的 wire DTO 或 remoteAccess。

### Reuse existing stream observation

`RemoteAgentListener` 实现现有 `StreamListener`，由 RemoteAccessService 管理，一个共享
session/protocolVersion journal 挂接一个适配 listener，不为每个手机重复监听和投影。

| 基线接口 / 拟补充通知 | Remote adapter 的用途 | 边界 |
|---|---|---|
| `addListener(topicId, listener)` | 接入已有流，同步接收 buffer replay 和之后的 `onChunk` | 只对当前存在的 stream 有效；buffer 可能已淘汰，boolean 成功不代表完整回放 |
| `StreamListener.onChunk` | 将增量转换成协议事件，保持内容与 message/part/execution 身份 | 不直接把内部 `UIMessageChunk` 暴露给手机 |
| `onDone/onPaused/onError`、terminal phases | 跟随既有终结与持久化顺序，发布对应远程状态 | 验证实际持久化成功后才能发布 durable terminal；EOF 不等于提交 |
| `observeTopic` + `getTopicSnapshot`（拟补充） | 状态通知、首次状态读取和新 execution 接入检测 | observer 注册后立即同步调用；快照不携带完整有序增量，不能周期 diff 全文 |
| runtime 的 `onSessionInteractionsChanged`（拟补充） | 更新审批摘要，完整输入按需读取 | 不能假定每个审批变化都必然产生文本 chunk |
| `removeListener` / observer `dispose` | 清理适配器挂接 | 网络单连接断开与共享 journal 的寿命分开管理 |

目标 snapshot/replay 的组合需要先证明以下契约，再确定是否扩展现有函数的返回信息或挂接
时机；本文不预定新的 capture 方法、baseline/change 类型族或额外 owner revision：

1. **接入已有执行。** 回放完整时从它建立投影并衔接后续 chunks；不要把同一段内容既作为
   snapshot 又 replay 一遍。接入、状态读取和回放之间的变化必须不丢不重。
2. **回放不足。** buffer 淘汰或初始状态不完整必须显式识别；用 owner 的权威状态/持久化历史
   建立一致基线并接上后缀，随后建立新 journal。若现有接口无法证明这一衔接，应先在 owner
   补最小的一致性边界；不能从剩余 buffer 伪造完整内容，也不能靠重试循环掩盖永久缺口。
3. **跨执行与空闲会话。** 没有 active stream 时 `addListener` 失败是正常状态；保留适配层
   的 topic/runtime 观察。新执行开始时重新挂接，覆盖第一条 chunk；旧 listener 不重复回放，
   新 execution 保持独立身份。观察发现得晚且 buffer 已淘汰时进入上一项恢复路径。
4. **状态和持久化。** runtime 审批、session 元数据、最终历史提交沿用各自已有通知/数据 owner；
   检查它们与 chunk/terminal 的先后关系，仅针对漏通知或错误顺序扩展对应 owner。

所有初始内容和恢复步骤完成后，remote adapter 才把投影认定为完整。Checkpoint C 和 C 之后
的日志后缀在 remote journal 的同一发布边界固定，不能先异步读一份状态再无条件开始续传。
这是必须证明的行为，不要求新增某个特定方法。实现不能简单假定 snapshot 与 buffer 天然对齐。

wire epoch/seq 由 remote journal 分配；回调只做有界投影/接纳，不等待网络。溢出或映射失败
使相关恢复流 reset，不阻塞 Agent、不静默跳过事件。优先复用已有稳定 message/part/execution
标识；确有缺口再在所属 owner 补齐，不能每次 checkpoint 重新编号。需要改变持久化格式时
仍须追加 migration 并验证旧数据。

### Transactional command admission

```ts
interface AiStreamManager {
  commitSessionCommand<T>(
    sessionId: string,
    commit: (tx: DbOrTx, session: SessionCommandAccess) => T
  ): Promise<T>
}

interface SessionCommandAccess {
  reserveSend(input: { text: string; expectedIdleRevision: string }): Admission<RunReservation>
  reserveCancel(input: { expectedExecutionId: string }): Admission<CancelReservation>
  reserveDecision(input: InteractionDecisionPreconditions): Admission<DecisionReservation>
}

type Admission<T> = { ok: true; reservation: T } | { ok: false; failure: SessionCommandFailure }
```

这是基于既有 `withDispatchLock()` 的目标接口；事务组合需重新实现，可参考已撤下的
`commitAgentMessage` 原型，不引入另一把锁。
owner 获得 topic 锁、等前次 terminal persistence 收尾、完成必要异步准备后，打开一个同步
`withWriteTx` 并调用 `commit`。callback **禁止 async/Promise**，实现需静态约束并拒绝 thenable。
`SessionCommandAccess` 只在 callback 内有效，捕获它供以后使用是错误。所有前置条件在最终
同步 reserve 时重检，不能信任异步准备之前的授权或 idle 状态。

callback 的先后顺序固定为：当前授权 → 原 command 查询/identity 对比 → 存在则返回原回执 →
不存在才调用 reserve → 保存 accepted 或 rejected 回执。reserve 将 session/execution/message
或控制动作的 durable intent 写入同一个 tx；拒绝是值，不能用异常把 rejected receipt 回滚。
异常则整体回滚，内存预留也不发布。事务成功后 owner 才发布预留状态并接管 activation；
网络 handler 返回/断开都不会取消这个交接。

本地 UI、scheduler、delivery 和 remote 都必须识别此预留，不能只看 `hasLiveStream()`。
取消和审批调用其**现有**所有者，加入 expected execution/revision/digest 比较与同一竞争
裁决边界；不让 remote 自己维护 approval pending 状态。锁只覆盖准入和必要交接，不持有到
整次生成结束，也不能在已持锁时调用会再次获取同一锁的 `dispatch/abortAndDrain`。

owner 将 activation 标记持久化为 `reserved → activating → applied`，调用外部 runtime 之前
先提交 `activating`。重启后仅能证明从未激活的 reserved intent 可重新接管；activating 状态
不确定则中断并更新回执，不能重跑工具。授权已撤销的未激活工作不得在恢复时复活。
执行 intent 与 remote receipt 通过 opaque reservation ID 关联；owner 发布通用完成事实，
remote 数据恢复再核对回执，AI 不更新 wire receipt。启动时核对完成之前不开放远程写入口。

## Command and data functions

```ts
async function sendMessage(ctx: RpcCallContext, input: AgentParams<'agent.messages.send'>) {
  const identity = encodeAgentCommand('agent.messages.send', input)
  return application.get('AiStreamManager').commitSessionCommand(input.sessionId, (tx, session) => {
    const auth = requireCurrentAuth(ctx.connection)
    const resource = authorizeSession(auth, input.sessionId, tx)
    const key = { deviceId: auth.deviceId, grantId: auth.grantId, commandId: input.commandId }
    const existing = remoteCommandService.findMatching(tx, key, identity)
    if (existing) return toCommandReceipt(existing)
    const admission = session.reserveSend(input)
    return toCommandReceipt(remoteCommandService.recordAdmissionTx(tx, key, identity, resource, toStoredAdmission(admission)))
  })
}
```

示例中的 store 接口接收由 adapter 映射的持久化 DTO；不得从 `data/` 反向导入
`SessionCommandAccess`、remote handler 或运行时服务。`identity` 是已校验、未填默认值的原始
params 规范编码，存储摘要并保留恢复所需字段/规范版本；RPC id 从未参与它。

| 数据落点 | 目标函数或约束 |
|---|---|
| `data/services/RemoteCommandService.ts`（新增） | `get(key, tx?)`、`findMatching(tx, key, identity)`、`recordAdmissionTx(...)`、`settleTx(tx, key, expectedStatus, outcome)`、`compactTerminalTx(...)` |
| `data/db/schemas/remoteCommand.ts`（新增） | PK 使用 device+grantId（授权代次）+command；identity、method、resource、reservation、状态与最小结果；tombstone 保留身份和终态 |
| `data/services/ApiGatewayPairedDeviceService.ts`（扩展既有） | 扩展 `get` 支持 `get(deviceId, tx?)`；增加 `enableAgentAccessTx(tx, deviceId, provenKey)`、`revokeAgentAccessTx(tx, deviceId, expectedGrantId)`；同步数据库操作，无独立 RemoteGrantService |
| `data/db/schemas/apiGatewayPairedDevice.ts`（扩展既有） | 增加设备 public key 绑定及可空 `agentRemoteAccess`（grantId、enabled/revoked）；不建 remoteGrant 表，不存明文 token/私钥，不加资源权限列表 |
| 现有 session/message/interaction 数据 owner | `reserve…Tx`、activation intent、稳定执行/part 标识、终态与 history revision；按所属领域扩展 |

`settleTx` 是状态前置条件更新，不允许已终态回执被迟到 callback 覆盖。`sessions.create`
没有既有 session 锁，在一个同步数据库事务中完成授权、dedupe、创建和回执。cancel/respond
使用与 send 相同 command 包装，但调用不同 reserve；不能为了统一代码隐藏它们的语义差异。
所有 mutation 的 handler 都是显式函数，首版不抽象通用 command bus。

`agentQueries.ts` 的显式函数为 `listAgents/listWorkspaces/listSessions/getSession/listMessages/
listParts/listInteractions/getInteraction/getCommand`；`agentContent.ts` 提供 `readContent`。
分页 token 绑定 device+grantId、session/query/filter/history revision 和到期时间；先检查设备
授权与资源有效性，再分页。live 内容引用归 checkpoint/journal pin 管理，durable 内容归原数据 owner；客户端
只能用 opaque content ID 读取，不能指定绝对路径。大值按字节预算分页，base64 膨胀也计入回包。

所有 schema 变更通过追加 migration，带真实已填充数据库升级测试。旧回执没有授权代次时不能
自动赋予新 Agent 授权；明确撤销旧远程授权并要求重新批准，同时迁移/归档旧记录。恢复备份也先
撤销旧 authority，再接受新命令，避免回滚的 dedupe 历史重新执行旧动作。

## Journal, checkpoint and subscription functions

```ts
function appendEvents(stream: AgentJournal, events: readonly PendingAgentEvent[]): void
function prepareSubscription(conn: RemoteConnection, input: SubscribeParams): Promise<SubscribeResult>
function readCheckpoint(conn: RemoteConnection, input: CheckpointReadParams): CheckpointPageResult
function prepareActivation(conn: RemoteConnection, input: ActivateParams): PreparedActivation
function acknowledge(conn: RemoteConnection, input: AckParams): AckResult
function closeSubscription(conn: RemoteConnection, subscriptionId: string): void

type PreparedActivation = {
  result: ActivateResult
  commit(): void
  abort(): void
}
```

`PendingAgentEvent` 是 remote 内部尚未分配 seq/revision 的协议事件草稿，沿用公共事件的
kind/payload 结构；不是新增的执行层事件体系，也不进入 AiStreamManager 的公开接口。

`agentJournal.ts` 保存 `(sessionId, protocolVersion)` 的 epoch、当前 projection、最新 seq 和共享环形日志；
`agentSubscriptions.ts` 保存连接私有的 phase、prepared cursor、lastSent、lastAck、字节额度、
lease 和共享日志引用。`agentCheckpoints.ts` 拥有不可变 pages/content pins；没有每个订阅的
完整事件副本。所有 registry 是 service 实例字段，卸载释放；重建日志必须换 epoch。

| 操作 | 原子点与行为 |
|---|---|
| `appendEvents` | 相邻兼容 append 可在小延迟窗口内合并；flush 后才分配 revision/seq。先验证新投影和预算，再发布不可变事件，不重写已发布记录 |
| `prepareSubscription` | 锁定共享 stream 状态，flush 待合并事实，读取 H 并保留完整后缀；不可回放则在同一屏障捕获 C 的 checkpoint 与 C 后事件 |
| `readCheckpoint` | 验证连接/授权/lease；返回固定 pageIndex/body/digest。分页读取不延长 lease，也不改变 checkpoint 内容 |
| `prepareActivation` | 校验 prepared cursor 与完整 reservation；不立即发送事件。占用相应输出屏障并返回 commit/abort |
| activation `commit` | 回复已写入后再次检查连接/授权/保留窗口，切为 active 并 pump 连续后缀；已失效则 reset/close，不能发送不完整后缀 |
| `acknowledge` | 验证 session/epoch，`lastAck ≤ cursor ≤ lastSent`；只释放累计已发送字节额度，不删除共享 replay 窗口 |
| `closeSubscription` | 同连接重复关闭安全；解除 pin/credit/queue。连接外的 ID 无权操作；断线统一调用 |

激活期间先锁定 prepared→activating 转换，重复 activate 返回冲突，不能安装两次回调。
如果响应发送后、commit 前恰好发生撤销/日志淘汰，成功响应后紧接 reset/close 是合法恢复路径；
绝不能因此跳过缺失事件。batch 场景由 `ctx.afterReply` 把整批响应和 commit 顺序连接起来。

追加事件时，`RemoteAgentListener` 接收既有 stream callbacks，`agentProjection.ts` 将 chunks、
已验证的初始状态和各 owner 通知转换成当前协议版本的 DTO；方法按来源拆为 `projectChunk`、
`projectInitialState`、`toSessionSummary`，只携带有界审批摘要。同一 epoch 的内容对所有
启用授权的订阅者一致；所有这些设备都可按需读取完整审批详情，不再分 approve-only 权限。最终持久化顺序必须是事务提交 →
`history.committed` → execution terminal；EOF 仅进入 finalizing。

prepare 的锁是短暂的**投影发布屏障**，不等待网络或大对象读盘。已有 journal 的捕获来自
其一致 projection，新 journal 通过上述 listener 接入与基线恢复路径初始化。初始化没有证明
完整之前不得发布成功的 checkpoint。页面编码/摘要在固定的 projection 上进行，期间 pin 和准备缓冲受全局预算限制；预算不足显式失败，不把 Agent 的生成锁住。
内存不足或观察出错时 reset 受影响订阅并重建 epoch；不得悄悄丢事件后继续原 seq。

统一 sweep 负责 invitation/token/prepare lease/journal 淘汰；活动订阅不续期 preparation lease。
已激活后释放 checkpoint pins，保留共享 journal 的正常窗口。慢客户端只暂停自己的 pump；
若后缀被淘汰则 reset，不能拖住执行者或健康订阅。ACK、控制请求和事件输出分别计费，
ACK 不能被它正在释放的 event credit 阻塞。

## Replacement map and implementation slices

| 已备份并撤下的原型文件/机制 | 重写后落点 |
|---|---|
| `protocol.ts` | 公共包 schemas；Desktop 只保留 handler policy |
| `requestRouter.ts` | `rpc.ts` + `connectionHandlers.ts` + `agentHandlers.ts` |
| `server.ts` 的独立 listener | Gateway 的单 listener upgrade；连接状态归 `connection.ts` |
| `RemoteAgentSubscription.ts` 的周期 snapshot | journal + subscriptions + checkpoints；共享 session/protocolVersion epoch |
| `messageProjection.ts` | `agentProjection.ts` 的稳定增量映射 |
| `messageDetails.ts` / `artifactAccess.ts` | `agentQueries.ts` / `agentContent.ts` 的 opaque revision-pinned reads |
| provider token 即 Agent 身份 | 设备 key proof + 本地批准的 Agent 开关与授权代次；旧 token 不沿用授权 |

按已确定的架构交付阶段进一步拆成可验证切片：

| 切片 | 完成内容 | 必须能证明的行为 |
|---|---|---|
| 1. 包 | common 与 Agent schemas、编码、reducer、fixtures、packed artifact | 两端消费同一产物；Unicode/JCS/批次/完整 checkpoint；无平台依赖泄漏 |
| 2. 执行观察 | 既有 listener/observe 接入、缺口修复、稳定 ID、projection/journal | S03/S04：捕获与第一事件无缺口；输入/输出/替换完整重建 |
| 3. durable command | owner reserve/activate、paired-device 授权字段/receipt/intents 迁移 | S05/S07/S09/S10：重复 ID 不重执行；各事务/崩溃点；本地竞争同锁 |
| 4. 有界恢复 | checkpoint、prepare/activate/ack、容量与 sweep | S06/S08/S12：仅落盘 cursor 能恢复；错误 ACK 不释放信用；慢端不拖累执行 |
| 5. 安全入口 | 已审核安全 profile、单 Gateway route、pairing/auth、RPC adapter | S01/S02/S11：版本不符拒绝、旧 token 无权限、撤销不再输出、batch 响应先于事件 |

这些是实现后的验收要求，本次仅完成设计与文档检查。代码测试使用现有 main wrapper；数据
测试用 `setupTestDatabase()`，事务失败/重启测试不得 mock Drizzle 链。增量 fixtures 的预期
文本、offset、摘要应独立计算，不能由被测 reducer 自己生成期望值。WebSocket/RPC 候选库
先走内存或 loopback harness；真实加密与 Expo 互通通过前不开放新网络入口。
