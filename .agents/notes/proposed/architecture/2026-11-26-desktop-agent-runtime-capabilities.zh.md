# Agent Note: 桌面 Agent 的运行能力

Status: proposed

[English](2026-11-26-desktop-agent-runtime-capabilities.md) | 中文

## Problem

输入框按 Agent 类型决定是否交给持久队列，桌面连接又独立判断能否接手。公共提交接口允许传入当前原生访问无法执行的忙时策略。CLI 已安装、握手成功与当前线程可写表达不同的事实。

## Proposal

每个输入操作绑定到实际能执行它的访问，保留输入 ID 和原生接纳结果。只读访问省略提交入口。插话说明空闲时的行为，原生后续输入说明能否在重启后恢复。交付结果未知时保留原目标。Main 负责派发。Pi Durable 持久化已接纳的后续输入；缺少原生持久排队能力时，草稿留在输入框现有待发队列。跨 harness 契约由[公共 runtime 包](../../../../packages/agent-runtime/README.md)持有。

本机 Agent 的发现、安装与启动从桌面目录读取同一份 CLI 组件声明。Pi CLI 的安装标识与恢复已有会话所用的协议彼此独立。Main 负责选择二进制、执行跨平台进程操作、终端登录、宿主权限与产品归账。Codex 适配器拥有其启动的 App Server 与 RPC 连接的生命周期。本机 Pi 通过随应用分发的 ACP 桥运行，内建 Pi 走 SDK，Claude 走 Claude 包，普通 ACP 走[现有适配器](../../../../packages/agent-runtime-acp/README.md)。保留显式 ACP 命令和 Codex App Server 路由。实时 part 与能力变化只读取相关来源。切换旧会话恢复路径前必须确认原生历史身份。

有专有行为的 ACP harness 由独立的 `agent-runtime-<harness>-acp` 包负责。包向设置页暴露可在浏览器中加载的 CLI 声明，按需实现原生安装配方、启动策略、模型配置和协议扩展。Main 注册适配器，提供进程、文件系统、审批和网关服务。公共 ACP 包为已注册的 harness 和自定义命令协商协议，并按原生会话分发增量。随应用分发的 Cursor SDK 管理登录、模型目录和会话，在选定工作区运行标准工具，并执行原生工具权限策略。Cherry 请求启用 Cursor Auto-review，按需提供浏览器 MCP 租约，并使用 SDK 的 agent ID 恢复会话。

CLI 包声明可执行文件和发行渠道。公共 CLI 契约携带宿主解析出的组件标识与路径。发现、安装复查与启动使用同一套组件选择。Codex 负责构造 stdio 启动命令、绑定 RPC 传输，并在探测或会话结束后关闭所持有的进程。探测只初始化连接或读取模型目录。显式指定的 wrapper 仍可提供完整命令。

桌面 ACP 的聊天和管理共用 stdio 进程契约。CodeBuddy 在自己的包中声明 npm 发行渠道。Antigravity 发现并安装官方 CLI，聊天和管理都运行 `agy acp`。Claude 把探测到的组件绑定到 SDK 启动，由 SDK 管理启动和关闭。

Amp 声明两个安装组件，Kiro 和 Vibe 各自提供安装配方。原生账号探测同时声明命令、输出解析和退出策略。Main 执行命令并转发登录提示。每次本机启动只读取一次所需配置文件。Harness 包解释配置，Main 验证路由并签发会话范围的网关凭据。

