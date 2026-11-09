# Agent Note: ACP v1 运行时适配器

Status: proposed

[English](2026-11-09-agent-runtime-acp-v1.md) | 中文

## Problem

Cherry 已有公共[运行时契约](../../../../packages/agent-runtime/README.md)和原生 Pi、Pi Durable、Claude Code 适配器，但 `main` 的 `27a61a606566` 尚无可移植的 ACP 适配器。ACP 是 harness 的客户端协议，不是执行引擎。连接智能体并不意味着 Cherry 接管其模型循环、存储、工具或子智能体。

本次目标是通用的 `@cherrystudio/agent-runtime-acp/v1` 适配器，首批兼容性样本为 Claude ACP 和 Gemini CLI。本文细化 [harness 边界](2026-10-17-agent-harness-boundaries.md)，不修改公共契约。此前的[五样本证据](../testing/2026-10-17-agent-harness-evidence.md)仍是各自固定版本上的历史证据。

相关的 [PR #21221](https://github.com/CherryHQ/cherry-studio/pull/21221) 在本次检查的 `909ce14a6882` 已包含桌面端 `localAgent/AcpConnection.ts`，同时负责启动、认证、文件系统／终端回调和产品用量。该实现尚未合并，是接入参考，不是当前分支的代码。可移植包不能与它并列成为第二个生产连接所有者；桌面采用新包时，需要单独限定范围，迁移当前连接所有者。

## Proposal

### 调研基线

源码检查与运行证据分别记录。本次调研更新于 2026-11-09。

| 来源 | 固定基线 | 发现 |
| --- | --- | --- |
| ACP 协议 | [`7441d106a853`](https://github.com/agentclientprotocol/agent-client-protocol/tree/7441d106a853682cce61d2dd7db54123e4b9a477) | 稳定 v1、unstable v1 和 v2 草案使用不同 schema。 |
| TypeScript SDK | [`2.4.0`、`0f8c75079ae0`](https://github.com/agentclientprotocol/typescript-sdk/tree/0f8c75079ae07e6edd2feb626f5598a92632eead) | 默认入口是稳定 v1；库已提供 `client`、`agent`、`ndJsonStream`、连接生命周期和请求取消。 |
| Claude ACP | [`0.101.0`、`3b22586cf63c`](https://github.com/agentclientprotocol/claude-agent-acp/blob/3b22586cf63cef06f1029a8418a9abb3b2cc3236/src/acp-agent.ts) | v1 prompt 等待轮次结果。原生排队通过 `_meta.claudeCode.promptQueueing` 声明；子智能体控制及更丰富的路由使用扩展。 |
| Gemini CLI 源码 | [`62bab5b232c1`](https://github.com/google-gemini/gemini-cli/blob/62bab5b232c15b925d31e655ce844ab939c882b7/packages/cli/src/acp/acpSession.ts) | `prompt()` 会中断上一个 pending prompt。加载已活跃的会话会释放并替换它，不是被动观察操作。 |

协议仓库和 SDK 不是可互换的版本基线。例如，协议基线已将 `sessionCapabilities.systemPrompt` 放入稳定 v1，但 SDK 2.4.0 仅在 unstable schema 暴露它。首版实现使用已发布 SDK 的稳定接口，不复制更新的协议类型，也不隐式导入 `/unstable`。

| 行为 | 稳定 v1 证据 | 对适配器的影响 |
| --- | --- | --- |
| 输入与完成 | [`session/prompt`](https://github.com/agentclientprotocol/agent-client-protocol/blob/7441d106a853682cce61d2dd7db54123e4b9a477/docs/protocol/v1/prompt-turn.mdx) 在轮次结束后返回 `stopReason`；没有独立的 prompt 接纳响应或持久 run ID。 | 本地派发、原生放置和终态必须分开。 |
| 忙时输入 | 没有通用 steer/follow-up 操作；两个样本的实现不同。 | 每个自有会话最多一个进行中的 prompt，公共接口只支持 `whenBusy: reject`。 |
| 内容 | 消息 ID 可选；工具调用有 ID 和局部更新。输出可以包含文本、推理、图像、音频、链接、资源、差异和终端引用。 | 保留来源字段，不能从展示更新推造持久消息身份或工具执行事实。 |
| 恢复 | [`loadSession`](https://github.com/agentclientprotocol/agent-client-protocol/blob/7441d106a853682cce61d2dd7db54123e4b9a477/docs/protocol/v1/session-setup.mdx) 需要协商，并在响应前重放历史。Resume 和 close 分别声明能力。 | 复用活跃所有者；仅在冷打开时使用协商过的原生 load 操作。能力或历史缺失不能变成新会话。 |
| 取消 | Cancel 是通知；未完成的权限请求需要回复 `cancelled`，最后一批更新先于 prompt 响应。 | 发出 cancel 不等于确认终止，必须继续消费到所捕获的 prompt 结束。 |
| 宿主回调 | 文件系统、终端和 elicitation 取决于客户端能力；权限请求携带智能体给出的选项 ID。 | 仅声明已实现的宿主回调，保留原生权限选项。 |
| 配置与用量 | 模式、配置选项、命令、计划、上下文／累计费用更新、通知和压缩是不同的协议事实。 | 保留类型化 ACP 事实；上下文占用和累计费用不是单轮计费用量。 |
| 子智能体与高级控制 | 稳定 v1 不提供实验子智能体控制协议、原生排队或通用提供商选择。 | 不暴露公共子智能体控制，也不从工具标题推断子智能体。 |

### 包与资源所有权

新增 `packages/agent-runtime-acp`，显式导出 `/v1`。依赖 `@cherrystudio/agent-runtime` 和固定的 `@agentclientprotocol/sdk@2.4.0`，经公共包复用现有 SDK 内容协议。包内不引入 Electron、产品数据库、智能体安装器、凭证管理器或原生 harness 依赖。公共运行时不需要新增公开类型。

`createAcpRuntime` 拥有一个已配置的 backend 命名空间及其 ACP 连接。宿主提供独占的传输租约及 close-and-join 操作、原生会话配置查询、诊断入口和支持的客户端回调。SDK 负责分帧、JSON-RPC 关联、入站方法参数校验和连接请求。适配器负责初始化、会话路由、输入记录、标准化 feed 和访问生命周期。宿主继续负责可执行文件解析、进程启动、凭证、路径策略，以及关闭时等待自有进程退出。仅关闭 SDK 连接不能证明进程已退出。

初始化之前注册回调，并要求协议版本为 1。使用具有显式连接生命周期的 `ClientApp.connect`；若通过 `connectWith` 回调返回 runtime，回调结束就会关闭传输。可选操作必须核对协商能力与返回的会话配置。已声明的扩展仍是原生元数据，不能据此调用稳定入口中不存在的方法。

`create` 使用原生 `session/new`。`open` 验证 backend，优先复用已有会话所有者，再考虑 `session/load`。冷加载所需的 `cwd` 和 MCP 配置由宿主提供；展示消息绝不转成原生上下文。捕获 new/load 响应之前的初始化更新，包括新会话 ID 返回之前的更新。临时路由必须有界，溢出时明确失败，不能悄悄丢失历史或将其归入另一会话。可以在连接边界串行创建新会话以避免临时路由歧义，但不串行执行独立会话的 prompt。

每个活跃会话只有一个投影生产者，handle 可独立释放。`observe`、`Observation.stop` 和 `release` 不会提交 prompt、重载、取消或关闭原生会话。Runtime shutdown 关闭输入接纳，结束未完成的权限回调，请求受支持的原生终止，等待传输租约退出，排空已发布观察，再结束 feed。无法确认来源已终止时返回 `unknown`，不能删除所有者或声称关闭成功。任何操作都不删除原生历史。

### 输入与终态事实

在异步派发之前占用会话的进行中槽位。并发的本地输入必须在发送前拒绝。在单独定义的原生 facet 证明语义之前，`steer` 和 `follow-up` 均返回 `unsupported`，包括会话空闲时。外部客户端或自主工作仍可能改变原生活动；本地独占不代表协议层面全局空闲。

即时 submit 回执仅记录 `dispatch-started`，不宣称接纳、持久存储、模型消费或上下文放置。宿主 `inputId` 只在本地保留，不将 JSON-RPC ID 转成 `NativeInputRef`。重复本地 ID 被拒绝且不再次派发，但这不是持久去重。超时或传输丢失后不自动重试 prompt。

原始 prompt 响应拥有该输入的终态：`end_turn` 表示原生轮次完成，`cancelled` 表示已中断，`max_tokens`、`max_turn_requests` 或 `refusal` 在公共契约中表示 unanswered。ACP 视图保留准确的原生 stop reason。远端请求错误记录失败，但不承诺工具没有产生副作用。传输丢失时执行结果保持未知并发布 gap，不能编造完成或取消确认。

`interrupt` 捕获当前进行中的 prompt，将它的权限请求以 `cancelled` 结束，并发送 `session/cancel`。继续保留最后的输出，等待该 prompt 的原生响应或来源失败。若 prompt 自行完成并与 cancel 竞争，保留其真实 stop reason。传输或截止时间失败返回 `unknown`，不能当作取消成功而释放 busy 槽位。请求级 `$/cancel_request` 是 SDK 的另一种操作，不能替代会话取消。

### 内容与宿主交互

使用 `ThreadFeed` 和现有内容累积器投影 `RuntimeMessage`。原生 ID 按会话和内容种类限定范围。推理和工具结果更新保持有序；应用工具局部更新时，省略字段不能擦除既有值。Harness 不提供消息 ID 时，使用仅属于本次投影的 ID，并在冷重放时显式重置映射；这些 ID 既不是原生历史定位符，也不是 exactly-once 合并键。不能通过文本相等将回显用户块关联到输入。

类型化 `acp` facet 提供原生输入内容、协商／会话配置，以及与标准化修订一同捕获的原生更新观察。公共展示无法表达的内容也要保留，包括资源／差异／终端元数据与 `_meta`。仅包含元数据的更新必须可观察。计划、模式、命令、通知、压缩和费用不能结束 prompt。资源链接和终端引用不授权自动获取内容或执行命令。

权限回调接收原生请求、会话身份、候选选项和取消信号。所选 ID 必须属于给出的选项；无处理器、轮次已取消或正在关闭时，结果均为 `cancelled`。过期权限响应不能授权另一个 prompt。文件系统、终端和 elicitation 处理器由宿主拥有，并按会话限定范围；未实现时不声明支持。MCP 端点来自可信宿主配置，仅使用协商过的传输。适配器不新增自动批准策略。

上下文读取保持被动。确认公共上下文读数需要原生容量／占用证据和已确定的模型身份；否则返回 `unknown` 或 `unsupported`，并保留原始 ACP usage update。不能猜模型，不能用计费计数代替上下文占用，也不能对重放的累计费用再次记账。稳定 v1 不启用公共子智能体访问。现有直接 Claude Code 集成继续负责该 SDK 特有的能力。

### 验证与实施分层

已执行的调研使用发布版 SDK 2.4.0，通过真实 NDJSON 流连接脚本化协议端：初始化／新会话、prompt 等待期间的输出与权限请求、取消权限后在 prompt 响应前保留工具尾部更新、load 响应前重放，以及连接丢失时拒绝未完成请求，均已通过。这证明传输行为，不证明 Cherry 适配器或原生模型循环。

发布版 Claude ACP 0.101.0 和 Gemini CLI 0.67.0 的隔离子进程初始化也已通过。两者均协商 v1，并声明历史加载、图像输入、嵌入上下文及 HTTP/SSE MCP；Gemini 还声明音频。Claude 声明额外会话能力与扩展元数据。本机较旧的 Gemini 0.19.4 初始化超时，不列入已验收基线。这些探针使用临时 home／工作目录，没有认证或模型请求，不能证明任一真实 harness 的 prompt、工具、取消、恢复或桌面接入。

Spec 是最底层。批准之后，包实现层通过显式测试文件路径，使用真实 SDK 和子进程夹具验证公开适配器调用。原生验收层使用受控模型端点和隔离存储，驱动 Claude、Gemini 进程。记录准确包版本与场景，不能用模拟 RPC 回应代替原生循环验收。只有累计证据覆盖全部 AC 后，本文才移至 implemented。桌面采用、服务安装、账号 UI、提供商路由和实验 v1/v2 功能需要另定范围。

## Alternatives considered

- 复制 JSON-RPC 客户端或旧版 `ClientSideConnection` 示例：不采用，SDK 2.4.0 已提供传输与显式连接生命周期。
- 为获得全部 Claude 能力而导入 unstable v1 或 v2 草案：暂缓，这会改变兼容性目标，也不能证明 Gemini 支持。
- 根据工具名或方法名统一排队、子智能体和持久身份：不采用，源码证据与这些保证相矛盾。
- 将桌面连接整体搬入包：不采用，启动、凭证、产品用量和宿主文件系统策略属于桌面宿主；消费者迁移放入另行批准的接入变更。

## Acceptance criteria

- AC1 — `/v1` 可针对固定稳定 SDK 2.4.0 构建并通过类型检查，不引入 Electron、产品数据、原生 SDK 依赖，也不修改公共运行时契约；拒绝不兼容的协议版本。 (verification: unit — 包类型检查与初始化集成测试)
- AC2 — 并发打开共享一个活跃所有者；冷加载捕获响应前的重放；能力缺失、历史丢失和初始化缓冲溢出均明确失败，不新建替代会话、不串入其他会话内容。 (verification: unit — 基于 SDK 传输的公开 runtime 生命周期测试)
- AC3 — Submit 在轮次结束前仅凭派发证据返回；busy 或重复输入不会发送；不支持的策略、远端错误、限制／拒绝及来源丢失保留规定结果，不自动重试。 (verification: unit — 公开输入集成测试)
- AC4 — 权限选择仅使用给出的 ID；中断取消 pending 权限、保留尾部更新，并仅确认所捕获的原生 prompt 边界；过期响应和传输失败不能授予权限或声称取消成功。 (verification: unit — 双向 SDK 取消测试)
- AC5 — 文本、推理、工具局部更新、丰富原生内容和元数据更新在观察及重放后保留，并明确身份限制；慢消费者、溢出和 release 不影响执行或其他观察者。 (verification: unit — 投影与观察集成测试)
- AC6 — 可选控制和宿主回调必须确有支持；上下文读取保持被动，未知模型／上下文数据保持未知；累计费用和实验子智能体元数据不能编造计费或公共控制。 (verification: unit — 能力与回调集成测试)
- AC7 — Shutdown 等待自有传输／进程及已发布交付结束；终止失败保持未知，单个访问释放不影响其他访问与原生工作，也不删除历史。 (verification: unit — 子进程生命周期集成测试)
- AC8 — 固定版本的 Claude ACP 和 Gemini 进程各自完成脚本化模型对话、工具权限往返、取消及原生历史重载；证据区分这些测试、仅握手探针和 Electron 验收。 (verification: unit — 使用受控模型端点的原生子进程集成测试)

## Risks

SDK 与协议 schema 独立演进，智能体即使面对稳定客户端也可能发送扩展字段。需要类型化保留原生事实，同时不能假定支持。可选消息 ID 限制持久展示对账。部分智能体会继续自主工作，或接受其他客户端控制，因此 prompt 完成不等于整个 harness 静止。宿主回调和原生关闭行为需要取消测试，不能只检查成功路径 API 调用。相关桌面 PR 可能先于包接入落地，届时必须刷新实际所有者，避免重复 reader 或进程管理器。
