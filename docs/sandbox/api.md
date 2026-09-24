---
description: 沙盒 API 草案，定义宿主进程控制、权限策略、后端契约和 Node/Python 双向 RPC 协议
status: draft
date: 2026-09-24
sources:
  - src/main/core/utilityProcess/types.ts
  - src/main/core/utilityProcess/host/processAdapter.ts
  - src/main/core/utilityProcess/protocol/frames.ts
  - src/main/core/lifecycle/event.ts
  - src/main/ai/runtime/dsh/DshBridgeServer.ts
  - packages/dsh-bridge/src/link.ts
  - pnpm-lock.yaml
---

# Sandbox API Draft

本文将[设计草案](./design.md)转为可评审、可用于原型的 API。类型、方法名和协议选择是本轮设计建议，尚未实现或冻结；平台路线见[后端候选方案](./backend-options.md)。仅涉及沙盒，不设计插件注册、加载、Agent 编排或业务方法。

可信第一方代码可以直接在 main 执行，不经过这些接口，也不获得沙盒隔离保证。通过本 API 启动的目标必须进入受限执行环境，不提供 `sandbox: false` 或失败后普通执行的分支。

## 1. 开源参考与取舍

以下资料在 2026-09-24 核对；借鉴接口和机制，不直接把其他 Agent / Harness 当作 Cherry 的沙盒底座。

