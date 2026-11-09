# Agent Note: ACP v1 运行时适配器

Status: implemented

[English](2026-11-09-agent-runtime-acp-v1.md) | 中文

## Problem

Cherry 已有公共[运行时契约](../../../../packages/agent-runtime/README.md)和原生 Pi、Pi Durable、Claude Code 适配器，但 `main` 的 `27a61a606566` 尚无可移植的 ACP 适配器。ACP 是 harness 的客户端协议，不是执行引擎。连接智能体并不意味着 Cherry 接管其模型循环、存储、工具或子智能体。

本次目标是通用的 `@cherrystudio/agent-runtime-acp/v1` 适配器，首批兼容性样本为 Claude ACP 和 Gemini CLI。本文细化 [harness 边界](../../proposed/architecture/2026-10-17-agent-harness-boundaries.md)，不修改公共契约。此前的[五样本证据](../../proposed/testing/2026-10-17-agent-harness-evidence.md)仍是各自固定版本上的历史证据。

相关的 [PR #21221](https://github.com/CherryHQ/cherry-studio/pull/21221) 在本次检查的 `909ce14a6882` 已包含桌面端 `localAgent/AcpConnection.ts`，同时负责启动、认证、文件系统／终端回调和产品用量。该实现尚未合并，是接入参考，不是当前分支的代码。可移植包不能与它并列成为第二个生产连接所有者；桌面采用新包时，需要单独限定范围，迁移当前连接所有者。

## Decision

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

`packages/agent-runtime-acp` 显式导出 `/v1`。依赖 `@cherrystudio/agent-runtime` 和固定的 `@agentclientprotocol/sdk@2.4.0`，经公共包复用现有 SDK 内容协议。包内不引入 Electron、产品数据库、智能体安装器、凭证管理器或原生 harness 依赖。公共运行时不需要新增公开类型。

`createAcpRuntime` 拥有一个已配置的 backend 命名空间及其 ACP 连接。宿主提供独占的传输租约及 close-and-join 操作、原生会话配置查询、诊断入口和支持的客户端回调。SDK 负责分帧、JSON-RPC 关联、入站方法参数校验和连接请求。适配器负责初始化、会话路由、输入记录、标准化 feed 和访问生命周期。宿主继续负责可执行文件解析、进程启动、凭证、路径策略，以及关闭时等待自有进程退出。仅关闭 SDK 连接不能证明进程已退出。

初始化之前注册回调，并要求协议版本为 1。使用具有显式连接生命周期的 `ClientApp.connect`；若通过 `connectWith` 回调返回 runtime，回调结束就会关闭传输。可选操作必须核对协商能力与返回的会话配置。已声明的扩展仍是原生元数据，不能据此调用稳定入口中不存在的方法。

`create` 使用原生 `session/new`。`open` 验证 backend，优先复用已有会话所有者，再考虑 `session/load`。冷加载所需的 `cwd` 和 MCP 配置由宿主提供；展示消息绝不转成原生上下文。捕获 new/load 响应之前的初始化更新，包括新会话 ID 返回之前的更新。临时路由必须有界，溢出时明确失败，不能悄悄丢失历史或将其归入另一会话。在连接边界串行创建新会话以避免临时路由歧义，但不串行执行独立会话的 prompt。

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

### 实现与原生证据

[Spec PR #23916](https://github.com/CherryHQ/cherry-studio/pull/23916) 已合并至 `724130665f2e`，用户在任务对话中明确授权开始实现。本包完成适配器与原生验收层。此前调研探针只证明传输行为和隔离初始化，没有声称已验证 Cherry 适配器或原生模型循环。旧版 Gemini 0.19.4 的初始化超时仍不属于已接受基线。

实现复用 SDK 稳定客户端、`ThreadFeed` 和 `RuntimeMessageStream`。协议测试通过真实 SDK 传输与自有子进程调用适配器公共接口。原生测试运行已发布的 Claude ACP 和 Gemini 进程，使用隔离存储与受控模型端点，验证实际文件工具副作用，并在新进程中通过 ACP 重载历史。桌面接入、安装、账号界面、提供商路由及实验性 v1/v2 控制仍属独立范围。

## Alternatives considered

- 复制 JSON-RPC 客户端或旧版 `ClientSideConnection` 示例：不采用，SDK 2.4.0 已提供传输与显式连接生命周期。
- 为获得全部 Claude 能力而导入 unstable v1 或 v2 草案：暂缓，这会改变兼容性目标，也不能证明 Gemini 支持。
- 根据工具名或方法名统一排队、子智能体和持久身份：不采用，源码证据与这些保证相矛盾。
- 将桌面连接整体搬入包：不采用，启动、凭证、产品用量和宿主文件系统策略属于桌面宿主；消费者迁移放入另行批准的接入变更。

## Consequences

SDK 和协议 schema 独立演进；扩展元数据不会启用未支持的控制。原生 ID 仍按会话和内容种类限定范围，缺失 ID 时仅使用投影本地身份。Prompt 完成不代表整个 harness 已静止。公共上下文用量要求稳定模型配置和原生占用证据；旧模型扩展与累计计费保留为原生事实。可执行文件、凭证、文件系统和终端策略归宿主负责。

初始化缓冲限制为 256 个更新或 8 MiB。取消和关闭等待采用 10 秒截止时间，无法确认时保留未知结果。终端支持要求提供全部终端回调。Elicitation 仅声明按会话限定的表单支持，不支持 URL 或请求范围的 elicitation。

发布版 Gemini 0.67.0 启动历史重放后，未等待重放结束就从 `session/load` 返回；调研中的更新源码已等待重放。适配器保留后续更新，原生验收等待预期历史实际到达。该二进制的 load 成功响应不证明重放已完整结束。Claude 验收选择已声明的 `default` 权限模式，因为其初始模式可能允许编辑；模型夹具另行处理标题生成请求。原生验收需显式启用并检查版本，缺少二进制文件或在 Windows 上均明确跳过，不计为通过。

## Verification

以下命令在 macOS、Node 24.21.0 和 pnpm 12.6.0 上实际运行。协议测试使用 SDK 2.4.0 和真实 NDJSON 流；原生测试启动隔离子进程，连接受控的 loopback 模型端点。原生可执行文件是外部测试输入，不是包依赖。复现命令及环境变量见[包 README](../../../../packages/agent-runtime-acp/README.md)。

- AC1 — 包的 `build`、`typecheck` 及 `runtime.test.ts`：`/v1` 入口基于稳定 SDK 2.4.0 构建，拒绝不兼容的初始化，公共运行时契约保持不变。
- AC2 — `runtime.test.ts` 和 `lifecycle.test.ts`：并发打开共享所有者；new/load 重放按会话路由；历史缺失、load 不受支持、backend 不匹配和有界初始化缓冲溢出时均失败，不创建替代会话。
- AC3 — `runtime.test.ts`：仅证明派发的回执、同步占用 busy 槽位、本地重复 ID 拒绝、独立会话、未支持的策略、准确终态、远端失败及断线后不重试。
- AC4 — `runtime.test.ts` 和 `lifecycle.test.ts`：原生候选权限 ID、取消未完成权限请求、拒绝过期回复、保留尾部输出、完成与取消竞争、来源丢失，以及取消超时后保留 busy 槽位。
- AC5 — `runtime.test.ts` 和 `lifecycle.test.ts`：文本／推理及文本／文件／文本顺序、合并工具局部更新、保留资源／差异／元数据、按会话限定 ID、观察者隔离、溢出恢复，以及仅关闭超载的观察者。
- AC6 — `runtime.test.ts` 和 `lifecycle.test.ts`：内容／MCP／配置能力门控、按会话限定的文件系统及完整终端回调、表单 elicitation、被动上下文证据、保留累计费用，以及不提供公共子智能体控制。
- AC7 — `lifecycle.test.ts`：真实子进程退出、join 失败及重试、延迟获取传输、排空投递及保留原生历史；释放一个 handle 不影响另一个访问。
- AC8 — `native.test.ts`：Claude ACP 0.101.0 搭配 Claude Agent SDK 0.3.318，以及 Gemini CLI 0.67.0，分别完成对话、真实文件工具权限往返、进行中取消，以及新进程中的历史重载。实际提供了两个可执行文件变量，两个原生用例均未跳过。

变更后的验证计划器也通过 `scripts/__tests__/validationPlan.test.ts`。以上证据不包含 Electron 接入、真实提供商计费、Windows 原生验收或打包。