在官方 [Amp TypeScript SDK](https://ampcode.com/docs/sdk/typescript) 能使用宿主选中的 CLI 并在取消后等待子进程退出时，将 Amp 默认聊天迁到该 SDK。新的 SDK 会话使用原生 Amp thread ID。已有 ACP 会话仍可恢复，显式 ACP 命令仍可执行。终端、登录和额度读取继续使用选中的原生 CLI。SDK 入口保留图片输入及默认路径已提供的插话能力。

产品策略使用 Agent 权限模式。Runtime 可以通过连接报告会话当前生效的模式。调度器依据该模式和 Agent 的配置决策。原生控件适配层负责把选项名称和预设映射成 Agent 语义。原生快捷键和设置菜单使用同一套完全访问判定。

Runtime 声明模式选项在当前会话、下一轮或重连后生效。Main 在 runtime 能确认时读取已应用的模式。Composer 使用同一份选项语义。未映射的 ACP 选项继续作为原生控件展示。选项名称可以触发确认，宿主授权仍须有对应的权限依据。

未连接的会话展示选定 runtime 声明的权限控件。连接后使用当前原生控件。Effort 档位来自当前模型或明确声明的原生会话选项。绑定到模型的修改携带模型身份，由接收方复验。

Main 的本机连接检查、模型查询与会话打开共用一张表，派发到 ACP、Cursor、Codex 或 Claude 适配器。适配器实现这三项操作。保存的预设配置通过预设 ID 标识 runtime，从预设声明取得协议。自定义命令使用 ACP。CLI 发现与安装使用桌面 Code CLI 服务。MCP 租约由桌面的 MCP bridge 持有。

[本地 Agent 的启动级模型绑定](2026-11-27-local-agent-launch-model-binding.md) 负责一次启动如何获得 Cherry 模型及其凭据。每次启动获得限定于其会话和模型的凭据。只使用公共密钥的请求保留 provider 用量，归属会话为空。

ACP 适配器可以声明在启动时应用 Cherry 模型。Agent Services 把选中的 Cherry 模型保存在 Agent 中。Main 解析端点和模型地址，并向所属 runtime 提供限定范围的凭据。清除选项后恢复原生选模。多个会话共用进程的托管服务可以使用共用的 provider 配置。只有原生请求携带对应会话凭据时，用量才归该会话。

ACP 会话未连接时，打开下拉会读取已安装运行时的目录，会话等到启动时再连接。此时选中的原生模型，以及已接入的网关模型，沿用现有的 Agent 启动配置。已连接的 ACP 会话使用自身目录和会话操作切换原生模型。

Harness 适配器解释原生审批请求和选项。公共 ACP 包转换标准选项类型。Main 管理待处理审批、取消以及 Cherry 发放的会话授权。选中回执使用原生请求提供的选项 ID。

Composer 权限菜单使用已验证的独立 ACP 审批控制或具有多个已验证审批选项的原生权限目录。Harness 单独公布工作模式时，仅规划命令和 Shift+Tab 可在已验证的原生 Plan 与默认工作模式之间切换。其余 ACP 会话为 Cherry 的交互审批提供操作前询问、自动接受编辑和完全访问。Cherry 完全访问会选择原生请求提供的单次允许选项，并直接批准由宿主代跑的文件写入和终端操作。原生限制、只读模式、结构化提问和无人值守执行各自沿用原有策略。Cherry 按 Agent 保存档位。空闲会话通过各自支持的控件应用档位。开始新一轮前，运行时须能应用所选档位。切换权限保留 CLI 配置。

权限菜单包含独立的原生沙箱选项。Plan 继续使用规划快捷入口。其余本机会话选项和执行工作流归入现有会话菜单，模型默认参数归入 Agent 服务。输入框取消独立的配置按钮。原生目录用同一个 ACP 类别表示审批与工作流时，由运行时声明用途。

Runtime 分别报告原生接纳和实际放入的位置。只有明确未接纳才释放绑定，允许调度器重新排队。Composer 持有未提交草稿，由当前连接决定是否直接提交持久后续输入。主动压缩是空闲线程的独立操作，匹配的原生终态解除占用并刷新上下文读数。

Pi Durable、内建 Pi、Claude 和 Codex 的既有原生能力走同一组桌面输入和压缩入口。Codex Stop 可撤回尚未派发的输入。派发后缺少原生回声时，送达状态保持未知，保留原绑定。

本机安装通过发行与组件声明解析目标，无需打开运行时。各 runtime 包拥有登录方法和凭据选择。Main 把原生登录提示交给发起窗口并负责取消。

### Agent Provider 数据模型

当前分支把可执行文件覆盖、账号环境、模型选择、启用状态和浏览器策略放在 `Agent.configuration.localRuntime`。[AgentService](../../../../src/main/data/services/AgentService.ts) 从通用配置更新中解析执行配置。本机执行配置改用独立的类型化存储。

| 记录 | 字段与归属 |
| --- | --- |
| `agent_provider` | 一份已配置的连接，保存 UUID、类型化的预设或自定义 ACP 启动目标、覆盖项和可选的账号引用。预设声明协议和静态能力。替换启动目标或原生配置档案时创建新的 provider ID。登录更新原 provider 上的账号和凭据。 |
| `agent_provider_binding` | 每个本机 Agent 一行，以 Agent ID 为主键，provider 外键带索引。保存启用状态、浏览器策略和模型选择。多个 Agent 可共用 provider 并独立选模。 |
| `agent_runtime_backend` | 本机 backend 通过唯一且限制删除的外键关联 provider。[会话上下文](../../../../src/main/data/db/schemas/agentSessionContext.ts) 保存 backend 引用、原生线程 ID 和恢复需要的本机启动模型选择。 |

模型选择用可辨识联合表示，分为 `native-default`、携带原生目录 ID 的 `native` 和携带 Cherry 模型引用的 `cherry`。写入时校验，启动时通过[模型绑定](2026-11-27-local-agent-launch-model-binding.md)应用。会话内切换模型使用原生会话控制。修改模型选择和 provider 只写 Cherry 自己的数据。

Agent 服务在同一事务中保存 Agent 和绑定，提交后发布类型化变更。启用只检查连通性，无需创建原生会话。[本机驱动](../../../../src/main/ai/runtime/LocalRuntimeDriver.ts) 从已有上下文的 backend 查找接入，再选择适配器。新连接在启动前读取 Agent 绑定，在首条输入时以事务[绑定上下文](../../../../src/main/ai/agentSession/localContext.ts)。生效的账号、启动配置、模型或浏览器策略变化后，下一条输入使用新的连接。禁用的 Agent 无法接收输入。已保存的上下文通过原 provider 的当前凭据恢复。适配器确认线程无法恢复时，打开新的原生线程。下一条输入将它绑定到同一个 Cherry 会话，并附上所选分支的已有消息作为参考历史。

登录后在 provider 上记录已确认的方式、服务、地区及原生配置档案或凭据引用。写入事务会核对 provider 和保存的凭据仍与本次登录目标匹配。密钥留在 CLI、SDK 或现有凭据存储中。[LocalAgentAuthService](../../../../src/main/services/LocalAgentAuthService.ts) 按凭据所有者使旧账号查询失效，覆盖共用同一原生配置档案的 providers。适配器无法验证身份时，账号查询可以返回未知。

会话详情按当前会话实际使用的路由和账号查询额度。使用独立管理账号时，须明确关联该路由的凭据版本和已验证的账号或席位。适配器无法确认关联时，订阅额度不可用。发布结果前复核路由和账号。额度池由模型决定时，也复核当前模型。额度结果保存在内存中。

通过增量迁移为 main 的数据库新增结构。尚未发布的本机 Agent 功能直接使用新契约，同步移除分支上原有的本机配置 JSON 读写。

## Alternatives considered

统一布尔表无法表达只读子任务、重启即丢的队列或随模型变化的可写选项。为本机 Pi 再维护一个桌面客户端会重复实现流式传输、取消与会话恢复。以后引入原生路由时，需要指出值得单独维护的产品操作或实测收益。

## Acceptance criteria

- AC1 — 普通 ACP、Pi 托管子线程和 Durable 根线程只暴露实际支持的输入操作及保证。(verification: unit)
- AC2 — 回执丢失或连接失效不会导致再次把输入交给其他原生线程。(verification: unit)
- AC3 — 输入框按当前连接直接提交持久后续输入，无法直接提交时使用草稿队列。(verification: renderer)
- AC4 — Pi 与 Amp 的安装、版本、登录和聊天各自使用相应用途的真实组件。(verification: unit)
- AC5 — 真实桌面 ACP 连接按宿主权限完成首发、工具审批、取消和进程回收。(verification: Electron)
- AC6 — 探测和关闭一个观察者保留活跃 owner，重放不重复写消息或计费。(verification: Electron)
- AC7 — 两万条历史中追加一个原生 part 或改变一个输入能力，从生产端到 Renderer 均不访问旧历史。(verification: Electron)
- AC8 — 打开旧本机上下文会恢复原历史或报告失败，不新建替代线程。(verification: unit)
- AC9 — 本机 Pi 和 Claude 使用选定的安装、设置和历史，显式 ACP 覆盖保留原语义。(verification: Electron)
- AC10 — 选项、资源目录、指定边界的历史操作、用量与子任务控制分别依赖其 owner 的证据。(verification: unit)
- AC11 — 厂商扩展只执行协商并实现的操作，分别处理交付未知和明确未接纳。(verification: unit)
- AC12 — 清理冗余 reader 与组件声明后，打包产物的管理、启动与恢复入口正常工作。(verification: packaged artifact)
- AC13 — Cursor 无需 CLI 即可在选定工作区创建会话，并按 SDK 的 agent ID 恢复会话。两条路径均可使用所选模型的标准工具集。聊天按原始调用 ID 展示工具调用和原生权限错误。（验证：单元测试和 Electron）
- AC14 — OpenClaw 通过自己的适配器恢复会话并过滤桥接器标题。自定义 ACP 命令经过同一桌面连接入口，使用协商出的恢复方式并保留原生标题。设置页与聊天读取同一份 CLI 声明。(verification: unit)
- AC15 — Codex 安装与启动使用同一个 CLI 组件标识。连接检查和模型探测不打开原生线程，正常关闭、启动失败和取消均等待所属 App Server 进程回收。(verification: unit and Electron)
- AC16 — CodeBuddy 和 Claude 的安装与启动使用各自包中的声明。Antigravity 的发现和安装复查选中 `agy`，聊天和管理以 `acp` 参数启动该程序。ACP 管理和聊天在退出时均等待所属进程回收。(verification: unit and Electron)
- AC17 — Amp、Kiro 和 Vibe 通过包声明保留原生组件和安装行为。CLI 账号探测按各 harness 声明的格式解释成功和未登录退出。(verification: unit)
- AC18 — 启动期间修改原生配置时，启动与网关归账对同一文件使用同一次读取结果。(verification: unit)
- AC19 — 即使 Agent 保存的模式允许输入建议，连接当前生效的 Plan 模式仍阻止生成建议。映射到完全访问的原生选项需要确认，Plan 快捷键不能选中它。(verification: unit and renderer)
- AC20 — Antigravity 问题返回 agent 提供的选项 ID。答案有歧义时取消请求。审批界面展示 Antigravity 警告，并将原生始终允许选项标记为会话授权。(verification: unit and Electron)
- AC21 — Goose 的 `auto` 需要确认，Claude 的 `auto` 仍由审查机制处理。未经验证的 ACP `yolo` 选项无法授权宿主写文件或执行终端操作。修改 DeepSeek Harness 模式会关闭空闲连接，并在下次启动时生效。(verification: unit and renderer)
- AC22 — Codex、Cursor 和 Claude 分别通过自己的 Main 适配器启动、查询模型和恢复原生会话。它们的会话路径不导入桌面 ACP 注册表或 ACP 附件编码器。(verification: import boundaries and Electron)
- AC23 — 使用同一个网关模型的两个 CLI 会话分别取得自己的凭据，请求归到凭据对应的会话。只有公共密钥的请求不会归到任一会话。启动准备在绑定凭据时不重复读取配置文件。(verification: unit and Electron)
- AC24 — 同一预设的检查、模型查询与会话打开选择同一个 Main 适配器。保存的配置包含预设 ID。自定义可执行文件选择 ACP。新增协议时必须为 Main 派发表提供三项操作。(verification: schema and typecheck)
- AC25 — 读取冷会话控件不会打开原生会话。连接关闭时 Composer 撤下该连接的实时控件。切换模型后撤下旧模型档位，并拒绝写入旧模型。ACP 保留原生公布的档位，包括 Pi ACP 的旧版思考模式和 Grok 的旧版模型元数据。Cursor 从 SDK 模型目录读取档位，在下一次发送时应用所选值。(verification: unit and Electron)
- AC26 — 设置页从所选安装读取目录，普通 ACP 原生模型作为 Agent 的启动偏好保存。Composer 使用当前 ACP 会话公布的候选并调用该会话绑定的操作。标准配置回包或通知确认当前模型和 effort，旧版选模使用原生回执。未登录、空目录、只有当前模型与写入方法不可用分别展示。标准目录探测在读完选项后关闭。Grok 在可用时直接读取模型目录。桌面连接和 ThreadHandle 复用原生控件实现。同一会话只允许一笔控件写入在途，迟到回包不能覆盖已收到的新配置通知。(verification: unit and Electron)
- AC27 — 上下文读数使用原生端报告的占用量或最近一次模型请求。Cursor 把整轮累计 token 留在用量记录。窗口取自原生 runtime 或已绑定的 Cherry 目录模型。窗口未知时显示 token 数，省略百分比。(verification: unit and Electron)
- AC28 — 原生插话的回执、归属和拒绝沿用同一 input ID。缺失或不明确的结果不会触发回退。原生后续轮和上一条 prompt 回包同批到达时，正文和终态仍归原生后续轮。桌面和原生回放共用同一个 ACP 会话 owner。恢复前绑定原生 ID，桌面接收启动元数据与已归属的新 turn，时间线继续增量写入。会话 owner 负责原生关闭及等待进程退出。 (verification: unit and Electron)
- AC29 — 主动压缩占用线程直到原生操作结算或来源终止。只有匹配的完成证据才刷新上下文读数。(verification: unit and Electron)

- AC30 — 安装代码无法导入会话适配器。登录提示和取消归发起窗口。启动失败或截止后，先关闭所属进程再返回。(verification: lint, unit and Electron)
- AC31 — Codex 与 Claude 无需执行一轮或扫描历史即可读取订阅窗口。同一已保存目标的并发查询共用在途结果。账号或配置改变后丢弃旧结果。Cherry 网关路由不继承 harness 账号的额度。厂商 Key 可以读取其实际认证的订阅额度。(verification: unit and Electron)

- AC32 — 新增的订阅读取器使用原生额度来源及启动所选的账号。组件、协议版本、账号存储或路由不受支持时返回明确结果，且不发送模型输入。无上限的预付余额显示币种和金额。(verification: unit and Electron)

- AC33 — 新建的默认 Amp 聊天使用官方 SDK，与登录和额度读取使用同一个 CLI 和账号。文本、图片及已支持的插话到达对应线程，SDK 会话按 Amp thread ID 恢复，取消后等待子进程退出。已有 ACP 会话及显式 ACP 命令仍可用。(verification: unit, Electron and packaged artifact)
- AC34 — 目录项选择声明的发行版和地区。每个可用登录流程在同一 runtime 完成并刷新账号状态。仅需供应商凭据的配置不提供 harness 账号登录。需要认证的前置状态显示为登录操作。(verification: unit and Electron)

- AC35 — 缺少已验证原生审批控制或多个已验证审批选项的 ACP 会话，在首轮开始前或连接已建立后，都可以用与内置 Agent 相同的权限菜单调整 Cherry 的模式。独立的仅规划命令和 Shift+Tab 可在 OpenCode 的 Plan 与 Build 之间切换。已验证的独立审批控制可以单独切换原生审批。独立工作流不会隐藏已验证的审批选项。同一 Agent 的权限菜单和仅规划命令共用 Agent 保存的权限档位。每个会话按自己的原生能力应用对应档位。一个档位对应多个原生选项时使用目录中的首个匹配。排除会持久化 CLI 配置的 ACP setter。切换模式时保留 CLI 配置。已验证的启动型跳过审批由 Agent 的权限档位决定，并在需要启动参数的会话中经新的 ACP 进程生效。进入仅规划时先移除启动覆盖，再恢复会话。Cherry 完全访问只发送原生提供的单次允许选项。切回操作前询问后恢复交互式审批，无人值守时继续拒绝请求。输入框在权限菜单显示原生审批，在会话菜单显示其余会话选项。ACP 对审批和执行工作流使用同一类别时，仍能独立选择执行工作流。模型默认参数归入设置。(verification: unit, renderer and Electron)
- AC36 — Agent Services 可以为 DeepAgents、Antigravity 和 Command Code 保存和清除 Cherry 模型。已启用的适配器使用选中的模型和发起会话的限定凭据，向内部网关发送原生 ACP 对话轮次。(verification: unit, renderer and Electron)
- AC37 — OpenClaw 可以通过托管配置使用 Cherry 网关模型。并发会话使用一致的模型路由，只有通过凭据验证的用量才会归到具体会话。(verification: unit and Electron)
- AC38 — Junie、DimAgent、Muse Code、Auggie、TRAE CN、Qoder 和 Qoder CN 在验证原生 ACP 能用注入的凭据向选定本机端点发送对话轮次后，提供 Cherry 模型选项。(verification: native ACP and Electron)
- AC39 — ACP 交互会话连接就绪后，模型下拉从该会话获取原生候选，也可以提供已配置的网关模型。连接就绪前打开下拉不会另起 ACP 进程。设置页和拥有独立原生目录的适配器保留各自的查询入口。(verification: renderer and Electron)
- AC40 — 进入本机 ACP 普通聊天后，主进程使用所选工作区和工具在后台新建或恢复正式连接。只读历史无需激活运行时。并发发送加入同一次建立或恢复。切换权限需要正式连接，已经打开的权限菜单会在连接就绪后从连接状态更新为会话公布的档位。计划任务会话仍可在连接前选择权限。离开交互视图后，可恢复的空闲连接可以被回收。设置页启用本机 Agent 时检查连通性。(verification: unit, renderer and Electron)
- AC41 — 会话详情沿用现有上下文用量展示。打开详情或刷新时读取受支持的本机 Agent 订阅额度，显示原生窗口和余额。查询结果只显示在对应 Agent 的会话详情里。Cursor 使用当前 SDK 凭据，按原生计划展示独立额度池，并以只读方式访问 SDK 凭据。(verification: renderer and Electron)
- AC42 — Muse 使用支持额度查询的原生版本。Kiro 通过只读接口查询当前登录账号的 Credits。MiniMax 仅为当前会话中使用官方 API Key 路由的模型查询 Token Plan。读取额度保持本机凭据和会话历史原样。(verification: unit and Electron)
- AC43 — 新建和编辑本机 Agent 时，启动配置和账号保存在 provider 上，启用状态、浏览器策略和模型选择保存在绑定上。共用一个 provider 的两个 Agent 可以分别选择模型。(verification: unit and renderer)
- AC44 — Agent 从 provider A 切到 B 后，已有上下文继续使用 A，新上下文使用 B。在 A 上登录不同账号时沿用 provider ID，并用新的登录尝试恢复原线程。接收输入时检查实际启动配置。确认原生线程丢失或无法恢复时，可在同一个 Cherry 会话通过新线程继续，参考历史仅附一次。启动失败时保留已有分支。(verification: unit and Electron)
- AC45 — 额度结果发布时，生效路由和账号或席位绑定必须匹配。变更凭据或账号会让在途结果失效。(verification: unit and Electron)
- AC46 — 追加的结构迁移可在已有数据的 main 数据库执行。新建本机 Agent、配置账号和打开会话使用类型化记录作为存储契约。(verification: unit and Electron)

## Risks

ACP 会话 ID 可以与 Pi 会话文件不同，确认身份前保留旧恢复入口。本机接手请求不能证明原生已经放置输入。配置改变和断线可能使旧控件失效。