| 参考 | 观察 | 本设计的取舍 |
| --- | --- | --- |
| [Codex sandboxing](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/manager.rs) 与 [exec](https://github.com/openai/codex/blob/main/codex-rs/core/src/exec.rs) | 分开表达程序、参数、cwd、env 和执行策略；执行层处理超时、取消、输出上限与有界排空 | 采用结构化启动描述和独立输出预算；目标退出与资源回收分别报告，不复制审批或放宽策略的路径 |
| [bubblewrap](https://github.com/containers/bubblewrap) 与[命令接口](https://github.com/containers/bubblewrap/blob/main/bwrap.xml) | 提供隔离原语，实际安全性依赖调用者构造的策略；有状态输出、父进程死亡处理等选项 | 平台后端必须编译完整策略并提供可信启动和退出证据；包装器 PID 或退出码不能单独代表目标进程树 |
| DSH `@deepseek-ai/dsh-sandbox` / `dsh-sandbox-local` `0.1.2-rc.1`（本地安装包类型声明） | `confine(argv, policy)` 返回命令与文件限制的执行程度；文件策略不包含网络和进程可见性 | 保留策略与机制分离；不使用单一 `full/partial` 表示全部安全能力，也不只暴露命令包装函数 |
| [vscode-jsonrpc](https://github.com/microsoft/vscode-languageserver-node/tree/main/jsonrpc) 与 [LSP 基础协议](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.17/specification.md#base-protocol) | 请求、通知、双向处理、长度分帧和取消通知已有实现与跨语言约定 | 拟采用 JSON-RPC 2.0 + Content-Length 分帧；仅复用基础协议，不实现 LSP 业务。Node 优先评估 `vscode-jsonrpc`，Python 接入须证明互通 |
| 仓库 [Utility Process](../references/utility-process/README.md) 与 [DSH Bridge](../../src/main/ai/runtime/dsh/DshBridgeServer.ts) | 已有进程管理、请求关联和本地双向通信经验；前者以同一构建的可信代码为前提 | 复用适用部分，补充受限启动、运行时校验和实例身份；不开放任意 renderer IPC 转发 |

`vscode-jsonrpc` 的 [MessageReader](https://github.com/microsoft/vscode-languageserver-node/blob/main/jsonrpc/src/common/messageReader.ts)提供分帧和部分消息超时通知，但不能据此认定已具备我们的帧大小、队列和超时关闭策略。选库前核查这些限制；优先扩展已有 reader/transport 接点，不另造 RPC 引擎。DSH 上游文档地址本轮未能读取，其观察仅基于本地版本，不声称代表上游最新状态。

## 2. 分层与首版边界

| 层 | 提供的接口 | 调用者 |
| --- | --- | --- |
| 宿主控制 | `probe`、`start`、实例观察和 `stop` | Cherry main 中的可信调用方 |
| 平台后端 | 能力核对、受限启动、进程树终止、权限与资源清理 | 沙盒管理者 |
| 双向 RPC | 请求、处理函数、通知、取消及断连 | 主进程与需要通信的目标代码 |

一个实例对应一次根进程启动及其子进程树，策略在生命周期内固定。每次启动分配新的 `instanceId`，`ownerId` 只用于资源归属；同一 owner 不意味着允许共享权限。首版不提供进程池、自动重启、断线重连、请求重放、原地扩权、PTY 或持久化业务恢复。

普通命令可以只使用标准流；需要参与双向调用的目标才接入 RPC。Node 与 Python 是首轮验收运行时，不把“可执行任意程序”误写成“已验证所有语言或原生模块”。

## 3. 启动描述与权限

以下类型均为草案，宿主侧 `AbortSignal`、回调与流对象不进入 wire protocol。

```typescript
interface SandboxSpec {
  ownerId: string
  environmentId: string
  runtimeProfileId: string
  command: {
    executable: string
    args: readonly string[]
    cwd: string
    env: Readonly<Record<string, string>>
  }
  filesystem: {
    read: readonly string[]
    write: readonly string[]
    denyRead: readonly string[]
    denyWrite: readonly string[]
  }
  mounts?: readonly {
    source: string
    target: string
    access: 'read' | 'read-write'
  }[]
  network:
    | { mode: 'deny' }
    | { mode: 'proxy'; targets: readonly { host: string; port: number }[] }
    | { mode: 'unrestricted' }
  channel: 'none' | 'dedicated' | 'stdio'
  limits: SandboxLimits
}

interface SandboxLimits {
  startupTimeoutMs: number
  lifetimeMs?: number
  stopGraceMs: number
  stopTimeoutMs: number
  cleanupTimeoutMs: number
  ioDrainTimeoutMs: number
  ioBufferBytes: number
  outputBytes?: number
  memoryBytes?: number
  processCount?: number
}
```

### 3.1 环境、路径与运行时

- `environmentId` 是宿主预先选择的执行环境标识，探测结果说明它对应原生 OS 还是指定 WSL2 发行版；不能在启动失败时从原生环境切换到 WSL2。创建、安装、升级环境另走维护流程，不是目标可调用的 API。
- `runtimeProfileId` 引用宿主维护且带版本的运行时基础策略：解释器、系统库、必要设备及临时目录规则。它不是目标自报的配置；执行文件必须符合所选 profile。必要读取范围在探测和实际启动结果中列明，不能隐式开放整个用户目录。Node/Python 基础策略尚待逐平台验证。
- `executable`、`cwd` 和文件策略路径均为执行环境内的绝对路径。`args` 按原样传递，不做 shell 拼接、通配符展开或 PATH 搜索；确需 shell 时显式指定可执行文件和参数，并由 profile 决定是否允许。
- `mounts` 仅用于后端支持的显式路径映射：`source` 是宿主绝对路径，`target` 是执行环境绝对路径。原生后端若不支持重映射，应拒绝该请求。WSL2 中不能将 `C:\\...` 直接当成 Linux 路径，也不能默认暴露 `/mnt/c`。
- 映射本身不额外授权：宿主先核准 source，target 必须落入相应 read/write 范围，挂载模式不得比策略宽。执行文件、cwd、所有规则必须属于本次环境。调用方从既有路径设施取得应用路径，不另造路径根。
- 配置快照在启动时复制并冻结；执行期间修改调用方对象不改变策略。应用级敏感路径拒绝规则与请求合并后始终优先，不向目标提供覆盖入口。

### 3.2 文件与环境变量

文件策略采用默认拒绝、明确允许；write 表示读写，仍受 denyRead/denyWrite 约束。拒绝规则优先于允许规则，后端不能自动抹掉无法表达的拒绝项。首版路径不支持 glob；路径为文件则仅指向该文件，为目录则涵盖子树。

允许根在启动时必须存在，需新建的私有目录由宿主准备；其子项可在运行时创建。启动时检查和 `realpath` 不能代替运行中的限制，链接、重解析点、硬链接和目录替换不能使访问范围扩大。无法保证特定路径语义时，以不支持拒绝启动；非现存 deny 路径也必须持续受限，不能只在启动时扫描一次。

`env` 是完整的业务环境白名单，不自动合并 `process.env`。运行时 profile 可加入必要系统变量，通道引导信息由宿主另行注入；保留键冲突直接拒绝。策略需单独处理解释器注入变量、动态加载配置和代理设置，不向目标透传宿主凭据。诊断只记录变量名，不能输出变量值或引导凭证。

### 3.3 网络与限额

| 策略 | 承诺 |
| --- | --- |
| `deny` | 拒绝目标及子进程的网络访问，包括直接连接和 DNS 外传；仅保留已声明的本地通信通道 |
| `proxy` | 仅经本实例的受控代理连接精确 host/port 目标，拒绝绕开代理的 TCP、UDP 和系统解析外传 |
| `unrestricted` | 调用方显式不要求网络隔离，其他隔离仍成立；有效策略必须显示此项未限制 |

首版 proxy 不支持域名通配符、任意协议或任意本地端口放行；代理在宿主侧解析域名并检查实际连接地址，拒绝域名隐式解析到回环、私网、链路本地等非公网地址。访问这些地址需显式列出相应 IP/port；每次连接都检查，不因已有域名授权放宽。目标不能借其他实例的代理获得额外权限。具体代理实现仍待选型。

上表是 API 要求，不是三平台已经做到的保证。例如后端只能阻止连接但不能限制系统 DNS 时，不能接受 `deny` 并返回成功；应报告能力缺失。用户主动选择 `unrestricted` 与后端自动降级是不同操作。

时间单位为毫秒、大小单位为字节，所有已给数值必须为正安全整数，`stopTimeoutMs >= stopGraceMs`。`lifetimeMs` 从可信目标启动开始计时，未给则允许长驻。`memoryBytes` 和 `processCount` 分别限制整棵目标进程树的总内存和同时存活进程数，不包含可信管理组件；要求了却不能强制执行就拒绝启动，未要求不代表有配额。其他字段是宿主执行预算，不能描述成 OS 配额。CPU、磁盘硬配额暂不进入首版 API。

## 4. 宿主控制 API

```typescript
interface SandboxManager {
  probe(spec: SandboxSpec): Promise<SandboxProbe>
  start(spec: SandboxSpec, options?: {
    signal?: AbortSignal
    rpc?: HostRpcBinding
  }): SandboxInstance
}

interface SandboxProbe {
  environment: { id: string; kind: 'native' | 'wsl2'; os: 'macos' | 'linux' | 'windows' }
  backend: { id: string; version: string } | null
  status: 'ready' | 'setup-required' | 'unavailable'
  checks: readonly {
    feature: string
    status: 'supported' | 'unsupported' | 'unknown'
    reason?: string
  }[]
  requirements: readonly { code: string; message: string; adminRequired: boolean }[]
  policyPreview?: EffectivePolicy
}

interface EffectivePolicy {
  runtimeProfile: { id: string; version: string }
  filesystem: SandboxSpec['filesystem']
  mounts: NonNullable<SandboxSpec['mounts']>
  network: SandboxSpec['network']
  runtimeAccess: readonly { resource: string; access: string; reason: string }[]
  limits: SandboxLimits
  channel: SandboxSpec['channel']
}

interface SandboxInstance {
  readonly id: string
  readonly ownerId: string
  readonly ready: Promise<{ backendId: string; effectivePolicy: EffectivePolicy }>
  readonly completion: Promise<SandboxCompletion>
  readonly stdin: { write(data: Uint8Array): Promise<void>; end(): Promise<void> } | null
  readonly stdout: AsyncIterable<Uint8Array> | null
  readonly stderr: AsyncIterable<Uint8Array>
  readonly rpc: RpcPeer | null
  snapshot(): { state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'; lastCompletion?: SandboxCompletion }
  stop(): Promise<SandboxCompletion>
}

interface SandboxCompletion {
  reason: 'exited' | 'stopped' | 'cancelled' | 'limit' | 'startup-error' | 'channel-error'
  target: { status: 'not-started' | 'exited' | 'unknown'; exitCode?: number; signal?: string }
  tree: 'gone' | 'unknown'
  cleanup: 'complete' | 'incomplete'
  issues: readonly { code: string; message: string; resourceId?: string }[]
}
```

### 4.1 探测与启动

`probe` 验证完整 spec 所需能力，可以运行可信的临时功能探针，但不运行目标代码、不提权或修改持久权限。检查覆盖文件读取/写入、网络/DNS、本地 IPC、实例隔离、进程树终止、父进程死亡和所要求配额；不能只检查可执行文件存在。任何必需项为 unknown/unsupported 时 status 不能为 ready。无可用后端时 backend=null，ready 必须返回后端身份与策略预览。探测总耗时受 startupTimeoutMs 限制，探针退出和临时资源清理也必须有界；超时不能留下后台探针。

`start` 同步分配实例并纳入管理，然后异步探测、准备和启动。可识别的配置或环境失败通过 `ready` 拒绝返回；调用方应立即处理其 rejection。`start` 返回之前不得创建无法追踪的 OS 资源。实例句柄从准备阶段就可停止，避免启动失败后丢失回收入口。

`ready` 的成功条件是：可信启动器确认限制已建立且目标已启动；需要 RPC 时还要完成认证与协议握手。目标自己发来的 ready 不能证明隔离成立。业务初始化是否完成不属于此 ready。探测过也必须重新核对启动时的条件，不能复用旧结论绕过执行限制。

`signal` 控制本次实例的整个生命周期：提前取消不运行目标；运行中取消进入 stop 流程。它不同于单次 RPC 的 signal。启动、握手超时或 RPC 通道失效都触发实例停止和清理；没有普通进程回退或自动重启。

### 4.2 标准流、退出与清理

- `none` / `dedicated` 模式保留目标标准流。`stdio` 模式明确将目标 stdin/stdout 独占用于 RPC，因此句柄 stdin/stdout 为 null，stderr 保留作日志；需要原始 stdin/stdout 的目标必须选择 dedicated。不允许悄悄改变标准流用途。
- 管理者从启动起排空 stdout/stderr 到有界队列，每条流单消费者、按字节顺序读取，不承诺两条流间的全局顺序。`ioBufferBytes` 分别约束输入队列与每条输出队列，超过限制或达到两条业务输出流合计的可选累计 `outputBytes` 时停止实例并报告，不无限缓存或静默丢数据。该预算不包含另有限制的 RPC 帧。
- `stdin.write` 等待有界写入推进，不能保证目标已消费；停止后拒绝新写入，`end` 幂等。输出迭代在排空或预算结束后关闭，排空超时必须记录截断，不能因孙进程持有管道永远等待。
- 根进程退出后，管理者仍负责停止残余子进程并清理授权资源。只终止包装器或看到根进程退出不足以返回 tree=gone。
- `completion` 在第一次退出/停止处理完成或其预算耗尽后 resolve，不因非零退出码 reject；它保留首次结果。`ready` 失败也必须最终结算 completion。只有 tree=gone 且 cleanup=complete 才进入 stopped；否则进入 failed 并保留管理责任。
- `stop()` 先撤销调用入口，再请求退出，宽限期后强制终止；总终止预算和清理预算分别受限。并发 stop 共享一次执行，已完成清理的 stop 返回相同结果；清理失败后的再次 stop 只重试终止/清理，不重启目标。最新结果通过 snapshot 返回，不能改写旧 completion。
- 必要权限回收依赖进程树退出证据。不能为了返回成功，提前删除仍被存活目标使用的资源；此时报告 incomplete。应用生命周期负责关闭所有实例，父进程异常死亡的收敛由后端机制保证并逐平台验收。

## 5. 双向 RPC API

```typescript
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
interface Disposable { dispose(): void }
interface Validator<T> { parse(value: unknown): T }
interface RpcMethod<I extends JsonObject, O extends JsonValue> {
  name: string
  input: Validator<I>
  output: Validator<O>
}
interface RpcEvent<T extends JsonObject> { name: string; data: Validator<T> }
interface RpcContext { requestId: string; signal: AbortSignal }
interface RpcPeer {
  request<I extends JsonObject, O extends JsonValue>(method: RpcMethod<I, O>, input: I,
    options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<O>
  handle<I extends JsonObject, O extends JsonValue>(method: RpcMethod<I, O>,
    handler: (input: I, context: RpcContext) => Promise<O>): Disposable
  notify<T extends JsonObject>(event: RpcEvent<T>, data: T): Promise<void>
  on<T extends JsonObject>(event: RpcEvent<T>, listener: (data: T) => void): Disposable
}
interface HostRpcBinding {
  configure(peer: RpcPeer): void
  authorize(context: {
    instanceId: string; ownerId: string
    kind: 'request' | 'notification'; method: string; params: JsonObject
  }): Promise<boolean>
  limits: {
    maxFrameBytes: number
    maxHeaderBytes: number
    maxBufferedBytes: number
    maxActiveRequests: number
    maxActiveHandlers: number
    maxNotificationsPerSecond: number
    defaultRequestTimeoutMs: number
    frameTimeoutMs: number
  }
}
```

`configure` 在目标启动前同步安装宿主 handlers；`channel=none` 不允许 rpc binding，其他模式必须提供 binding。未 ready 时业务 request/notify 明确拒绝。实例身份来自宿主管理记录，不能让目标在 params 中指定身份或直接拿到服务对象。`authorize` 必须显式提供，抛错、超时或返回 false 均拒绝分派；其耗时计入请求预算。异步授权返回后再次检查实例状态和取消信号，不能让超时或撤销后的迟到授权触发执行。

宿主接收处理顺序为：验证帧 → 查找明确注册的方法 → 校验参数 → 检查当前授权与资源范围 → 执行业务 handler → 校验结果 → 返回。方法使用 Map 或自有属性查找，不能从对象原型链分派。发送侧和接收侧均校验边界数据，TS 泛型不能替代运行时验证；Validator 不做扩权式转换。Python 使用等价 schema；首版不要求 schema 代码生成或远程方法发现。业务方法由调用方提供，本文不定义。

`handle` 同名注册拒绝，注销只撤销对应注册。`on` 可以有多个监听者，共用同一事件契约；监听者同步返回，异常被记录，不得变成无人处理的异步 rejection。已开始的 handler 由实例跟踪，注销不代表已完成。`notify` 只表示帧写入成功，不确认对端执行业务；需要结果或副作用确认时使用 request。

RPC 限额均为正安全整数，`maxBufferedBytes` 限制每端收发队列的总字节数，须容纳至少一帧及控制帧余量。等待某个 handler 时，读取、响应、取消和另一方向的请求继续处理。`maxActiveRequests` 限制每端发起的待结算请求，`maxActiveHandlers` 限制接收侧的授权检查及未结束 handler（含通知处理）；超过限制的请求立即返回 BUSY，通知按拒绝规则处理，不无限排队。取消不释放仍在执行的槽位，避免用取消绕过并发限制。响应和控制帧不占业务 handler 槽位，发送预算须预留控制帧空间。

### 5.1 协议草案 v1

拟采用 JSON-RPC 2.0 对象，ASCII header + UTF-8 JSON body：

```text
Content-Length: <UTF-8 body 字节数>\r\n
\r\n
{"jsonrpc":"2.0","id":"h:1","method":"example.compute","params":{"value":7}}
```

上例换行是转义展示；实际写入 CRLF。首版不接受 batch、压缩、其他字符编码或 JSON 标量 params；params 固定为对象，结果为 JSON 值，无结果用 null。数字必须有限，整数限于 JS 安全整数范围，大整数使用字符串；日期、二进制等不自动转换。schema 应限制嵌套深度、集合与字符串长度，避免合法小帧的解析成本失控。

Content-Length 必须恰好出现一次，为非负十进制整数；按字节核对。header 和 body 在累积前检查上限，读取分块不能先无限 append 再判断。Content-Type 可省略，若给出只接受 UTF-8 JSON；其他未知 header 拒绝。frameTimeout 从帧首字节开始计时，不被每次小片段重置。畸形或超限帧关闭连接并触发实例停止，不把半帧当日志或下一条消息恢复。

每条连接上主进程请求 ID 使用 `h:<递增整数>`，目标使用 `c:<递增整数>`，不复用，不接受目标自选主进程身份。响应顺序可以不同于请求顺序；已取消请求的迟到响应丢弃，重复响应不能二次结算。未发出过的 ID、重复请求 ID 或非法方向视为协议错误；处理已完成 ID 不需要无限保留响应正文。

### 5.2 引导、认证与版本

1. 平台后端创建与实例绑定的私有通道。dedicated 端点必须具备访问控制及实例认证；路径随机不算认证。stdio 必须是可信启动器持有、仅连接目标的私有管道。
2. 目标接入层获得端点和本次引导信息，注册 handlers 后发送 `sandbox.hello` 请求，params 为 `{ version: 1, credential?: string }`。凭证由宿主生成，通过经过验证的私有引导渠道传入，不能放在 argv、公开文件或日志中；环境变量也不能默认视为安全凭证存储。
3. 宿主依据已绑定实例验证通道及凭证，返回 `{ version: 1, limits: ... }`；不接受目标声明的 owner/PID 作为授权证据。仅当私有继承通道已证明来源时才允许省略 credential。
4. 目标确认版本和限制后发送 `sandbox.ready` 通知，再发业务消息；宿主收到该通知且可信隔离已成立才完成实例 ready。握手不能扩展权限；版本不匹配或超过 startupTimeout 均停止实例。

`limits` 是宿主给定的 RPC 限额。接收 hello 前也使用宿主上限，目标在接收 hello 响应前使用接入层的固定引导上限；具体引导上限与默认运行值在原型配置中明确并记录。握手不支持降级协议或扩大上限。控制方法由通信层保留，业务不得注册 `sandbox.*` 或 `$/` 前缀。

握手仅确认协议与实例通道，不证明目标代码可信。不提供 reconnect，旧通道及凭证不可绑定下一次启动。RPC EOF、认证失败或协议错误时，宿主拒绝待结算调用、取消已接收 handler 并停止目标；目标接入层也应结束等待和退出，最终强制清理由后端承担。

正常停止时，宿主可在通道仍可用的情况下发送保留通知 `sandbox.shutdown`（params 为 `{}`），目标接入层拒绝新业务请求、通知在途 handler 取消并退出。该通知只允许宿主发往目标，目标不能用它请求主进程退出；hello/ready 只允许目标在握手阶段发送一次。停止通知无成功确认，不能作为进程退出证据；不响应时仍按 stop 预算强制终止。收到停止通知后不再发起反向业务请求。

### 5.3 取消、超时与错误

采用 `$/cancelRequest` 通知，params 为 `{ id: "h:1" }` 或对应方向 ID；只能取消发送者自己发起的请求。该通知属于本协议要求，不是 JSON-RPC 核心自带的执行终止保证。接收端将其映射到 handler 的 signal；Python 接入层提供等价取消上下文。

请求超时从本地接收调用开始计算，涵盖发送排队和响应等待。每次 request 使用显式 timeout 或默认预算，显式值只能缩短默认预算，不能由目标无限延长。调用方先结束等待，再尽力通知对端；未写出的帧移出队列。接收端从接收请求起使用 defaultRequestTimeoutMs 覆盖授权与 handler，取消协作失败时保留其执行记录；宿主 handler 的副作用只能由业务层中止或回滚，进程清理完成也不证明这类副作用已回滚。需要强制停止目标代码时调用实例 stop，不能把 RPC 取消等同于 kill。

| 错误 | JSON-RPC code | 语义 |
| --- | --- | --- |
| 方法未注册 / 参数无效 | -32601 / -32602 | handler 未执行 |
| 未授权 | -32001 | handler 未执行 |
| 忙 | -32002 | 达到执行预算，本次 handler 未执行 |
| 请求取消 | -32800 | 协作取消，不保证副作用未发生 |
| handler 失败 | -32010 | 返回经过脱敏的业务错误，不自动重试 |
| 协议或内部错误 | -32600 / -32603 | 不暴露堆栈、路径或凭据；无法继续信任连接时关闭 |

本地超时、断连、未 ready、序列化失败使用本地错误，不伪造对端响应。RPC 错误对象还记录 `outcome: 'not-dispatched' | 'unknown' | 'response-received'`：未写出或宿主验证阶段拒绝才可确认未分派；写出后超时/断连/取消为 unknown；收到结果或 handler 错误为 response-received。目标声称“未执行”不能作为重试副作用的安全证据。普通 request 错误不必终止实例；非法响应或通道不可信须停止。

结果和取消竞争时只结算一次；已收到并完成的结果不被后续取消覆盖。拒绝通知不能返回 JSON-RPC response，宿主丢弃并做有界诊断；超限通知流终止异常连接。传输层和接入层均不自动重放请求。

## 6. 平台后端契约

内部后端接收去除 RPC 回调后的冻结 spec 与实例身份，提供以下最小接口；具体文件位置和与现有 ProcessAdapter 的关系在原型验证后决定。

```typescript
interface SandboxBackend {
  probe(spec: SandboxSpec): Promise<SandboxProbe>
  launch(instanceId: string, spec: SandboxSpec): BackendLease
}
interface BackendLease {
  started: Promise<{ effectivePolicy: EffectivePolicy }>
  targetExit: Promise<SandboxCompletion['target']>
  stdin: SandboxInstance['stdin']
  stdout: SandboxInstance['stdout']
  stderr: SandboxInstance['stderr']
  channel: { input: AsyncIterable<Uint8Array>; write(data: Uint8Array): Promise<void> } | null
  terminate(options: { graceMs: number; timeoutMs: number }): Promise<'gone' | 'unknown'>
  cleanup(options: { timeoutMs: number }): Promise<{
    status: 'complete' | 'incomplete'; issues: SandboxCompletion['issues']
  }>
}
```

lease 必须在创建 OS 资源之前返回并由管理者持有，后续启动错误通过 started 拒绝；每个账户授权、代理、临时目录和句柄均先纳入 lease 再使用。`terminate` 必须支持启动中的取消，不能在停止已完成后继续派生目标。后端清理入口幂等，失败不能丢弃资源记录。

`started` 来自可信 launcher 的状态，不是业务 RPC；`targetExit` 是根目标的事实，`terminate` 才报告整个进程树是否已消失。信号名和退出码仅作平台诊断，不把单个 POSIX kill 或 Windows kill 调用成功解释为树已退出。未启动时也要结算 targetExit；无法确认目标状态时返回 unknown，不阻塞终止预算。

dedicated 通道不占业务标准流；stdio 通道使用独占协议标准流；none 的 channel=null。后端必须关闭其拥有的通道和标准流，不能假设 RPC 库 dispose 已关闭底层描述符。所有 inherited handle 默认关闭，仅显式传入的通道存活；业务层不能注入任意 FD、pipe 名或端口例外。

首次安装或管理员初始化不属于 launch。需要初始化、需要重启、发行版不存在或策略无法落实时通过 probe 报告，start 必须拒绝并清理。原生与 WSL2 不自动互换；两者使用同一外部契约，但分别验证路径、身份、网络和父进程死亡语义。

## 7. Node / Python 互通示例

以下是拟议接口的伪代码，不是当前可导入的 SDK。例子只说明沙盒通道，不定义任何产品业务能力。

主进程提前注册允许目标请求的 `example.double`，再请求目标的 `example.compute`：

```typescript
const instance = sandbox.start(spec, {
  rpc: {
    limits: rpcLimits,
    configure(peer) {
      peer.handle(doubleMethod, async ({ value }, { signal }) => {
        signal.throwIfAborted()
        return { value: value * 2 }
      })
    },
    authorize: async ({ method }) => method === 'example.double'
  }
})
try {
  await instance.ready
  const result = await instance.rpc!.request(computeMethod, { value: 7 })
  // 示例结果为 { value: 15 }。
} finally {
  const stopped = await instance.stop()
  // 调用方必须处理 tree=unknown 或 cleanup=incomplete，不能忽略清理失败。
}
```

`doubleMethod` 与 `computeMethod` 均声明 `{ value: number }` 输入输出 schema，示例仅允许能安全运算的有限整数；实际业务的 authorize 还必须检查资源范围。spec 选择 dedicated 或 stdio，并提供执行路径、最小文件权限与 network=deny。

Node 侧在握手完成前注册处理函数：

```typescript
const connection = connectSandboxRpcFromBootstrap({
  configure(peer) {
    peer.handle(computeMethod, async ({ value }, { signal }) => {
      const doubled = await peer.request(doubleMethod, { value }, { signal })
      return { value: doubled.value + 1 }
    })
  }
})
await connection.closed
```

Python 侧使用相同方法与 schema，保持接收循环可处理反向请求的响应：

```python
async def configure(peer):
    async def compute(params, context):
        doubled = await peer.request(
            double_method, {"value": params["value"]},
            cancellation=context.cancellation,
        )
        return {"value": doubled["value"] + 1}

    peer.handle(compute_method, compute)

await serve_sandbox_rpc_from_bootstrap(configure)
```

接入函数只在配置处理函数后才发送 hello/ready。Python 使用异步接收循环，CPU 密集或阻塞工作不能占住该循环；桥接本身不把任意同步函数变成可取消任务。关闭通道结束等待，不做重连。Node 与 Python 的接入函数均待实现，不能据此宣称互通已经通过。

## 8. 错误与原型验收

宿主控制错误建议使用稳定 code：`INVALID_SPEC`、`BACKEND_UNAVAILABLE`、`SETUP_REQUIRED`、`POLICY_UNSUPPORTED`、`START_FAILED`、`START_TIMEOUT`、`CANCELLED`、`LIMIT_EXCEEDED`、`CHANNEL_FAILED`、`TERMINATION_UNCONFIRMED`、`CLEANUP_FAILED`。附带 instanceId、发生阶段和脱敏诊断；是否还有资源以 completion/snapshot 为准，不从错误名称推断。授权拒绝属于 RPC 边界，目标普通非零退出属于执行结果，均不应统称 sandbox 不可用。

| 验收 | 必须观察的结果 |
| --- | --- |
| 普通 Node/Python 程序 | 标准流、退出码、允许文件操作正常；无需实现 RPC |
| 跨语言嵌套调用 | 两种运行时分别返回示例结果，等待 A 时仍可处理 B；并发响应按 ID 正确关联 |
| 受限访问 | 越界文件操作、链接替换、直接联网、DNS 和其他本地通道被拒绝；授权内对照组成功 |
| 认证与载荷 | 伪造实例、旧凭证、错误版本、非法参数、非法结果、超大/碎片帧在边界被处理，内存和等待有界 |
| 并发与取消 | 饱和返回 BUSY；取消不释放仍在执行的槽位；结果/取消竞争只结算一次，迟到响应不污染新请求 |
| 启动中失败/停止 | 句柄可观察，可取消，没有启动后失去 owner 的进程；ready 拒绝后 completion 仍结算 |
| 退出与清理失败 | 根退出后仍清理子进程；预算耗尽报告 unknown/incomplete；再次 stop 可重试清理且不重启 |
| 多实例与宿主崩溃 | 文件、代理和通道不串权；主进程异常退出后进程树按后端承诺收敛 |
| Windows 初始化 | 一次初始化后普通用户重复启动/停止不再 UAC；原生与 WSL2 分别留证，不能互相替代验收 |

原型必须显式填写所有限额，不留无限缓冲或无限握手等待。数值由有界的小规模实验确定，记录慢消费者、碎片消息、突发输出与长驻运行证据后才设生产默认值；硬配额未实现时拒绝相应请求。

建议实施切片：先完成 spec 校验与一个原生后端的进程闭环，再完成 Node/Python RPC 互通，最后验证剩余平台和选定 Windows 路线。每个切片都需要真实 OS 行为证据；mock 不能替代安全边界验收。

当前仍待原型确定：平台辅助程序与分发方式、运行时基础策略、RPC 库和有界 reader 接入、引导凭证传递、生产限额、Windows 路线。API 草案允许开始针对性验证，不代表已满足生产发布条件。
